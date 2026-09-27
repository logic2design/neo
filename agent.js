/* ============================ NEO · AGENTS ============================ */
/* What an AI agent (Codex, Hermes, Claude… via mcp/neo-mcp.mjs) may do:  */
/* list, search, read and write notes — chapters and each book's Notes    */
/* tab — in Markdown. Nothing is deleted, nothing is exported, no file    */
/* outside the library is written. Only while the writer allows it (File  */
/* menu) and the app is open. Edits to the open book go through the page, */
/* so they appear at once and ⌘Z takes them back.                         */

'use strict';

const agentBook = async (ref) => {
  const want = String(ref || '').trim();
  if (!want) throw new Error('Say which notebook: its id or its title (list_notebooks shows them)');
  const ids = library.shelves.flatMap((s) => s.bookIds);
  if (ids.includes(want)) return window.neo.readBookMeta(want);
  const metas = (await Promise.all(ids.map((id) => window.neo.readBookMeta(id)))).filter(Boolean);
  const exact = metas.filter((m) => m.title.toLowerCase() === want.toLowerCase());
  const found = exact.length ? exact : metas.filter((m) => m.title.toLowerCase().includes(want.toLowerCase()));
  if (found.length === 1) return found[0];
  if (!found.length) throw new Error(`No notebook called “${want}”`);
  throw new Error(`“${want}” matches ${found.length} notebooks: ${found.map((m) => `${m.title} (${m.id})`).join(', ')} — use the id`);
};

// the live copy when the book is open, so nothing the writer typed is lost
const agentMeta = (m) => (book && book.id === m.id ? book : m);

function agentChapter(m, ref) {
  const order = m.chapterOrder || [];
  if (ref == null || ref === '') return null;
  if (order.includes(String(ref))) return String(ref);
  const n = parseInt(ref, 10);
  if (String(n) === String(ref).trim() && order[n - 1]) return order[n - 1];
  const t = String(ref).toLowerCase();
  const hit = order.find((id) => ((m.chapterTitles || {})[id] || '').toLowerCase() === t);
  if (hit) return hit;
  throw new Error(`No chapter “${ref}” in “${m.title}” — it has ${order.length} (number them from 1)`);
}

async function agentChapterHtml(m, chId) {
  if (book && book.id === m.id) {
    const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    return el ? captureBody(el) : (chapterHTML[chId] || '');
  }
  return window.neo.readChapter(m.id, chId);
}

// pictures come out as real file addresses an agent can look at
// headOffset 1: a Heading 1 is "##"; under "## Chapter" labels it steps down to "###"
function agentMd(blocks, bookId, headOffset = 1) {
  return blocksToMd(blocks, { img: (b) => (hasScheme(b.src) ? b.src : fileUrlFromPath(libraryDirPath + '/' + bookId + '/' + safeDecode(b.src))) }, headOffset);
}

async function agentMdToHtml(md, bookId) {
  const blocks = await materializeImages(mdToBlocks(String(md || ''), { copyLocal: true }), bookId);
  return blocksToEditorHtml(blocks);
}

const chapterLabel = (m, chId) => {
  const i = m.chapterOrder.indexOf(chId);
  const t = (m.chapterTitles || {})[chId];
  return `Chapter ${i + 1}${t ? ' — ' + t : ''}`;
};

async function agentWords(m, chId) {
  return blocksWordCount(blocksFromChapterHtml(await agentChapterHtml(m, chId), m.id));
}

// write one chapter's html, live when the book is open
async function agentPutChapter(m, chId, html) {
  if (book && book.id === m.id) {
    chapterHTML[chId] = html || '<p><br></p>';
    await window.neo.writeChapter(m.id, chId, chapterHTML[chId]);
    const keep = $('#paper-scroll').scrollTop;
    renderChapters();
    $('#paper-scroll').scrollTop = keep;
    updateCounters();
    return;
  }
  await window.neo.writeChapter(m.id, chId, html || '<p><br></p>');
  let words = 0;
  for (const id of m.chapterOrder) words += id === chId ? blocksWordCount(blocksFromChapterHtml(html, m.id)) : await agentWords(m, id);
  m.wordCount = words;
  await window.neo.writeBookMeta(m.id, m);
}

// one undo step per agent request on the open book
function agentUndoPoint(m, what) {
  if (book && book.id === m.id) snapshotStructure('AI agent: ' + what);
}
const agentTold = (m, what) => {
  toast(`An AI agent ${what} “${m.title}” — ${book && book.id === m.id ? K('⌘Z', 'Ctrl+Z') + ' undoes it' : 'open it to see'}`, 5000);
};

const AGENT_TOOLS = {
  async list_notebooks() {
    const out = [];
    for (const shelf of library.shelves) {
      for (const id of shelf.bookIds) {
        const raw = await window.neo.readBookMeta(id);
        if (!raw) continue;
        const m = agentMeta(raw);
        out.push({
          id: m.id, title: m.title, author: m.author, shelf: shelf.name,
          chapters: m.chapterOrder.map((c, i) => ({ number: i + 1, id: c, title: (m.chapterTitles || {})[c] || '' })),
          words: m.wordCount || 0, open: !!(book && book.id === m.id), modified: m.modified
        });
      }
    }
    return out;
  },

  async read_note({ notebook, chapter }) {
    const m = agentMeta(await agentBook(notebook));
    const one = agentChapter(m, chapter);
    const parts = [];
    for (const chId of one ? [one] : m.chapterOrder) {
      const labelled = !one && m.chapterOrder.length > 1;
      const md = agentMd(blocksFromChapterHtml(await agentChapterHtml(m, chId), m.id), m.id, labelled ? 2 : 1);
      parts.push(labelled ? `## ${chapterLabel(m, chId)}\n\n${md}` : md);
    }
    return { notebook: m.title, id: m.id, chapter: one ? chapterLabel(m, one) : 'all', markdown: parts.join('\n\n') };
  },

  async write_note({ notebook, chapter, markdown, mode }) {
    const m = agentMeta(await agentBook(notebook));
    mode = mode || 'append';
    if (!['replace', 'append', 'prepend'].includes(mode)) throw new Error('mode is replace, append or prepend');
    let chId = agentChapter(m, chapter);
    if (!chId) {
      if (mode === 'replace' && m.chapterOrder.length > 1) throw new Error('Replacing needs a chapter (a number from 1, its id or its title)');
      chId = mode === 'prepend' ? m.chapterOrder[0] : m.chapterOrder[m.chapterOrder.length - 1];
    }
    if (!chId) return AGENT_TOOLS.add_chapter({ notebook: m.id, markdown });
    agentUndoPoint(m, 'write');
    const add = await agentMdToHtml(markdown, m.id);
    const cur = mode === 'replace' ? '' : await agentChapterHtml(m, chId);
    const empty = !cur || /^(<p><br><\/p>)*$/.test(cur.trim());
    const html = mode === 'replace' || empty ? add : mode === 'append' ? cur + add : add + cur;
    await agentPutChapter(m, chId, html);
    agentTold(m, mode === 'replace' ? 'rewrote a chapter of' : 'added to');
    return { ok: true, notebook: m.title, chapter: chapterLabel(m, chId), words: await agentWords(m, chId) };
  },

  async add_chapter({ notebook, title, markdown }) {
    const m = agentMeta(await agentBook(notebook));
    agentUndoPoint(m, 'new chapter');
    let chId;
    if (book && book.id === m.id) chId = createChapterAt(book.chapterOrder.length);
    else {
      chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      m.chapterOrder.push(chId);
    }
    if (title) {
      m.chapterTitles = m.chapterTitles || {};
      m.chapterTitles[chId] = String(title).trim();
    }
    if (book && book.id === m.id) scheduleMetaSave();
    await agentPutChapter(m, chId, await agentMdToHtml(markdown, m.id));
    agentTold(m, 'added a chapter to');
    return { ok: true, notebook: m.title, chapter: chapterLabel(m, chId), id: chId };
  },

  async create_notebook({ title, markdown, author }) {
    if (!String(title || '').trim()) throw new Error('A new notebook needs a title');
    const meta = await window.neo.createBook({ title: String(title).trim(), author: author || displayAuthor() });
    meta.tabNames = { notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes', outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline' };
    const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    meta.chapterOrder = [chId];
    const html = await agentMdToHtml(markdown || '', meta.id);
    await window.neo.writeChapter(meta.id, chId, html || '<p><br></p>');
    meta.wordCount = blocksWordCount(blocksFromChapterHtml(html, meta.id));
    await window.neo.writeBookMeta(meta.id, meta);
    const shelf = shelvesFor(currentAuthor().id)[0] || library.shelves[0];
    shelf.bookIds.push(meta.id);
    await window.neo.writeLibrary(library);
    if (!$('#bookshelf-view').hidden) renderShelves();
    toast(`An AI agent started a new notebook: “${meta.title}”`, 5000);
    return { ok: true, id: meta.id, title: meta.title, shelf: shelf.name };
  },

  async search_notes({ query, notebook }) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) throw new Error('Search for something');
    const metas = notebook ? [await agentBook(notebook)] : (await Promise.all(library.shelves.flatMap((s) => s.bookIds).map((id) => window.neo.readBookMeta(id)))).filter(Boolean);
    const hits = [];
    for (const raw of metas) {
      const m = agentMeta(raw);
      for (const chId of m.chapterOrder) {
        const text = blocksFromChapterHtml(await agentChapterHtml(m, chId), m.id).map(blockPlainText).join('\n');
        const low = text.toLowerCase();
        for (let at = low.indexOf(q); at !== -1 && hits.length < 100; at = low.indexOf(q, at + q.length)) {
          hits.push({ notebook: m.title, id: m.id, chapter: m.chapterOrder.indexOf(chId) + 1,
            context: text.slice(Math.max(0, at - 70), at + q.length + 70).replace(/\s+/g, ' ').trim() });
        }
      }
    }
    return { query, matches: hits.length, hits };
  },

  async read_notes_tab({ notebook }) {
    const m = agentMeta(await agentBook(notebook));
    const live = book && book.id === m.id && currentTab === 'notes';
    const html = live ? $('#aux-editor').innerHTML : await window.neo.readAux(m.id, 'notes');
    const holder = document.createElement('template');
    holder.innerHTML = html || '';
    return { notebook: m.title, markdown: agentMd(parseBlocks(holder.content, { bookId: m.id, trim: true }), m.id) };
  },

  async write_notes_tab({ notebook, markdown, mode }) {
    const m = agentMeta(await agentBook(notebook));
    mode = mode || 'append';
    if (!['replace', 'append'].includes(mode)) throw new Error('mode is replace or append');
    const live = book && book.id === m.id && currentTab === 'notes';
    if (live) flushAux();
    const add = await agentMdToHtml(markdown, m.id);
    const cur = mode === 'replace' ? '' : (live ? $('#aux-editor').innerHTML : await window.neo.readAux(m.id, 'notes')) || '';
    const html = cur.trim() ? cur + add : add;
    await window.neo.writeAux(m.id, 'notes', html);
    if (live) { $('#aux-editor').innerHTML = html; richNormalize($('#aux-editor')); }
    agentTold(m, 'updated the notes of');
    return { ok: true, notebook: m.title };
  }
};

window.neo.onAgentCall(async ({ id, tool, args }) => {
  try {
    if (!library) throw new Error('My Notes is still starting up — try again in a moment');
    const fn = Object.prototype.hasOwnProperty.call(AGENT_TOOLS, tool) ? AGENT_TOOLS[tool] : null;
    if (!fn) throw new Error('Unknown tool: ' + tool);
    window.neo.agentReply(id, { result: await fn(args || {}) });
  } catch (err) {
    window.neo.agentReply(id, { error: String((err && err.message) || err) });
  }
});
