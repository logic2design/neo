/* ============================ NEO · RICH ============================ */
/* Links, lists, checklists, tables, code, quotes, headings, rules and   */
/* pictures. One block model is shared by the editor, paste, import and */
/* every export, so a thing written once comes out right everywhere:    */
/*                                                                       */
/*   HTML (editor, clipboard, .docx, markdown) → blocks → any output     */
/*                                                                       */
/* Loaded after app.js and shares its globals (book, chapterHTML, …).   */

'use strict';

/* ------------------------------------------------------------------ */
/*  The block model                                                    */
/*                                                                     */
/*  run    {text, b, i, s, code, href} · {mark: sid} (placeholder flag) */
/*  p      {type:'p', runs, align, poetry}   poetry: NEO's ⇧Enter lines */
/*  break  {type:'break'}                     the *** scene break      */
/*  heading{type:'heading', level 1-3 (raw 1-6 while importing), runs} */
/*  quote  {type:'quote', blocks}                                      */
/*  list   {type:'list', ordered, start, task, items:[{runs, checked,  */
/*          children:[list…]}]}                                        */
/*  code   {type:'code', lang, text}                                   */
/*  hr     {type:'hr'}                                                 */
/*  table  {type:'table', rows:[{header, cells:[{runs, align}]}]}      */
/*  image  {type:'image', src, alt, caption, width, bookId}            */
/*                                                                     */
/*  Image src is canonical: "images/x.png" (inside the book folder),   */
/*  file:///… (linked from disk) or https://… (linked from the web).   */
/* ------------------------------------------------------------------ */

const RICH_EDITABLE = '.chapter-body, #aux-editor';
const BLOCKISH = 'p,div,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,li,pre,table,figure,hr,section,article,header,footer,aside,nav,main,dl,dt,dd,center,form,fieldset,details,summary,address';
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME',
  'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'HEAD']);
const IMG_FILE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const clampLevel = (l) => Math.max(1, Math.min(3, l || 1));
// pictures come in four sizes: a quarter, half, three-quarters, or the full column
const snapWidth = (w) => (!w || w >= 88 ? 0 : w < 38 ? 25 : w < 63 ? 50 : 75);

let homeDir = '';
window.neo.homeDir().then((h) => { homeDir = h || ''; }).catch(() => {});

/* ---------- addresses ---------- */

const hasScheme = (s) => /^[a-z][a-z0-9+.-]*:/i.test(s);

function fileUrlFromPath(p) {
  return 'file://' + encodeURI(String(p).replace(/\\/g, '/')).replace(/\?/g, '%3F').replace(/#/g, '%23');
}
function pathFromFileUrl(u) {
  try { return decodeURIComponent(new URL(u).pathname); } catch { return null; }
}

// The only links NEO keeps: web, mail, phone, files on this Mac, and paths
// inside the book folder. Everything else (javascript:, data:, …) is dropped.
function safeHref(s) {
  s = String(s || '').trim();
  if (!s || s.startsWith('#')) return null;
  if (/^(https?|mailto|tel|file):/i.test(s)) return s.replace(/ /g, '%20');
  if (hasScheme(s)) return null;
  return s;
}
function safeImgSrc(s) {
  s = String(s || '').trim();
  if (!s) return null;
  if (/^data:image\//i.test(s)) return s;
  if (/^(https?|file):/i.test(s)) return s.replace(/ /g, '%20');
  if (hasScheme(s)) return null;
  return s;
}

// What the writer typed into a link box, as something a link can point at
function normalizeHref(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (/^<.*>$/.test(s)) s = s.slice(1, -1).trim();
  if (/^["'].*["']$/.test(s)) s = s.slice(1, -1).trim(); // Finder's "Copy as Pathname" quotes
  if (s.startsWith('~/') && homeDir) s = homeDir + s.slice(1);
  if (s.startsWith('/')) return fileUrlFromPath(s);
  if (/^www\./i.test(s)) s = 'https://' + s;
  else if (/^[^\s@/:]+@[^\s@/]+\.[a-z]{2,}$/i.test(s)) s = 'mailto:' + s;
  else if (!hasScheme(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(s)) s = 'https://' + s;
  return safeHref(s);
}

// how an address reads to a person
function displayHref(h) {
  if (!h) return '';
  if (/^file:/i.test(h)) return (pathFromFileUrl(h) || h).replace(homeDir ? new RegExp('^' + homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : /^$/, '~');
  if (/^mailto:/i.test(h)) return h.slice(7);
  if (/^tel:/i.test(h)) return h.slice(4);
  return h;
}

// where a picture actually loads from, for the editor and the PDF printer
function mediaUrl(src, bookId) {
  if (!src) return '';
  if (hasScheme(src)) return src;
  if (!bookId) return src;
  if (/^[a-z]+:\/\//.test(libraryDirPath)) {
    return libraryDirPath + '/' + encodeURIComponent(bookId) + '/' + src.split('/').map((s) => encodeURIComponent(decodeURIComponent(s))).join('/');
  }
  return fileUrlFromPath(libraryDirPath + '/' + bookId + '/' + decodeURIComponent(src));
}

const baseName = (src) => {
  const clean = String(src || '').split(/[?#]/)[0];
  try { return decodeURIComponent(clean.split('/').pop()) || 'image'; } catch { return clean.split('/').pop() || 'image'; }
};

/* ---------- runs ---------- */

const FMT_KEYS = ['b', 'i', 's', 'code', 'href'];
const sameFmt = (a, b) => FMT_KEYS.every((k) => (a[k] || false) === (b[k] || false));
const runsText = (runs) => (runs || []).map((r) => r.text || '').join('');
const runsHaveContent = (runs) => runs.some((r) => r.mark !== undefined || (r.text && r.text.trim()));

// the formatting an element adds to what's inside it
function elFmt(el, fmt) {
  const tag = el.tagName.toUpperCase();
  let f = fmt;
  if (tag === 'B' || tag === 'STRONG') f = { ...f, b: true };
  else if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'DFN' || tag === 'VAR') f = { ...f, i: true };
  else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') f = { ...f, s: true };
  else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') f = { ...f, code: true };
  else if (tag === 'A') {
    const h = safeHref(el.getAttribute('href'));
    if (h) f = { ...f, href: h };
  }
  // inline styles carry formatting in pastes from Google Docs, Word and the web
  const st = el.style;
  if (st && el.getAttribute('style')) {
    const w = st.fontWeight;
    if (w) {
      const bold = w === 'bold' || w === 'bolder' || +w >= 600;
      if (bold !== !!f.b) f = { ...f, b: bold };
    }
    if (st.fontStyle) {
      const it = st.fontStyle === 'italic' || st.fontStyle === 'oblique';
      if (it !== !!f.i) f = { ...f, i: it };
    }
    const td = st.textDecorationLine || st.textDecoration || '';
    if (/line-through/.test(td)) f = { ...f, s: true };
    if (/monospace|courier|consolas|menlo|monaco/i.test(st.fontFamily || '') && !f.code) f = { ...f, code: true };
  }
  return f;
}

// Flatten a node's inline content into runs. Pictures met along the way
// come back as {imgEl} markers so the caller can lift them out as blocks.
function collectNode(node, fmt, ctx, out = []) {
  if (node.nodeType === 3) {
    let t = node.data;
    if (ctx.loose) t = t.replace(/[\t\n\r ]+/g, ' ');
    t = t.replace(/ /g, ' ').replace(/[​﻿]/g, '');
    if (t) out.push({ ...fmt, text: t });
    return out;
  }
  if (node.nodeType !== 1) return out;
  const tag = node.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return out;
  if (node.classList.contains('ph-mark')) {
    if (ctx.marks) out.push({ mark: node.dataset.sid || '' });
    return out;
  }
  if (node.classList.contains('darling-anchor')) return out;
  if (tag === 'BR') { out.push({ ...fmt, text: '\n' }); return out; }
  if (tag === 'IMG') { out.push({ imgEl: node }); return out; }
  const f = elFmt(node, fmt);
  // a block met inside inline flow (a <p> inside an <li>) starts a new line
  const blocky = /^(P|DIV|H[1-6]|LI|TR|BLOCKQUOTE|PRE|DT|DD|UL|OL)$/.test(tag);
  if (blocky && out.length && !/\n$/.test(out[out.length - 1].text || '')) out.push({ ...fmt, text: '\n' });
  for (const c of node.childNodes) collectNode(c, f, ctx, out);
  return out;
}
const collectRuns = (el, fmt, ctx) => {
  const out = [];
  for (const c of el.childNodes) collectNode(c, fmt, ctx, out);
  return out;
};

// merge neighbours that look the same, drop the empties, and lose the
// engine's placeholder <br> at the end of a block
function tidyRuns(runs, opts = {}) {
  const out = [];
  for (const r of runs) {
    if (r.imgEl) continue;
    if (r.mark !== undefined) { out.push(r); continue; }
    if (!r.text) continue;
    const last = out[out.length - 1];
    const clean = {};
    for (const k of FMT_KEYS) if (r[k]) clean[k] = r[k];
    clean.text = r.text;
    if (last && last.mark === undefined && sameFmt(last, clean)) last.text += clean.text;
    else out.push(clean);
  }
  while (out.length) {
    const l = out[out.length - 1];
    if (l.mark !== undefined) break;
    l.text = opts.trim ? l.text.replace(/\s+$/, '') : l.text.replace(/\n+$/, '');
    if (l.text) break;
    out.pop();
  }
  if (opts.trim) {
    while (out.length) {
      const f = out[0];
      if (f.mark !== undefined) break;
      f.text = f.text.replace(/^\s+/, '');
      if (f.text) break;
      out.shift();
    }
  }
  return out;
}

/* ---------- HTML → blocks ---------- */

function alignOf(el) {
  const a = ((el.style && el.style.textAlign) || el.getAttribute('align') || '').toLowerCase();
  return a === 'center' || a === 'right' || a === 'justify' ? a : '';
}

function imageBlock(img, ctx) {
  const src = safeImgSrc(img.dataset.src || img.getAttribute('src'));
  if (!src) return null;
  const fig = img.closest('figure');
  const cap = fig && fig.querySelector('figcaption');
  return {
    type: 'image',
    src,
    alt: (img.getAttribute('alt') || '').trim(),
    caption: cap ? cap.textContent.trim() : (img.getAttribute('title') || '').trim(),
    width: snapWidth((fig && +fig.dataset.width) || 0),
    bookId: ctx.bookId || null,
    // where the picture was showing from (paste from another book)
    shown: ctx.loose ? (img.getAttribute('src') || '') : undefined
  };
}

// a paragraph's runs, split wherever a picture sits inside it
function paragraphBlocks(runs, align, ctx, type = 'p', poetry = false) {
  const blocks = [];
  let cur = [];
  const end = () => {
    const r = tidyRuns(cur, { trim: ctx.loose || ctx.trim });
    if (runsHaveContent(r)) blocks.push(poetry ? { type, runs: r, align, poetry: true } : { type, runs: r, align });
    cur = [];
  };
  for (const r of runs) {
    // Word, Apple Notes and Google Docs mark a paragraph with a line break
    // as often as with a block, so in pasted text every break is a paragraph
    if (ctx.loose && !poetry && r.text && r.text.includes('\n')) {
      r.text.split('\n').forEach((piece, k) => {
        if (k > 0) end();
        if (piece) cur.push({ ...r, text: piece });
      });
      continue;
    }
    if (r.imgEl) {
      end();
      const ib = imageBlock(r.imgEl, ctx);
      if (ib) blocks.push(ib);
    } else cur.push(r);
  }
  end();
  return blocks;
}

function preText(el) {
  let t = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) t += c.data;
      else if (c.nodeType === 1) {
        const tg = c.tagName.toUpperCase();
        if (tg === 'BR') { t += '\n'; continue; }
        const blk = tg === 'DIV' || tg === 'P';
        if (blk && t && !t.endsWith('\n')) t += '\n';
        walk(c);
        if (blk && !t.endsWith('\n')) t += '\n';
      }
    }
  };
  walk(el);
  return t.replace(/ /g, ' ').replace(/[​﻿]/g, '').replace(/\n$/, '');
}

function parseList(el, ctx, fmt) {
  const ordered = el.tagName.toUpperCase() === 'OL';
  const list = { type: 'list', ordered, start: ordered ? (parseInt(el.getAttribute('start'), 10) || 1) : 1, task: false, items: [] };
  for (const c of el.childNodes) {
    if (c.nodeType === 3) {
      if (c.data.trim()) list.items.push({ runs: tidyRuns([{ text: c.data }], { trim: true }), checked: null, children: [] });
      continue;
    }
    if (c.nodeType !== 1) continue;
    const tg = c.tagName.toUpperCase();
    if (tg === 'UL' || tg === 'OL') {
      // the engine nests an indented list straight inside its parent list
      let prev = list.items[list.items.length - 1];
      if (!prev) { prev = { runs: [], checked: null, children: [] }; list.items.push(prev); }
      prev.children.push(parseList(c, ctx, fmt));
      continue;
    }
    list.items.push(listItem(c, ctx, fmt));
  }
  if (el.classList.contains('tasks') || list.items.some((i) => i.checked !== null)) {
    list.task = true;
    for (const i of list.items) if (i.checked === null) i.checked = false;
  }
  return list;
}

function listItem(li, ctx, fmt) {
  const item = { runs: [], checked: null, children: [] };
  if (li.dataset && li.dataset.checked != null) item.checked = li.dataset.checked === 'true';
  else {
    // GitHub-style HTML: <li><input type="checkbox" checked> …</li>
    const box = li.querySelector('input[type=checkbox]');
    if (box && box.closest('li') === li) item.checked = box.checked || box.hasAttribute('checked');
  }
  const runs = [];
  for (const c of li.childNodes) {
    if (c.nodeType === 1 && /^(UL|OL)$/i.test(c.tagName)) { item.children.push(parseList(c, ctx, fmt)); continue; }
    collectNode(c, fmt, ctx, runs);
  }
  item.runs = tidyRuns(runs, { trim: true });
  // "[ ] " and "[x] " typed or pasted as text
  const f = item.runs[0];
  if (item.checked === null && f && f.text) {
    const m = f.text.match(/^\[([ xX])\]\s+/) || f.text.match(/^([☐☑☒])\s*/);
    if (m) {
      item.checked = m[1] === 'x' || m[1] === 'X' || m[1] === '☑' || m[1] === '☒';
      f.text = f.text.slice(m[0].length);
      if (!f.text) item.runs.shift();
    }
  }
  return item;
}

function parseTable(el, ctx) {
  const rows = [];
  for (const tr of el.rows || []) {
    const cells = [...tr.cells].map((td) => ({
      runs: tidyRuns(collectRuns(td, {}, ctx), { trim: true }),
      align: alignOf(td)
    }));
    if (!cells.length) continue;
    const header = tr.parentElement.tagName === 'THEAD' || [...tr.cells].every((c) => c.tagName === 'TH');
    rows.push({ header, cells });
  }
  if (!rows.length) return [];
  const cols = Math.max(...rows.map((r) => r.cells.length));
  for (const r of rows) while (r.cells.length < cols) r.cells.push({ runs: [], align: '' });
  return [{ type: 'table', rows }];
}

function blockFromEl(el, ctx, fmt) {
  const tag = el.tagName.toUpperCase();
  switch (tag) {
    case 'P':
      if (el.classList.contains('scene-break')) return [{ type: 'break' }];
      return paragraphBlocks(collectRuns(el, elFmt(el, fmt), ctx), alignOf(el), ctx, 'p', el.classList.contains('poetry'));
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const runs = tidyRuns(collectRuns(el, fmt, ctx), { trim: true });
      if (!runsHaveContent(runs)) return [];
      if (ctx.loose) for (const r of runs) delete r.b; // headings are bold already
      return [{ type: 'heading', level: +tag[1], runs, align: alignOf(el) }];
    }
    case 'BLOCKQUOTE': {
      const inner = parseBlocks(el, ctx, fmt);
      return inner.length ? [{ type: 'quote', blocks: inner }] : [];
    }
    case 'UL': case 'OL': {
      const l = parseList(el, ctx, fmt);
      return l.items.length ? [l] : [];
    }
    case 'LI':
      return [{ type: 'list', ordered: false, start: 1, task: false, items: [listItem(el, ctx, fmt)] }];
    case 'PRE': {
      const code = el.querySelector('code');
      const lang = el.dataset.lang || ((code && code.className.match(/language-([\w+#.-]+)/)) || [])[1] || '';
      return [{ type: 'code', lang, text: preText(el) }];
    }
    case 'TABLE':
      return parseTable(el, ctx);
    case 'FIGURE': {
      const img = el.querySelector('img');
      if (img) {
        const b = imageBlock(img, ctx);
        return b ? [b] : [];
      }
      return parseBlocks(el, ctx, fmt);
    }
    case 'HR':
      return [{ type: 'hr' }];
    default:
      if (el.querySelector(BLOCKISH)) return parseBlocks(el, ctx, elFmt(el, fmt));
      return paragraphBlocks(collectRuns(el, elFmt(el, fmt), ctx), alignOf(el), ctx);
  }
}

// ctx: {loose: pasted/foreign HTML, marks: keep placeholder flags, bookId}
function parseBlocks(container, ctx = {}, fmt = {}) {
  const out = [];
  let pend = null;
  const flush = () => {
    if (pend) out.push(...paragraphBlocks(pend, '', ctx));
    pend = null;
  };
  for (const node of container.childNodes) {
    if (node.nodeType === 3) {
      if (!pend && !node.data.trim()) continue;
      collectNode(node, fmt, ctx, (pend = pend || []));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === 'BR') { flush(); continue; }
    if (!node.matches(BLOCKISH)) {
      // an inline wrapper hiding whole paragraphs (Google Docs does this)
      if (node.querySelector(BLOCKISH)) { flush(); out.push(...parseBlocks(node, ctx, elFmt(node, fmt))); continue; }
      collectNode(node, fmt, ctx, (pend = pend || []));
      continue;
    }
    flush();
    out.push(...blockFromEl(node, ctx, fmt));
  }
  flush();
  return out;
}

function parseHtmlString(html, ctx) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return parseBlocks(doc.body, ctx);
}

/* ---------- blocks → HTML (editor + exports share this) ---------- */

const escAttr = (s) => escXml(s);

// o: {xml: EPUB flavour, href(h) → h|null, marks: keep placeholder flags}
function runsHtml(runs, o = {}) {
  const esc = o.xml ? escXml : escHtml;
  const tb = o.xml ? 'strong' : 'b';
  const ti = o.xml ? 'em' : 'i';
  const br = o.xml ? '<br/>' : '<br>';
  let html = '';
  let i = 0;
  while (i < runs.length) {
    const r = runs[i];
    if (r.mark !== undefined) {
      if (o.marks && r.mark) html += `<span class="ph-mark" data-sid="${escAttr(r.mark)}" contenteditable="false">⚑</span>`;
      i++;
      continue;
    }
    let j = i;
    let inner = '';
    while (j < runs.length && runs[j].mark === undefined && (runs[j].href || null) === (r.href || null)) {
      const x = runs[j];
      let t = esc(x.text).replace(/\n/g, br);
      if (x.code) t = `<code>${t}</code>`;
      if (x.s) t = `<s>${t}</s>`;
      if (x.i) t = `<${ti}>${t}</${ti}>`;
      if (x.b) t = `<${tb}>${t}</${tb}>`;
      inner += t;
      j++;
    }
    const href = r.href ? (o.href ? o.href(r.href) : r.href) : null;
    html += href ? `<a href="${escAttr(href)}">${inner}</a>` : inner;
    i = j;
  }
  return html;
}

function listHtml(b, o, itemHtml) {
  const tag = b.ordered ? 'ol' : 'ul';
  const attrs = (b.task ? ' class="tasks"' : '') + (b.ordered && b.start > 1 ? ` start="${b.start}"` : '');
  return `<${tag}${attrs}>${b.items.map((it) => itemHtml(it, b) + '').join('')}</${tag}>`;
}

function tableHtml(b, o, empty) {
  const cell = (c, th) => {
    const t = th ? 'th' : 'td';
    return `<${t}${c.align ? ` style="text-align:${c.align}"` : ''}>${runsHtml(c.runs, o) || empty}</${t}>`;
  };
  const head = b.rows[0] && b.rows[0].header ? b.rows[0] : null;
  const rows = head ? b.rows.slice(1) : b.rows;
  return `<table>${head ? `<thead><tr>${head.cells.map((c) => cell(c, true)).join('')}</tr></thead>` : ''}` +
    `<tbody>${rows.map((r) => `<tr>${r.cells.map((c) => cell(c, r.header)).join('')}</tr>`).join('')}</tbody></table>`;
}

function figureHtml(b) {
  const url = mediaUrl(b.src, b.bookId || (book && book.id));
  const w = b.width && b.width < 100 ? ` data-width="${b.width}"` : '';
  return `<figure class="neo-img" contenteditable="false"${w}><img data-src="${escAttr(b.src)}" src="${escAttr(url)}" alt="${escAttr(b.alt || b.caption || '')}" draggable="false">` +
    `${b.caption ? `<figcaption>${escHtml(b.caption)}</figcaption>` : ''}</figure>`;
}

// the editor's own storage format (what chapters/*.html hold)
function blocksToEditorHtml(blocks) {
  const o = { marks: true };
  const item = (it, list) =>
    `<li${list.task ? ` data-checked="${it.checked ? 'true' : 'false'}"` : ''}>${runsHtml(it.runs, o) || '<br>'}` +
    `${it.children.map((c) => listHtml(c, o, item)).join('')}</li>`;
  return blocks.map((b) => {
    switch (b.type) {
      case 'p': return `<p${b.poetry ? ' class="poetry"' : ''}${b.align ? ` style="text-align:${b.align}"` : ''}>${runsHtml(b.runs, o) || '<br>'}</p>`;
      case 'break': return '<p class="scene-break">***</p>';
      case 'heading': {
        const l = clampLevel(b.level);
        return `<h${l}${b.align ? ` style="text-align:${b.align}"` : ''}>${runsHtml(b.runs, o) || '<br>'}</h${l}>`;
      }
      case 'quote': return `<blockquote>${blocksToEditorHtml(b.blocks) || '<p><br></p>'}</blockquote>`;
      case 'list': return listHtml(b, o, item);
      case 'code': return `<pre${b.lang ? ` data-lang="${escAttr(b.lang)}"` : ''}>${escHtml(b.text) || '<br>'}</pre>`;
      case 'hr': return '<hr>';
      case 'table': return tableHtml(b, o, '<br>');
      case 'image': return figureHtml(b);
      default: return '';
    }
  }).join('');
}

/* ---------- block text, for word counts and plain text ---------- */

function blockPlainText(b) {
  switch (b.type) {
    case 'p': case 'heading': return runsText(b.runs);
    case 'quote': return b.blocks.map(blockPlainText).join('\n');
    case 'list': return b.items.map((it) => runsText(it.runs) + '\n' + it.children.map(blockPlainText).join('\n')).join('\n');
    case 'code': return b.text;
    case 'table': return b.rows.map((r) => r.cells.map((c) => runsText(c.runs)).join(' ')).join('\n');
    case 'image': return b.caption || '';
    default: return '';
  }
}
const blocksWordCount = (blocks) => blocks.reduce((n, b) => n + countWords(blockPlainText(b)), 0);

// every block, however deeply it sits (quotes hold blocks)
function* walkBlocks(blocks) {
  for (const b of blocks) {
    yield b;
    if (b.type === 'quote') yield* walkBlocks(b.blocks);
  }
}

/* ================================================================== */
/*  MARKDOWN → blocks                                                  */
/*  CommonMark's everyday syntax plus GitHub's tables, strikethrough,  */
/*  task lists and bare-URL links, and Obsidian's ![[embeds]].         */
/* ================================================================== */

const LIST_RE = /^( {0,3})([-+*]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const indentOf = (l) => l.match(/^ */)[0].length;
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

function joinPath(base, rel) {
  const out = [];
  for (const p of (String(base).replace(/\/+$/, '') + '/' + rel).split('/')) {
    if (p === '..') out.pop();
    else if (p !== '.' && (p !== '' || !out.length)) out.push(p);
  }
  return out.join('/') || '/';
}

function decodeEntity(e) {
  const t = document.createElement('textarea');
  t.innerHTML = e;
  return t.value;
}

function findTicks(s, from, len) {
  let j = from;
  while ((j = s.indexOf('`', j)) !== -1) {
    let k = j;
    while (s[k] === '`') k++;
    if (k - j === len) return j;
    j = k;
  }
  return -1;
}

// opts: {base: folder the .md came from, copyLocal: copy local pictures in}
function mdDocument(src, opts = {}) {
  let lines = String(src || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const meta = {};
  // YAML front matter (Obsidian, Jekyll, Hugo…): title and author are kept
  if (/^---\s*$/.test(lines[0] || '')) {
    const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0 && end < 300) {
      for (const l of lines.slice(1, end)) {
        const m = l.match(/^(title|author|subtitle):\s*["']?(.*?)["']?\s*$/i);
        if (m && m[2]) meta[m[1].toLowerCase()] = m[2];
      }
      lines = lines.slice(end + 1);
    }
  }
  const refs = {};
  let fenced = false;
  lines = lines.filter((l) => {
    if (/^ {0,3}(`{3,}|~{3,})/.test(l)) fenced = !fenced;
    if (fenced) return true;
    const m = l.match(/^ {0,3}\[([^\]^]+)\]:\s*<?([^\s>]+)>?(?:\s+["'(](.*)["')])?\s*$/);
    if (m) { refs[m[1].toLowerCase()] = { dest: m[2], title: m[3] || '' }; return false; }
    return true;
  });
  return { blocks: mdBlocks(lines, { refs, opts }), meta };
}
const mdToBlocks = (src, opts) => mdDocument(src, opts).blocks;

function mdBlocks(lines, ctx) {
  const out = [];
  let para = null;
  const flushPara = () => {
    if (para) out.push(...mdParagraph(para, ctx));
    para = null;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); i++; continue; }
    let m;
    // fenced code
    if ((m = line.match(/^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/))) {
      flushPara();
      const fence = m[2];
      const closeRe = new RegExp('^ {0,3}' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}[ \\t]*$');
      const strip = new RegExp('^ {0,' + m[1].length + '}');
      const body = [];
      i++;
      while (i < lines.length && !closeRe.test(lines[i])) body.push(lines[i++].replace(strip, ''));
      i++;
      out.push({ type: 'code', lang: m[3] || '', text: body.join('\n') });
      continue;
    }
    // ATX heading
    if ((m = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/))) {
      flushPara();
      out.push(mdHeading(m[1].length, m[2] || '', ctx));
      i++;
      continue;
    }
    // setext heading (a line underlined with === or ---)
    if (para && (m = line.match(/^ {0,3}(=+|-+)[ \t]*$/))) {
      const t = para.join(' ');
      para = null;
      out.push(mdHeading(m[1][0] === '=' ? 1 : 2, t, ctx));
      i++;
      continue;
    }
    // *** is a scene break (how NEO writes one); --- and ___ are rules
    if (HR_RE.test(line)) {
      flushPara();
      out.push(line.trim()[0] === '*' ? { type: 'break' } : { type: 'hr' });
      i++;
      continue;
    }
    // table: a header row, then a |---|:---:| delimiter row
    if (line.includes('|') && i + 1 < lines.length &&
        /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(lines[i + 1]) &&
        (lines[i + 1].includes('|') || line.trim().startsWith('|'))) {
      flushPara();
      const rows = [line];
      const delim = lines[i + 1];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(lines[i++]);
      out.push(mdTable(rows, delim, ctx));
      continue;
    }
    // block quote (Obsidian callouts "> [!note]" read as plain quotes)
    if (/^ {0,3}>/.test(line)) {
      flushPara();
      const body = [];
      while (i < lines.length && lines[i].trim()) {
        if (!/^ {0,3}>/.test(lines[i]) && (HR_RE.test(lines[i]) || LIST_RE.test(lines[i]) || /^ {0,3}#/.test(lines[i]))) break;
        body.push(lines[i].replace(/^ {0,3}> ?/, '').replace(/^\[!\w+\][-+]?\s*/, ''));
        i++;
      }
      const inner = mdBlocks(body, ctx);
      if (inner.length) out.push({ type: 'quote', blocks: inner });
      continue;
    }
    // list
    if (LIST_RE.test(line) && (LIST_RE.exec(line)[4] || !para)) {
      flushPara();
      const r = mdList(lines, i, ctx);
      out.push(r.block);
      i = r.next;
      continue;
    }
    // indented code (not in the middle of a paragraph)
    if (!para && /^ {4}/.test(line) && ctx.opts.indentedCode) {
      const body = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].replace(/^ {4}/, ''));
      while (body.length && !body[body.length - 1].trim()) body.pop();
      out.push({ type: 'code', lang: '', text: body.join('\n') });
      continue;
    }
    // raw HTML blocks
    if (!para && /^ {0,3}<(\/?)(p|div|table|figure|img|br|hr|h[1-6]|ul|ol|pre|blockquote|center|details|section|picture)\b/i.test(line)) {
      const body = [];
      while (i < lines.length && lines[i].trim()) body.push(lines[i++]);
      for (const b of parseHtmlString(body.join('\n'), { loose: true })) {
        if (b.type === 'image') {
          const fixed = mdImage(b.src, b.alt, b.caption, ctx);
          if (fixed) out.push({ ...fixed, width: b.width });
        } else out.push(b);
      }
      continue;
    }
    (para = para || []).push(line);
    i++;
  }
  flushPara();
  return out;
}

function mdHeading(level, text, ctx) {
  return { type: 'heading', level, runs: tidyRuns(mdInline(text, {}, ctx).filter((r) => !r.mdImg), { trim: true }), align: '' };
}

// lines of one paragraph: soft breaks become spaces, two trailing spaces
// or a trailing backslash make a real line break
function mdParagraph(lines, ctx) {
  let text = '';
  lines.forEach((l, k) => {
    const s = l.replace(/^[ \t]+/, '');
    if (k === lines.length - 1) text += s.replace(/\s+$/, '');
    else if (/ {2,}$/.test(l)) text += s.replace(/\s+$/, '') + '\n';
    else if (/\\$/.test(l)) text += s.slice(0, -1) + '\n';
    else text += s.replace(/\s+$/, '') + ' ';
  });
  return splitMdImages(mdInline(text, {}, ctx));
}

function splitMdImages(runs, align = '') {
  const blocks = [];
  let cur = [];
  const end = () => {
    const r = tidyRuns(cur, { trim: true });
    const prev = blocks[blocks.length - 1];
    // an all-italic short line right under a picture is its caption
    if (prev && prev.type === 'image' && !prev.caption && r.length && r.every((x) => x.i && !x.href) && runsText(r).trim().length < 200) {
      prev.caption = runsText(r).trim();
    } else if (runsHaveContent(r)) blocks.push({ type: 'p', runs: r, align });
    cur = [];
  };
  for (const r of runs) {
    if (r.mdImg !== undefined) { end(); if (r.mdImg) blocks.push(r.mdImg); } else cur.push(r);
  }
  end();
  return blocks;
}

function mdList(lines, start, ctx) {
  const first = LIST_RE.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const baseIndent = first[1].length;
  const list = { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, task: false, items: [] };
  let i = start;
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m || Math.abs(m[1].length - baseIndent) > 1 || /\d/.test(m[2]) !== ordered) break;
    const gap = m[3] ? m[3].length : 1;
    const contentOffset = m[1].length + m[2].length + (gap > 4 ? 1 : gap);
    const body = [m[4] || ''];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        // a blank line carries on only if what follows is indented into the item
        let k = i + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && indentOf(lines[k]) >= Math.min(contentOffset, baseIndent + 2)) {
          for (; i < k; i++) body.push('');
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind >= contentOffset || (ind >= baseIndent + 2 && LIST_RE.test(l))) {
        body.push(l.slice(Math.min(ind, contentOffset)));
        i++;
        continue;
      }
      if (LIST_RE.test(l) || HR_RE.test(l) || /^ {0,3}(#|>|```|~~~)/.test(l)) break;
      body.push(l.trim()); // lazy continuation of the item's paragraph
      i++;
    }
    const item = { runs: [], checked: null, children: [] };
    const tm = body[0].match(/^\[([ xX])\][ \t]+/);
    if (tm) { item.checked = tm[1] !== ' '; body[0] = body[0].slice(tm[0].length); }
    for (const b of mdBlocks(body, ctx)) {
      if (b.type === 'list') { item.children.push(b); continue; }
      const t = b.type === 'p' || b.type === 'heading' ? b.runs : (blockPlainText(b) || b.alt ? [{ text: blockPlainText(b) || b.alt, code: b.type === 'code' }] : []);
      if (!t.length) continue;
      if (item.runs.length) item.runs.push({ text: '\n' });
      item.runs.push(...t);
    }
    item.runs = tidyRuns(item.runs, { trim: true });
    list.items.push(item);
  }
  if (list.items.some((it) => it.checked !== null)) {
    list.task = true;
    for (const it of list.items) if (it.checked === null) it.checked = false;
  }
  return { block: list, next: i };
}

function mdSplitRow(l) {
  let s = l.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let code = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function mdTable(rowLines, delim, ctx) {
  const aligns = mdSplitRow(delim).map((d) => (/^:-+:$/.test(d) ? 'center' : /^-+:$/.test(d) ? 'right' : ''));
  const cols = aligns.length;
  const rows = rowLines.map((l, k) => {
    const raw = mdSplitRow(l);
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const txt = (raw[c] || '').replace(/<br\s*\/?>/gi, '\n');
      cells.push({ runs: tidyRuns(mdInline(txt, {}, ctx).filter((r) => !r.mdImg), { trim: true }), align: aligns[c] });
    }
    return { header: k === 0, cells };
  });
  return { type: 'table', rows };
}

function mdHref(dest, ctx) {
  dest = String(dest || '').trim();
  if (!dest || dest.startsWith('#')) return null;
  if (hasScheme(dest)) return safeHref(dest);
  if (/^www\./i.test(dest) || dest.startsWith('~/')) return normalizeHref(dest);
  if (dest.startsWith('/')) return fileUrlFromPath(safeDecode(dest));
  const base = ctx.opts && ctx.opts.base;
  if (base) return fileUrlFromPath(joinPath(base, safeDecode(dest)));
  return safeHref(dest); // relative: a file inside the book folder
}

function mdImage(dest, alt, title, ctx) {
  dest = String(dest || '').trim();
  const o = ctx.opts || {};
  const b = { type: 'image', src: '', alt: alt || '', caption: title || '', width: 0, bookId: null };
  let local = null;
  if (/^(https?|data):/i.test(dest)) b.src = safeImgSrc(dest);
  else if (/^file:/i.test(dest)) { b.src = dest; local = pathFromFileUrl(dest); }
  else {
    let p = safeDecode(dest);
    if (p.startsWith('~/') && homeDir) p = homeDir + p.slice(1);
    if (p.startsWith('/')) local = p;
    else if (o.base) local = joinPath(o.base, p);
    b.src = local ? fileUrlFromPath(local) : safeImgSrc(dest);
  }
  if (!b.src) return null;
  if (local && o.copyLocal) b.pending = { kind: 'path', path: local };
  return b;
}

function mdInline(src, fmt = {}, ctx = {}) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ ...fmt, text: buf }); buf = ''; } };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '\\' && i + 1 < n && /[!-/:-@[-`{-~]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (c === '`') {
      let k = i;
      while (src[k] === '`') k++;
      const close = findTicks(src, k, k - i);
      if (close >= 0) {
        flush();
        let code = src.slice(k, close).replace(/\n/g, ' ');
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        out.push({ ...fmt, code: true, text: code });
        i = close + (k - i);
        continue;
      }
      buf += src.slice(i, k);
      i = k;
      continue;
    }
    if (c === '!' && src[i + 1] === '[') {
      if (src[i + 2] === '[') { // Obsidian ![[embed]]
        const e = src.indexOf(']]', i + 3);
        if (e > 0) {
          const [target, alias] = src.slice(i + 3, e).split('|').map((s) => s.trim());
          flush();
          if (IMG_FILE_RE.test(target)) out.push({ mdImg: mdImage(target, alias && !/^\d+(x\d+)?$/.test(alias) ? alias : '', '', ctx) });
          else out.push(...wikiLink(target, alias, fmt, ctx));
          i = e + 2;
          continue;
        }
      }
      const lk = parseMdLink(src, i + 1, ctx);
      if (lk) {
        flush();
        out.push({ mdImg: mdImage(lk.dest, runsText(mdInline(lk.text, {}, ctx)), lk.title, ctx) });
        i = lk.end;
        continue;
      }
    }
    if (c === '[') {
      if (src[i + 1] === '[') { // Obsidian [[wiki link|alias]]
        const e = src.indexOf(']]', i + 2);
        if (e > 0) {
          const [target, alias] = src.slice(i + 2, e).split('|').map((s) => s.trim());
          flush();
          out.push(...wikiLink(target, alias, fmt, ctx));
          i = e + 2;
          continue;
        }
      }
      const lk = parseMdLink(src, i, ctx);
      if (lk) {
        flush();
        const href = mdHref(lk.dest, ctx);
        out.push(...mdInline(lk.text, href ? { ...fmt, href } : fmt, ctx));
        i = lk.end;
        continue;
      }
    }
    if (c === '<') {
      const rest = src.slice(i);
      let m;
      if ((m = rest.match(/^<([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>/i))) {
        flush();
        const h = safeHref(m[1]);
        out.push(h ? { ...fmt, href: h, text: m[1] } : { ...fmt, text: m[1] });
        i += m[0].length;
        continue;
      }
      if ((m = rest.match(/^<([^\s<>@]+@[^\s<>@]+\.[a-z]{2,})>/i))) {
        flush();
        out.push({ ...fmt, href: 'mailto:' + m[1], text: m[1] });
        i += m[0].length;
        continue;
      }
      if ((m = rest.match(/^<br\s*\/?>/i))) { buf += '\n'; i += m[0].length; continue; }
      if ((m = rest.match(/^<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/i))) {
        flush();
        const h = mdHref(m[1], ctx);
        out.push(...mdInline(m[2], h ? { ...fmt, href: h } : fmt, ctx));
        i += m[0].length;
        continue;
      }
      if ((m = rest.match(/^<img\s[^>]*>/i))) {
        flush();
        const img = new DOMParser().parseFromString(m[0], 'text/html').querySelector('img');
        if (img) out.push({ mdImg: mdImage(img.getAttribute('src'), img.getAttribute('alt') || '', img.getAttribute('title') || '', ctx) });
        i += m[0].length;
        continue;
      }
      if ((m = rest.match(/^<(b|strong|i|em|s|del|strike|code|kbd|u|mark|sub|sup|span|small)(\s[^>]*)?>/i))) {
        const tag = m[1].toLowerCase();
        const cm = rest.slice(m[0].length).match(new RegExp('</' + tag + '\\s*>', 'i'));
        if (cm) {
          flush();
          const f = /^(b|strong)$/.test(tag) ? { ...fmt, b: true } : /^(i|em)$/.test(tag) ? { ...fmt, i: true }
            : /^(s|del|strike)$/.test(tag) ? { ...fmt, s: true } : /^(code|kbd)$/.test(tag) ? { ...fmt, code: true } : fmt;
          out.push(...mdInline(rest.slice(m[0].length, m[0].length + cm.index), f, ctx));
          i += m[0].length + cm.index + cm[0].length;
          continue;
        }
      }
      if ((m = rest.match(/^<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>/i))) { i += m[0].length; continue; } // other tags: dropped
    }
    if (c === '*' || c === '_' || c === '~') {
      const em = parseEmphasis(src, i, fmt, ctx);
      if (em) { flush(); out.push(...em.runs); i = em.end; continue; }
      let k = i;
      while (src[k] === c) k++;
      buf += src.slice(i, k);
      i = k;
      continue;
    }
    if (c === '&') {
      const m = src.slice(i).match(/^&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i);
      if (m) { buf += decodeEntity(m[0]); i += m[0].length; continue; }
    }
    // bare web addresses become links
    if ((c === 'h' || c === 'w') && !fmt.href && (i === 0 || /[\s(“"'[]/.test(src[i - 1]))) {
      const m = src.slice(i).match(/^(https?:\/\/|www\.)[^\s<]*[^\s<?!.,:;*_~"'’”)\]]/i);
      if (m) {
        const h = normalizeHref(m[0]);
        if (h) { flush(); out.push({ ...fmt, href: h, text: m[0] }); i += m[0].length; continue; }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

function wikiLink(target, alias, fmt, ctx) {
  const text = alias || target.split('#')[0].split('/').pop() || target;
  const base = ctx.opts && ctx.opts.base;
  if (!base || !target) return [{ ...fmt, text }];
  const file = target.split('#')[0];
  const href = fileUrlFromPath(joinPath(base, /\.\w{1,5}$/.test(file) ? file : file + '.md'));
  return [{ ...fmt, href, text }];
}

function parseEmphasis(src, i, fmt, ctx) {
  const ch = src[i];
  let run = 0;
  while (src[i + run] === ch) run++;
  if (ch === '~' && run !== 2) return null;
  const after = src[i + run];
  if (!after || /\s/.test(after)) return null;
  if (ch === '_' && i > 0 && /[\p{L}\p{N}]/u.test(src[i - 1])) return null;
  for (let k = ch === '~' ? 2 : Math.min(run, 3); k >= 1; k--) {
    for (const exact of [true, false]) {
      let j = i + k;
      while (j < src.length) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '`') {
          let t = j;
          while (src[t] === '`') t++;
          const close = findTicks(src, t, t - j);
          j = close >= 0 ? close + (t - j) : t;
          continue;
        }
        if (c === ch) {
          let r = 0;
          while (src[j + r] === ch) r++;
          const before = src[j - 1];
          const ok = before && !/\s/.test(before) && j > i + k &&
            (ch !== '_' || !/[\p{L}\p{N}]/u.test(src[j + r] || '')) &&
            (exact ? r === k : r >= k);
          if (ok) {
            const f = { ...fmt };
            if (ch === '~') f.s = true;
            else {
              if (k !== 2) f.i = true;
              if (k >= 2) f.b = true;
            }
            return { runs: mdInline(src.slice(i + k, j), f, ctx), end: j + k };
          }
          j += r;
          continue;
        }
        j++;
      }
      if (ch === '~') break;
    }
  }
  return null;
}

function parseMdLink(src, i, ctx) {
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') {
      let t = j;
      while (src[t] === '`') t++;
      const close = findTicks(src, t, t - j);
      if (close >= 0) { j = close + (t - j) - 1; continue; }
    }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  if (j >= src.length) return null;
  const text = src.slice(i + 1, j);
  let k = j + 1;
  if (src[k] === '(') {
    k++;
    while (src[k] === ' ') k++;
    let dest = '';
    if (src[k] === '<') {
      const e = src.indexOf('>', k);
      if (e < 0) return null;
      dest = src.slice(k + 1, e);
      k = e + 1;
    } else {
      let par = 0;
      while (k < src.length) {
        const c = src[k];
        if (c === '\\' && k + 1 < src.length) { dest += src[k + 1]; k += 2; continue; }
        if (/\s/.test(c)) break;
        if (c === '(') par++;
        if (c === ')') { if (par === 0) break; par--; }
        dest += c;
        k++;
      }
    }
    while (src[k] === ' ' || src[k] === '\n') k++;
    let title = '';
    if (src[k] === '"' || src[k] === "'" || src[k] === '(') {
      const close = src[k] === '(' ? ')' : src[k];
      const e = src.indexOf(close, k + 1);
      if (e < 0) return null;
      title = src.slice(k + 1, e);
      k = e + 1;
      while (src[k] === ' ') k++;
    }
    if (src[k] !== ')') return null;
    return { text, dest, title, end: k + 1 };
  }
  const refs = ctx.refs || {};
  if (src[k] === '[') {
    const e = src.indexOf(']', k + 1);
    if (e >= 0) {
      const ref = refs[(src.slice(k + 1, e) || text).toLowerCase()];
      if (ref) return { text, dest: ref.dest, title: ref.title, end: e + 1 };
    }
  }
  const ref = refs[text.toLowerCase()];
  return ref ? { text, dest: ref.dest, title: ref.title, end: j + 1 } : null;
}

// plain text that is really markdown (pasted from a .md file, a chat, GitHub)
function looksLikeMarkdown(t) {
  const inline = /\[[^\]\n]+\]\([^)\s]+\)|!\[[^\]\n]*\]\([^)\s]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`|~~[^~\n]+~~/;
  const block = /^ {0,3}(#{1,6} |[-+*] |\d{1,3}[.)] |> |```|~~~|\|.*\|)/m;
  return block.test(t) || inline.test(t);
}

/* ================================================================== */
/*  EXPORTS                                                            */
/*  Each format gets the same blocks and renders them its own way:     */
/*  links stay links where the format can hold them, pictures are      */
/*  embedded where readers can't reach this Mac (EPUB, Word, PDF) and  */
/*  linked where they can (HTML, Markdown).                            */
/* ================================================================== */

// a chapter's stored HTML → export blocks (outline ghosts and flags removed)
function blocksFromChapterHtml(html, bookId) {
  const holder = document.createElement('template');
  holder.innerHTML = html || '';
  const root = holder.content;
  // an unwritten outline section is a ghost paragraph plus the scene break
  // NEO planted for it; neither belongs in a book
  root.querySelectorAll('p.ghost[data-sec-id]').forEach((g) => {
    const brk = root.querySelector(`p.scene-break[data-sec-brk="${g.dataset.secId}"]`);
    if (brk) brk.remove();
  });
  root.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  return parseBlocks(root, { bookId, trim: true });
}

/* ---------- pictures, fetched for formats that carry them inside ---------- */

// {base64, mime, ext, w, h} in a format every reader accepts (PNG/JPEG/GIF)
async function exportImage(b) {
  const raw = await window.neo.readAsset(b.bookId, b.src);
  if (!raw) return null;
  const url = `data:${raw.mime};base64,${raw.base64}`;
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { return null; }
  let w = img.naturalWidth || 800;
  let h = img.naturalHeight || 600;
  if (/^image\/(png|jpeg|gif)$/.test(raw.mime)) return { ...raw, w, h };
  // WebP, SVG, BMP, AVIF: redrawn as PNG
  const scale = Math.min(1, 3000 / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return { base64: c.toDataURL('image/png').split(',')[1], mime: 'image/png', ext: 'png', w, h };
}

// HTML and Markdown exports: the book's own pictures are copied into a
// "<name>_images" folder beside the file (main.js fills in the folder name)
function assetContext() {
  const assets = [];
  const names = new Map();
  return {
    assets,
    img(b) {
      if (hasScheme(b.src)) return b.src; // linked from disk or the web
      const key = b.bookId + '|' + b.src;
      if (!names.has(key)) {
        let name = baseName(b.src);
        const taken = new Set(assets.map((a) => a.name));
        for (let n = 2; taken.has(name); n++) name = name.replace(/(-\d+)?(\.\w+)?$/, `-${n}$2`);
        names.set(key, name);
        assets.push({ bookId: b.bookId, src: b.src, name });
      }
      return 'NEO-ASSET-DIR/' + encodeURIComponent(names.get(key));
    }
  };
}

/* ---------- plain text ---------- */

function runsToTxt(runs) {
  let s = '';
  let i = 0;
  while (i < runs.length) {
    const href = runs[i].href || null;
    let t = '';
    while (i < runs.length && (runs[i].href || null) === href) t += runs[i++].text || '';
    s += t;
    if (href && displayHref(href) !== t.trim()) s += ` (${displayHref(href)})`;
  }
  return s;
}

function tableToTxt(b) {
  const grid = b.rows.map((r) => r.cells.map((c) => runsToTxt(c.runs).replace(/\s*\n\s*/g, ' ')));
  const widths = grid[0].map((_, c) => Math.max(3, ...grid.map((r) => [...(r[c] || '')].length)));
  const line = (r) => r.map((t, c) => t + ' '.repeat(widths[c] - [...t].length)).join(' | ').replace(/\s+$/, '');
  const out = grid.map(line);
  if (b.rows[0].header) out.splice(1, 0, widths.map((w) => '-'.repeat(w)).join('-+-'));
  return out.join('\n');
}

function listToTxt(b, indent) {
  return b.items.map((it, k) => {
    const marker = b.task ? (it.checked ? '[x]' : '[ ]') : b.ordered ? `${b.start + k}.` : '-';
    const pad = indent + ' '.repeat(marker.length + 1);
    const lines = runsToTxt(it.runs).split('\n');
    let s = indent + marker + ' ' + lines[0] + lines.slice(1).map((l) => '\n' + pad + l).join('');
    for (const c of it.children) s += '\n' + listToTxt(c, pad);
    return s;
  }).join('\n');
}

function blocksToTxt(blocks, indent = '') {
  const ind = (s) => s.split('\n').map((l) => (l ? indent + l : l)).join('\n');
  return blocks.map((b) => {
    switch (b.type) {
      case 'p': return ind((b.poetry ? '    ' : '') + runsToTxt(b.runs));
      case 'break': return indent + '***';
      case 'heading': {
        const t = runsToTxt(b.runs);
        return ind(clampLevel(b.level) === 1 ? t.toUpperCase() : t);
      }
      case 'quote': return blocksToTxt(b.blocks, indent + '    ');
      case 'list': return listToTxt(b, indent);
      case 'code': return b.text.split('\n').map((l) => indent + '    ' + l).join('\n');
      case 'hr': return indent + '----------';
      case 'table': return ind(tableToTxt(b));
      case 'image': return ind(`[Image: ${b.caption || b.alt || baseName(b.src)}]` + (hasScheme(b.src) && !/^data:/.test(b.src) ? ` (${displayHref(b.src)})` : ''));
      default: return '';
    }
  }).filter((s) => s !== '').join('\n\n');
}

function buildTxt(data) {
  const d = data || bookExportData();
  let out = `${d.title.toUpperCase()}\n`;
  if (d.subtitle) out += `${d.subtitle}\n`;
  out += `by ${d.author}\n\n\n`;
  for (const ch of d.sections) {
    if (ch.heading) out += `${ch.heading.toUpperCase()}\n\n`;
    out += blocksToTxt(ch.blocks) + '\n\n\n';
  }
  return out;
}

/* ---------- markdown ---------- */

const mdEsc = (t) => t.replace(/([\\`*_[\]<~|])/g, '\\$1');
const mdUrl = (u) => (/[\s()<>]/.test(u) ? `<${u.replace(/>/g, '%3E')}>` : u);

// wrap a run in its markers, keeping boundary spaces outside them
function mdRun(r) {
  let t;
  if (r.code) {
    let fence = '`';
    while (r.text.includes(fence)) fence += '`';
    t = fence + (/^`|`$/.test(r.text) ? ' ' + r.text + ' ' : r.text) + fence;
  } else t = mdEsc(r.text);
  const mark = (r.b && r.i ? '***' : r.b ? '**' : r.i ? '*' : '') + '';
  const strike = r.s ? '~~' : '';
  if (!mark && !strike) return t.replace(/\n/g, '\\\n');
  const lead = t.match(/^\s*/)[0];
  const trail = t.match(/\s*$/)[0];
  const core = t.slice(lead.length, t.length - trail.length);
  return (core ? lead + strike + mark + core + mark + strike + trail : t).replace(/\n/g, '\\\n');
}

function runsToMd(runs) {
  let s = '';
  let i = 0;
  while (i < runs.length) {
    const href = runs[i].href || null;
    let t = '';
    const start = i;
    while (i < runs.length && (runs[i].href || null) === href) t += mdRun(runs[i++]);
    const plainUrl = href && i - start === 1 && !runs[start].b && !runs[start].i && !runs[start].code && runs[start].text === href;
    s += plainUrl ? `<${href}>` : href ? `[${t}](${mdUrl(href)})` : t;
  }
  return s;
}

// a paragraph that happens to start like a markdown block stays prose
const mdLineSafe = (s) => s.replace(/^(\s*)(#{1,6}\s|[-+]\s|\d+[.)]\s|>)/, (m, sp, x) => sp + '\\' + x);

function listToMd(b, indent) {
  return b.items.map((it, k) => {
    const marker = b.ordered ? `${b.start + k}.` : '-';
    const pad = indent + ' '.repeat(marker.length + 1);
    const lines = runsToMd(it.runs).split('\n');
    let s = indent + marker + ' ' + (b.task ? (it.checked ? '[x] ' : '[ ] ') : '') + lines[0] +
      lines.slice(1).map((l) => '\n' + pad + l).join('');
    for (const c of it.children) s += '\n' + listToMd(c, pad);
    return s;
  }).join('\n');
}

function tableToMd(b) {
  const cell = (c) => runsToMd(c.runs).replace(/\\\n/g, '<br>').replace(/\|/g, '\\|') || ' ';
  const head = b.rows[0];
  const line = (r) => '| ' + r.cells.map(cell).join(' | ') + ' |';
  const delim = '| ' + head.cells.map((c) => (c.align === 'center' ? ':---:' : c.align === 'right' ? '---:' : '---')).join(' | ') + ' |';
  return [line(head), delim, ...b.rows.slice(1).map(line)].join('\n');
}

// headOffset: how many # the book's own title and chapter headings use
function blocksToMd(blocks, ctx, headOffset = 2) {
  return blocks.map((b) => {
    switch (b.type) {
      case 'p': return (b.poetry ? '> ' : '') + mdLineSafe(runsToMd(b.runs));
      case 'break': return '***';
      case 'heading': return '#'.repeat(Math.min(6, clampLevel(b.level) + headOffset)) + ' ' + runsToMd(b.runs).replace(/\\\n/g, ' ');
      case 'quote': return blocksToMd(b.blocks, ctx, headOffset).split('\n').map((l) => (l ? '> ' + l : '>')).join('\n');
      case 'list': return listToMd(b, '');
      case 'code': {
        let fence = '```';
        while (b.text.includes(fence)) fence += '`';
        return `${fence}${b.lang || ''}\n${b.text}\n${fence}`;
      }
      case 'hr': return '---';
      case 'table': return tableToMd(b);
      case 'image': {
        // plain ![alt](path): the "title" form breaks pictures in Obsidian and
        // other viewers, so the caption goes on its own italic line instead
        const src = ctx.img(b);
        const alt = (b.alt || b.caption || '').replace(/([[\]\\])/g, '\\$1');
        return `![${alt}](${mdUrl(src)})` + (b.caption ? `\n*${mdEsc(b.caption)}*` : '');
      }
      default: return '';
    }
  }).filter((s) => s !== '').join('\n\n');
}

function buildMd(data, ctx) {
  const d = data || bookExportData();
  ctx = ctx || assetContext();
  let out = `# ${d.title}\n\n`;
  if (d.subtitle) out += `*${d.subtitle}*\n\n`;
  out += `**by ${d.author}**\n\n`;
  // body headings sit under the chapter headings, or straight under the title
  const offset = d.sections.some((ch) => ch.heading) ? 2 : 1;
  for (const ch of d.sections) {
    if (ch.heading) out += `\n## ${ch.heading}\n\n`;
    const body = blocksToMd(ch.blocks, ctx, offset);
    if (body) out += body + '\n\n';
  }
  return out;
}

/* ---------- HTML (web page, PDF, email snapshot, EPUB chapters) ---------- */

// ctx: {xml, img(b) → src|null, href(h) → h|null, headOffset, brk, first}
function blocksToHtml(blocks, ctx) {
  const o = { xml: ctx.xml, href: ctx.href };
  const esc = ctx.xml ? escXml : escHtml;
  const item = (it, list) =>
    `<li${list.task ? ' class="task"' : ''}>${list.task ? `<span class="box">${it.checked ? '☑' : '☐'}</span> ` : ''}` +
    `${runsHtml(it.runs, o)}${it.children.map((c) => listHtml(c, o, item)).join('')}</li>`;
  return blocks.map((b) => {
    const wasFirst = ctx.first;
    ctx.first = false;
    switch (b.type) {
      case 'p': {
        const cls = [];
        if (b.poetry) { cls.push('poetry'); ctx.first = wasFirst; } // the opener is the first line that isn't poetry
        else if (wasFirst) cls.push('first');
        if (b.align) cls.push(b.align);
        return `<p${cls.length ? ` class="${cls.join(' ')}"` : ''}>${runsHtml(b.runs, o)}</p>`;
      }
      case 'break': ctx.first = true; return `<p class="brk">${ctx.brk || '***'}</p>`;
      case 'heading': {
        ctx.first = true;
        const l = Math.min(6, clampLevel(b.level) + (ctx.headOffset || 0));
        return `<h${l}${b.align ? ` class="${b.align}"` : ''}>${runsHtml(b.runs, o)}</h${l}>`;
      }
      case 'quote': {
        const inner = blocksToHtml(b.blocks, ctx);
        ctx.first = true;
        return `<blockquote>${inner}</blockquote>`;
      }
      case 'list': ctx.first = true; return listHtml(b, o, item);
      case 'code': ctx.first = true; return `<pre><code${b.lang ? ` class="language-${esc(b.lang)}"` : ''}>${esc(b.text)}</code></pre>`;
      case 'hr': ctx.first = true; return ctx.xml ? '<hr/>' : '<hr>';
      case 'table': ctx.first = true; return tableHtml(b, o, '');
      case 'image': {
        ctx.first = true;
        const src = ctx.img(b);
        const label = b.caption || b.alt || baseName(b.src);
        if (!src) return `<p class="missing">[Image: ${esc(label)}]</p>`;
        const w = b.width && b.width < 100 ? ` style="width:${b.width}%"` : '';
        return `<figure${w}><img src="${escXml(src)}" alt="${escXml(b.alt || b.caption || '')}"${ctx.xml ? '/' : ''}>` +
          `${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
      }
      default: return '';
    }
  }).join('\n');
}

// styling shared by the web page, PDF and EPUB for the new elements
const RICH_EXPORT_CSS = `
  a { color: #7a5a1e; }
  blockquote { margin: 1em 0 1em 0.4em; padding: 0 0 0 1.1em; border-left: 3px solid #c9a86a; color: #444; }
  blockquote p { text-indent: 0 !important; }
  ul, ol { margin: 0.7em 0; padding-left: 1.8em; }
  li { margin: 0.2em 0; }
  li ul, li ol { margin: 0.1em 0; }
  ul.tasks { list-style: none; padding-left: 0.3em; }
  ul.tasks .box { display: inline-block; width: 1.2em; }
  pre { font-family: Menlo, Consolas, "Courier New", monospace; font-size: 0.82em; line-height: 1.5;
        background: #f5f3ee; border: 1px solid #e3ddcf; border-radius: 5px; padding: 0.8em 1em; white-space: pre-wrap; margin: 1em 0; }
  code { font-family: Menlo, Consolas, "Courier New", monospace; font-size: 0.88em; background: #f2efe8; padding: 0 0.25em; border-radius: 3px; }
  pre code { background: none; padding: 0; font-size: 1em; }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 0.92em; line-height: 1.4; }
  th, td { border: 1px solid #cfc8b8; padding: 0.35em 0.6em; text-align: left; vertical-align: top; }
  th { background: #f2efe8; }
  hr { border: none; border-top: 1px solid #cfc8b8; margin: 1.8em 20%; }
  figure { margin: 1.4em auto; text-align: center; page-break-inside: avoid; }
  figure img { max-width: 100%; height: auto; }
  figcaption { font-size: 0.85em; color: #666; font-style: italic; margin-top: 0.4em; }
  .missing { color: #999; font-style: italic; text-indent: 0 !important; }
  p.center { text-align: center; text-indent: 0; }
  p.right { text-align: right; text-indent: 0; }
  p.justify { text-align: justify; }
  h3, h4, h5, h6 { font-weight: bold; margin: 1.4em 0 0.5em; line-height: 1.3; }
  p.poetry { text-indent: 0 !important; margin: 0 2.5em; }
  p:not(.poetry) + p.poetry, h1 + p.poetry, h2 + p.poetry { margin-top: 0.9em; }
  p.poetry + p:not(.poetry) { margin-top: 0.9em; }`;

// opts: {cover, stamp, img(b) → src}. Default pictures load from disk
// (fine for PDF and email, which print from this Mac).
function buildHtml(data, opts = {}) {
  const d = data || bookExportData();
  const total = d.sections.reduce((s, ch) => s + blocksWordCount(ch.blocks), 0);
  const stamp = new Date().toLocaleString();
  const img = opts.img || ((b) => mediaUrl(b.src, b.bookId));
  const chaptersHtml = d.sections.map((ch) => `
    <section class="chapter">
      ${ch.heading ? `<h2>${escHtml(ch.heading)}</h2>` : ''}
      ${blocksToHtml(ch.blocks, { img, headOffset: d.sections.some((c) => c.heading) ? 2 : 1, first: true })}
    </section>`).join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escHtml(d.title)}</title>
<style>
  body { font-family: Georgia, serif; color: #1c1c1c; max-width: 620px; margin: 40px auto; line-height: 1.7; font-size: 13pt; }
  .coverpage { text-align: center; margin: 0 0 40px; page-break-after: always; }
  .coverpage img { display: block; margin: 0 auto; width: 100%; max-width: 620px; max-height: 95vh; object-fit: contain; }
  .titlepage { text-align: center; margin: 30vh 0 20vh; page-break-after: always; }
  .titlepage h1 { font-size: 30pt; margin: 0; }
  .titlepage .sub { font-style: italic; color: #555; }
  .titlepage .auth { margin-top: 40px; letter-spacing: 3px; text-transform: uppercase; font-size: 11pt; }
  .chapter { page-break-before: always; }
  .chapter h2 { text-align: center; letter-spacing: 4px; text-transform: uppercase; font-size: 12pt; font-weight: normal; color: #555; margin: 60px 0 40px; }
  .chapter p { text-indent: 2em; margin: 0; }
  .chapter p.first { text-indent: 0; }
  /* an in-flow raised initial on each chapter's opening paragraph: stays
     inside its word for copy, search, and screen readers */
  .chapter h2 + p.first::first-letter, .chapter > p.first:first-child::first-letter { font-size: 1.8em; line-height: 1; }
  .brk { text-align: center; text-indent: 0 !important; letter-spacing: 8px; color: #888; margin: 2.5em 0; }
  .prov { margin-top: 80px; text-align: center; color: #999; font-size: 9pt; }
  ${RICH_EXPORT_CSS}
</style></head><body>
${opts.cover ? `<div class="coverpage"><img src="data:${opts.cover.mime};base64,${opts.cover.base64}" alt="Cover"/></div>` : ''}
<div class="titlepage"><h1>${escHtml(d.title)}</h1>
${d.subtitle ? `<p class="sub">${escHtml(d.subtitle)}</p>` : ''}
<p class="auth">${escHtml(d.author)}</p></div>
${chaptersHtml}
${opts.stamp ? `<p class="prov">${total.toLocaleString()} words · exported from NEO on ${stamp}</p>` : ''}
</body></html>`;
}

/* ---------- DOCX ---------- */

const DOCX_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

// one run of text; \n and \t become Word's own breaks and tabs
function docxRun(r, extra = {}) {
  const rPr = (extra.style ? `<w:rStyle w:val="${extra.style}"/>` : '') +
    (r.code ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>' : '') +
    (r.b || extra.b ? '<w:b/>' : '') + (r.i || extra.i ? '<w:i/>' : '') + (r.s ? '<w:strike/>' : '') +
    (extra.size ? `<w:sz w:val="${extra.size}"/>` : '');
  const body = String(r.text).split(/(\n|\t)/).map((part) =>
    part === '\n' ? '<w:br/>' : part === '\t' ? '<w:tab/>' : part ? `<w:t xml:space="preserve">${escXml(part)}</w:t>` : '').join('');
  return `<w:r>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}${body}</w:r>`;
}

function docxRuns(runs, ctx, extra = {}) {
  let xml = '';
  let i = 0;
  while (i < runs.length) {
    if (runs[i].mark !== undefined) { i++; continue; }
    const href = runs[i].href || null;
    let inner = '';
    while (i < runs.length && runs[i].mark === undefined && (runs[i].href || null) === href) {
      inner += docxRun(runs[i], href ? { ...extra, style: 'Hyperlink' } : extra);
      i++;
    }
    if (href && !/^[a-z]+:/i.test(href)) {
      xml += inner; // a book-relative path means nothing inside a .docx
    } else if (href) {
      const id = 'rId' + ctx.nextRel++;
      ctx.rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escXml(href)}" TargetMode="External"/>`);
      xml += `<w:hyperlink r:id="${id}" w:history="1">${inner}</w:hyperlink>`;
    } else xml += inner;
  }
  return xml;
}

// pPr children must follow the schema's order or Word complains
function docxPPr(o = {}) {
  return '<w:pPr>' +
    (o.style ? `<w:pStyle w:val="${o.style}"/>` : '') +
    (o.keepNext ? '<w:keepNext/>' : '') +
    (o.pageBreak ? '<w:pageBreakBefore/>' : '') +
    (o.num ? `<w:numPr><w:ilvl w:val="${o.num.lvl}"/><w:numId w:val="${o.num.id}"/></w:numPr>` : '') +
    (o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A8A29A"/></w:pBdr>' : '') +
    (o.spaceBefore != null || o.spaceAfter != null ? `<w:spacing${o.spaceBefore != null ? ` w:before="${o.spaceBefore}"` : ''}${o.spaceAfter != null ? ` w:after="${o.spaceAfter}"` : ''} w:line="360" w:lineRule="auto"/>` : '') +
    (o.poetry ? '<w:ind w:left="720" w:right="720"/>' : o.indent ? '<w:ind w:firstLine="480"/>' : '') +
    (o.align ? `<w:jc w:val="${o.align === 'justify' ? 'both' : o.align}"/>` : '') +
    '</w:pPr>';
}
const docxPara = (inner, o) => `<w:p>${docxPPr(o)}${inner}</w:p>`;

async function docxBlocks(blocks, ctx, inQuote = false) {
  const out = [];
  const listXml = (b, lvl, numId) => {
    for (const it of b.items) {
      const box = b.task ? [{ text: it.checked ? '☑ ' : '☐ ' }] : [];
      out.push(docxPara(docxRuns([...box, ...it.runs], ctx), { style: 'ListParagraph', num: { lvl, id: numId } }));
      for (const c of it.children) listXml(c, Math.min(8, lvl + 1), c.ordered === b.ordered ? numId : docxNum(ctx, c));
    }
  };
  for (const b of blocks) {
    switch (b.type) {
      case 'p': {
        const center = b.align === 'center' || b.align === 'right';
        out.push(docxPara(docxRuns(b.runs, ctx), inQuote ? { style: 'Quote', align: b.align }
          : b.poetry ? { poetry: true, align: center ? b.align : '' } : { indent: !center, align: b.align }));
        break;
      }
      case 'break': out.push(docxPara(docxRun({ text: '***' }), { align: 'center', spaceBefore: 240 })); break;
      case 'heading': out.push(docxPara(docxRuns(b.runs, ctx), { style: 'Heading' + clampLevel(b.level), align: b.align })); break;
      case 'quote': out.push(...(await docxBlocks(b.blocks, ctx, true))); break;
      case 'list': listXml(b, 0, docxNum(ctx, b)); break;
      case 'code': out.push(docxPara(docxRun({ text: b.text }), { style: 'Code' })); break;
      case 'hr': out.push(docxPara('', { border: true, spaceAfter: 240 })); break;
      case 'table': out.push(docxTable(b, ctx)); break;
      case 'image': {
        const a = await exportImage(b);
        if (!a) { out.push(docxPara(docxRun({ text: `[Image: ${b.caption || b.alt || baseName(b.src)}]`, i: true }), { align: 'center' })); break; }
        const n = ++ctx.imgCount;
        const file = `image${n}.${a.ext}`;
        const id = 'rId' + ctx.nextRel++;
        ctx.media.push({ path: 'word/media/' + file, content: a.base64, base64: true });
        ctx.rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/>`);
        ctx.exts.add(a.ext);
        // 6 inches of text width; pictures are never blown up past their own size
        const maxW = Math.round(5486400 * ((b.width || 100) / 100));
        const cx = Math.min(maxW, a.w * 9525);
        const cy = Math.round(cx * a.h / a.w);
        const alt = escXml(b.alt || b.caption || '');
        out.push(`<w:p>${docxPPr({ align: 'center', keepNext: !!b.caption })}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
          `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${alt}"/>` +
          '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
          '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
          `<pic:nvPicPr><pic:cNvPr id="${n}" name="${file}"/><pic:cNvPicPr/></pic:nvPicPr>` +
          `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
          `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
          '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>');
        if (b.caption) out.push(docxPara(docxRun({ text: b.caption }), { style: 'Caption' }));
        break;
      }
    }
  }
  return out;
}

// every list gets its own numbering instance so numbered lists restart at 1
function docxNum(ctx, list) {
  const id = ctx.nums.length + 1;
  ctx.nums.push({ id, ordered: list.ordered, start: list.start || 1 });
  return id;
}

function docxTable(b, ctx) {
  const cols = b.rows[0].cells.length;
  const w = Math.floor(9360 / cols);
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="B8B0A0"/>`;
  return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>' +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
    '<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    b.rows.map((r) => `<w:tr>${r.header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}` +
      r.cells.map((c) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>` +
        `<w:p>${docxPPr({ align: c.align, spaceBefore: 40, spaceAfter: 40 })}${docxRuns(c.runs, ctx, r.header ? { b: true } : {})}</w:p></w:tc>`).join('') +
      '</w:tr>').join('') +
    '</w:tbl>';
}

function docxNumberingXml(nums) {
  const bullets = ['•', '◦', '▪'];
  const fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
  const lvls = (ordered) => Array.from({ length: 9 }, (_, i) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? fmts[i % 3] : 'bullet'}"/>` +
    `<w:lvlText w:val="${ordered ? `%${i + 1}.` : bullets[i % 3]}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(false)}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(true)}</w:abstractNum>
${nums.map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.ordered ? 1 : 0}"/>` +
    (n.ordered ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${n.start}"/></w:lvlOverride>` : '') + '</w:num>').join('\n')}
</w:numbering>`;
}

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="C9A86A"/></w:pBdr><w:ind w:left="720" w:right="360"/></w:pPr><w:rPr><w:color w:val="444444"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F1EC"/><w:spacing w:before="120" w:after="120" w:line="276" w:lineRule="auto"/><w:ind w:left="240" w:right="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

async function buildDocxEntries(data) {
  const d = data || bookExportData();
  // rId1 = styles, rId2 = numbering; links and pictures follow
  const ctx = { rels: [], media: [], nums: [], nextRel: 3, imgCount: 0, exts: new Set() };
  const body = [];
  // title page
  body.push(docxPara(docxRun({ text: d.title, b: true }, { size: 56 }), { align: 'center', spaceBefore: 3000 }));
  if (d.subtitle) body.push(docxPara(docxRun({ text: d.subtitle, i: true }, { size: 32 }), { align: 'center' }));
  body.push(docxPara(docxRun({ text: d.author }), { align: 'center', spaceBefore: 800 }));
  for (const ch of d.sections) {
    if (ch.heading) {
      body.push(docxPara(docxRun({ text: ch.heading.toUpperCase() }, { size: 28 }), { align: 'center', pageBreak: true, spaceBefore: 1200 }));
      body.push(docxPara('', {}));
    } else {
      body.push(docxPara('', { pageBreak: true })); // headingless story still starts fresh
    }
    body.push(...(await docxBlocks(ch.blocks, ctx)));
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${DOCX_NS}><w:body>${body.join('')}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
  const imageTypes = [...ctx.exts].map((e) =>
    `<Default Extension="${e}" ContentType="${e === 'png' ? 'image/png' : e === 'gif' ? 'image/gif' : 'image/jpeg'}"/>`).join('\n');
  return [
    { path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${imageTypes}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>` },
    { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>` },
    { path: 'word/_rels/document.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
${ctx.rels.join('\n')}
</Relationships>` },
    { path: 'word/document.xml', content: documentXml },
    { path: 'word/styles.xml', content: DOCX_STYLES },
    { path: 'word/numbering.xml', content: docxNumberingXml(ctx.nums) },
    ...ctx.media
  ];
}

/* ---------- EPUB (KDP-friendly: EPUB 3, nav + NCX TOC, cover image) ---------- */

// The cover that travels with an export: the writer's own image if they
// gave one, otherwise the shelf's abstract with the title set in type,
// rendered at KDP size. NEO's paintings never leave the shelf.
async function exportCover(d) {
  if (d.coverImage) {
    const c = await window.neo.readCover(d.id, d.coverImage);
    if (c) return { base64: c.base64, mime: c.mime, ext: c.ext };
  }
  await NeoCovers.ready;
  const url = NeoCovers.renderFull(d).toDataURL('image/jpeg', 0.9);
  return { base64: url.split(',')[1], mime: 'image/jpeg', ext: 'jpg' };
}

function chapterXhtml(ch, d, ctx) {
  const body = blocksToHtml(ch.blocks, { ...ctx, xml: true, headOffset: ch.heading ? 1 : 0, brk: '* * *', first: true });
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escXml(ch.heading || d.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><section epub:type="chapter">${ch.heading ? `<h1>${escXml(ch.heading)}</h1>` : ''}
${body}
</section></body></html>`;
}

async function buildEpubEntries(data) {
  const d = data || bookExportData();
  const chapters = d.sections;
  const uuid = 'urn:uuid:' + (d.uuid || crypto.randomUUID());
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // pictures go inside the book; a reader has no way to reach this Mac
  const pics = new Map();
  const picEntries = [];
  const picItems = [];
  for (const ch of chapters) {
    for (const b of walkBlocks(ch.blocks)) {
      if (b.type !== 'image') continue;
      const key = b.bookId + '|' + b.src;
      if (!pics.has(key)) {
        const a = await exportImage(b);
        if (a) {
          const n = picEntries.length + 1;
          const href = `images/img${n}.${a.ext}`;
          picEntries.push({ path: 'OEBPS/' + href, content: a.base64, base64: true });
          picItems.push(`<item id="img${n}" href="${href}" media-type="${a.mime}"/>`);
          pics.set(key, href);
        } else pics.set(key, null);
      }
    }
  }
  const ctx = {
    img: (b) => pics.get(b.bookId + '|' + b.src) || null,
    // web and mail links work in an ebook; links to files on this Mac don't
    href: (h) => (/^(https?|mailto):/i.test(h) ? h : null)
  };

  // real cover art when the book has it; the shelf's cover otherwise
  const cover = await exportCover(d);
  const coverName = 'cover.' + cover.ext;
  const coverMime = cover.mime;
  const coverContent = cover.base64;
  const chItems = chapters.map((ch) =>
    `<item id="ch${ch.num}" href="ch${ch.num}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
  const chSpine = chapters.map((ch) => `<itemref idref="ch${ch.num}"/>`).join('\n');
  const navPoints = chapters.map((ch) => `<li><a href="ch${ch.num}.xhtml">${escXml(ch.heading || d.title)}</a></li>`).join('\n');
  const ncxPoints = chapters.map((ch) => `
<navPoint id="ch${ch.num}" playOrder="${ch.num + 1}"><navLabel><text>${escXml(ch.heading || d.title)}</text></navLabel><content src="ch${ch.num}.xhtml"/></navPoint>`).join('');

  const entries = [
    { path: 'mimetype', content: 'application/epub+zip', store: true },
    { path: 'META-INF/container.xml', content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>` },
    { path: 'OEBPS/content.opf', content: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uuid}</dc:identifier>
<dc:title>${escXml(d.title)}</dc:title>
<dc:creator>${escXml(d.author)}</dc:creator>
<dc:language>${escXml(d.language || 'en')}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
<item id="cover-image" href="${coverName}" media-type="${coverMime}" properties="cover-image"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chItems}
${picItems.join('\n')}
</manifest>
<spine toc="ncx">
<itemref idref="cover" linear="no"/>
<itemref idref="titlepage"/>
<itemref idref="nav"${chapters.length === 1 ? ' linear="no"' : ''}/>
${chSpine}
</spine>
<guide>
<reference type="cover" title="Cover" href="cover.xhtml"/>
<reference type="toc" title="Table of Contents" href="nav.xhtml"/>
<reference type="text" title="Beginning" href="ch1.xhtml"/>
</guide>
</package>` },
    { path: 'OEBPS/nav.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1>
<ol>
<li><a href="title.xhtml">Title Page</a></li>
${navPoints}
</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>
<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
<li><a epub:type="toc" href="nav.xhtml">Table of Contents</a></li>
<li><a epub:type="bodymatter" href="ch1.xhtml">Beginning</a></li>
</ol></nav>
</body></html>` },
    { path: 'OEBPS/toc.ncx', content: `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uuid}"/></head>
<docTitle><text>${escXml(d.title)}</text></docTitle>
<navMap>
<navPoint id="titlepage" playOrder="1"><navLabel><text>Title Page</text></navLabel><content src="title.xhtml"/></navPoint>${ncxPoints}
</navMap></ncx>` },
    { path: 'OEBPS/style.css', content: `body { font-family: serif; line-height: 1.5; margin: 1em; }
h1 { text-align: center; font-weight: normal; letter-spacing: 0.2em; text-transform: uppercase; font-size: 1.2em; margin: 3em 0 2em; }
h2 { font-size: 1.25em; margin: 1.4em 0 0.5em; } h3 { font-size: 1.1em; margin: 1.3em 0 0.4em; } h4 { font-size: 1em; margin: 1.2em 0 0.4em; }
p { text-indent: 1.2em; margin: 0; }
p.first, p.brk + p { text-indent: 0; }
p.center { text-align: center; text-indent: 0; }
p.right { text-align: right; text-indent: 0; }
p.brk { text-align: center; text-indent: 0; margin: 2.5em 0; letter-spacing: 0.5em; }
.titlepage { text-align: center; margin-top: 30%; }
.titlepage h2 { font-size: 2em; margin: 0; }
.titlepage .sub { font-style: italic; }
.titlepage .auth { margin-top: 4em; letter-spacing: 0.3em; text-transform: uppercase; }
.coverimg { text-align: center; margin: 0; padding: 0; }
.coverimg img { max-width: 100%; max-height: 100%; }
${RICH_EXPORT_CSS}` },
    { path: 'OEBPS/cover.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Cover</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="coverimg"><img src="${coverName}" alt="${escXml(d.title)}"/></div></body></html>` },
    { path: 'OEBPS/title.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(d.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="titlepage"><h2>${escXml(d.title)}</h2>
${d.subtitle ? `<p class="sub">${escXml(d.subtitle)}</p>` : ''}
<p class="auth">${escXml(d.author)}</p></div></body></html>` },
    { path: 'OEBPS/' + coverName, content: coverContent, base64: true },
    ...picEntries
  ];
  for (const ch of chapters) {
    entries.push({ path: `OEBPS/ch${ch.num}.xhtml`, content: chapterXhtml(ch, d, ctx) });
  }
  return entries;
}

/* ================================================================== */
/*  THE LIVE PAGE                                                      */
/* ================================================================== */

const unwrapEl = (el) => { el.replaceWith(...el.childNodes); };
const newPara = () => { const p = document.createElement('p'); p.innerHTML = '<br>'; return p; };
const ATOMS = /^(TABLE|FIGURE|HR)$/;

// The engine's list command (and some pastes) leave a list, table or quote
// *inside* a paragraph. Split the paragraph around it.
function liftBlocksOutOfParagraphs(root) {
  const bad = [...root.querySelectorAll('p')].filter((p) => [...p.children].some((c) => c.matches(BLOCKISH)));
  if (!bad.length) return;
  const c = richCaretSave(root);
  for (const p of bad) {
    if (!p.isConnected) continue;
    const parts = [];
    let cur = null;
    for (const n of [...p.childNodes]) {
      if (n.nodeType === 1 && n.matches(BLOCKISH)) { cur = null; parts.push(n); continue; }
      if (n.nodeType === 3 && !n.data.trim() && !cur) continue;
      if (n.nodeType === 1 && n.tagName === 'BR' && !cur) continue;
      if (!cur) {
        cur = document.createElement('p');
        if (p.className) cur.className = p.className;
        parts.push(cur);
      }
      cur.appendChild(n);
    }
    p.replaceWith(...parts);
  }
  richCaretRestore(root, c);
}

// point every picture at where it really lives (the library can move)
function hydrateMedia(root, bookId = book && book.id) {
  for (const img of root.querySelectorAll('img')) {
    if (!img.dataset.src) {
      const s = safeImgSrc(img.getAttribute('src'));
      if (!s) { img.remove(); continue; }
      img.dataset.src = s;
    }
    const url = mediaUrl(img.dataset.src, bookId);
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
    const fig = img.closest('figure');
    if (!fig) continue;
    if (!img._neoWired) {
      img._neoWired = true;
      img.addEventListener('error', () => fig.classList.add('broken'));
      img.addEventListener('load', () => fig.classList.remove('broken'));
    }
    if (img.complete) fig.classList.toggle('broken', img.naturalWidth === 0);
  }
}

// Keep the page in shapes NEO understands: paragraphs at the top level,
// no inline styles but alignment, pictures that can't be typed into, and
// always somewhere for the caret to go after a table or picture.
function richNormalize(root) {
  cleanStyleSpans(root);
  liftBlocksOutOfParagraphs(root);
  let run = null;
  for (const n of [...root.childNodes]) {
    if (n.nodeType === 1 && n.tagName === 'DIV') {
      run = null;
      if (n.querySelector(BLOCKISH)) { unwrapEl(n); continue; }
      const p = document.createElement('p');
      p.append(...n.childNodes);
      if (!p.firstChild) p.innerHTML = '<br>';
      n.replaceWith(p);
      continue;
    }
    const inline = n.nodeType === 3 ? n.data.trim() !== '' : n.nodeType === 1 && !n.matches(BLOCKISH);
    if (inline) {
      if (!run) { run = document.createElement('p'); n.before(run); }
      run.appendChild(n);
    } else if (n.nodeType === 3) {
      if (run) run.appendChild(n); else n.remove();
    } else run = null;
  }
  for (const el of root.querySelectorAll('[style]')) {
    if (el.classList.contains('ph-mark')) continue;
    const keep = /^(P|H[1-6]|LI|TD|TH)$/.test(el.tagName) ? alignOf(el) : '';
    el.removeAttribute('style');
    if (keep) el.style.textAlign = keep;
  }
  for (const f of root.querySelectorAll('font')) unwrapEl(f);
  for (const f of root.querySelectorAll('figure')) {
    if (!f.querySelector('img')) { f.remove(); continue; }
    if (f.contentEditable !== 'false') f.contentEditable = 'false';
    f.classList.add('neo-img');
  }
  // two pictures (or tables) back to back leave no place to click between
  for (const a of root.querySelectorAll(':scope > figure, :scope > table')) {
    const next = a.nextElementSibling;
    if (next && /^(FIGURE|TABLE)$/.test(next.tagName)) a.after(newPara());
  }
  const last = root.lastElementChild;
  if (last && (ATOMS.test(last.tagName) || /^(PRE|BLOCKQUOTE|UL|OL)$/.test(last.tagName))) root.appendChild(newPara());
  const first = root.firstElementChild;
  if (first && ATOMS.test(first.tagName) && root.classList.contains('chapter-body')) root.prepend(newPara());
  hydrateMedia(root);
}

/* ---------- selection helpers ---------- */

function caretNode() {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  const n = s.anchorNode;
  return n && n.nodeType === 3 ? n.parentElement : n;
}
function richRoot() {
  const n = caretNode();
  return n && n.closest ? n.closest(RICH_EDITABLE) : null;
}
function caretIn(root, sel) {
  const n = caretNode();
  const el = n && n.closest ? n.closest(sel) : null;
  return el && root.contains(el) && el !== root ? el : null;
}
function richInCode() {
  const n = caretNode();
  return !!(n && n.closest && n.closest('pre, code'));
}
function textBefore(el) {
  const s = window.getSelection();
  if (!s.rangeCount) return '';
  const r = document.createRange();
  r.selectNodeContents(el);
  try { r.setEnd(s.anchorNode, s.anchorOffset); } catch { return ''; }
  return r.toString();
}
function textAfter(el) {
  const s = window.getSelection();
  if (!s.rangeCount) return '';
  const r = document.createRange();
  r.selectNodeContents(el);
  try { r.setStart(s.focusNode, s.focusOffset); } catch { return ''; }
  return r.toString();
}

function richPlaceCaret(el, off = Infinity) {
  const root = el.closest(RICH_EDITABLE);
  if (root && document.activeElement !== root) root.focus({ preventScroll: true });
  const s = window.getSelection();
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n;
  while ((n = w.nextNode())) {
    if (off <= pos + n.data.length) {
      const r = document.createRange();
      r.setStart(n, off - pos);
      r.collapse(true);
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    pos += n.data.length;
  }
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(off === 0);
  s.removeAllRanges();
  s.addRange(r);
}

function richCaretSave(root) {
  const s = window.getSelection();
  if (!s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!root.contains(r.startContainer)) return null;
  const el = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
  const blk = el.closest(CARET_BLOCKS);
  if (!blk || !root.contains(blk)) return { idx: 0, off: 0 };
  const pre = document.createRange();
  pre.selectNodeContents(blk);
  pre.setEnd(r.startContainer, r.startOffset);
  return { el: blk, idx: [...root.querySelectorAll(CARET_BLOCKS)].indexOf(blk), off: pre.toString().length };
}
function richCaretRestore(root, c) {
  if (!c) return;
  // the block itself usually survives surgery (it was only moved)
  if (c.el && c.el.isConnected && root.contains(c.el)) { richPlaceCaret(c.el, c.off); return; }
  const all = [...root.querySelectorAll(CARET_BLOCKS)];
  const blk = all[c.idx] || all[all.length - 1];
  if (blk) richPlaceCaret(blk, c.off);
}

// the page changed without an input event: save it
function touched(root) {
  const chEl = root.closest('.chapter');
  if (chEl) syncChapter(root, chEl.dataset.id);
  else if (root.id === 'aux-editor') { auxDirty = true; scheduleAuxSave(); }
  refreshBar();
}

// DOM surgery the engine's undo can't follow: NEO's structural undo takes
// a snapshot first, so ⌘Z straight afterwards still puts it back.
// fn may return an element (or [element, offset]) for the caret.
function structural(root, label, fn) {
  const chEl = root.closest('.chapter');
  const chId = chEl ? chEl.dataset.id : null;
  const caret = richCaretSave(root);
  if (chId) {
    chapterHTML[chId] = captureBody(root);
    snapshotStructure(label);
  }
  const place = fn();
  richNormalize(root);
  if (Array.isArray(place)) richPlaceCaret(place[0], place[1]);
  else if (place instanceof Element) richPlaceCaret(place);
  else richCaretRestore(root, caret);
  touched(root);
  if (chId) { resetNativeUndo(); breakRun++; }
}

// native editing commands keep the engine's own undo; the page must not jump
function exec(cmd, val) {
  const sc = $('#paper-scroll');
  const keep = sc.scrollTop;
  const ok = document.execCommand(cmd, false, val);
  sc.scrollTop = keep;
  requestAnimationFrame(() => { sc.scrollTop = keep; });
  return ok;
}

// insertHTML inside NEO's pre-wrap paragraphs makes the engine wrap the
// new content in <span style="white-space: normal">, copy computed styles
// onto every inline element, and swap a bare <code> for a styled <span>.
// Inline elements go in tagged (the engine keeps anything with attributes);
// the tags, styles and spans come off again straight after.
function execHTML(root, html) {
  const ok = exec('insertHTML', String(html).replace(/<(b|i|s|code|a|strike|em|strong)(?=[\s>])/g, '<$1 class="neo-keep"'));
  for (const el of root.querySelectorAll('.neo-keep')) { el.classList.remove('neo-keep'); if (!el.className) el.removeAttribute('class'); }
  for (const el of root.querySelectorAll('b[style], i[style], s[style], strike[style], code[style], a[style], em[style], strong[style]')) el.removeAttribute('style');
  cleanStyleSpans(root);
  return ok;
}
function cleanStyleSpans(root) {
  const junk = root.querySelectorAll('span:not(.ph-mark)');
  if (!junk.length) return;
  const c = richCaretSave(root);
  for (const sp of junk) unwrapEl(sp);
  richCaretRestore(root, c);
}

// the top-level blocks the selection touches
function selectedTopBlocks(root) {
  const s = window.getSelection();
  if (!s.rangeCount) return [];
  const r = s.getRangeAt(0);
  const top = (node, off) => {
    if (node === root) return root.childNodes[Math.min(off, root.childNodes.length - 1)] || null;
    let x = node.nodeType === 3 ? node.parentElement : node;
    while (x && x.parentElement !== root) x = x.parentElement;
    return x;
  };
  const a = top(r.startContainer, r.startOffset);
  const b = top(r.endContainer, r.endOffset);
  if (!a || a.nodeType !== 1) return [];
  const out = [];
  for (let x = a; x; x = x.nextElementSibling) {
    out.push(x);
    if (x === b) break;
  }
  return out;
}

// Wrap the selection in <code>. Done by hand: the engine turns a lone
// inserted <code> into a styled <span>. NEO's undo covers it.
function codeSelection(root, text) {
  const r = window.getSelection().getRangeAt(0).cloneRange();
  let code = null;
  structural(root, 'code', () => {
    r.deleteContents();
    code = document.createElement('code');
    code.textContent = text;
    r.insertNode(code);
    const blk = code.closest(CARET_BLOCKS);
    const pre = document.createRange();
    pre.selectNodeContents(blk);
    pre.setEndAfter(code);
    return [blk, pre.toString().length];
  });
  armEscape(code);
}

/* ---------- commands ---------- */

const mdShortcutsOn = () => !(library && library.mdShortcuts === false);

function setBlock(root, tag) {
  const blk = caretIn(root, CARET_BLOCKS);
  if (!blk) return;
  if (blk.closest('pre')) { if (tag === 'p') toggleCodeBlock(root); return; }
  if (blk.closest('li, td, th')) {
    if (tag === 'p') { const li = blk.closest('li'); if (li) exec(li.parentElement.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList'); }
    else toast('Headings sit on their own line — not inside a list or table');
    return;
  }
  if (blk.classList.contains('scene-break')) return;
  if (tag !== 'p' && blk.tagName.toLowerCase() === tag) tag = 'p';
  exec('formatBlock', `<${tag}>`);
  richNormalize(root);
  touched(root);
}

function toggleQuote(root) {
  const q = caretIn(root, 'blockquote');
  if (q) {
    structural(root, 'quote', () => { unwrapEl(q); });
    return;
  }
  const blocks = selectedTopBlocks(root).filter((b) => !b.classList.contains('scene-break'));
  if (!blocks.length) return;
  structural(root, 'quote', () => {
    const bq = document.createElement('blockquote');
    blocks[0].before(bq);
    for (const b of blocks) bq.appendChild(b);
  });
}

function toggleCodeBlock(root) {
  const pre = caretIn(root, 'pre');
  if (pre) {
    structural(root, 'code block', () => {
      const ps = preText(pre).split('\n').map((l) => {
        const p = document.createElement('p');
        if (l) p.textContent = l; else p.innerHTML = '<br>';
        return p;
      });
      pre.replaceWith(...ps);
    });
    return;
  }
  const blocks = selectedTopBlocks(root).filter((b) => !ATOMS.test(b.tagName));
  if (!blocks.length) return;
  structural(root, 'code block', () => {
    const p = document.createElement('pre');
    p.textContent = blocks.map((b) => b.innerText.replace(/\n$/, '')).join('\n');
    if (!p.textContent) p.innerHTML = '<br>';
    blocks[0].before(p);
    blocks.forEach((b) => b.remove());
    return p;
  });
}

function markTasks(list, on) {
  if (!list) return;
  list.classList.toggle('tasks', on);
  if (!list.className) list.removeAttribute('class');
  for (const li of list.children) {
    if (li.tagName !== 'LI') continue;
    if (on) { if (li.dataset.checked == null) li.dataset.checked = 'false'; } else delete li.dataset.checked;
  }
}

function toggleList(root, kind) {
  const li = caretIn(root, 'li');
  const list = li && li.parentElement;
  const cmd = kind === 'ol' ? 'insertOrderedList' : 'insertUnorderedList';
  if (list) {
    const isTask = list.classList.contains('tasks');
    const same = kind === 'task' ? isTask : !isTask && list.tagName.toLowerCase() === kind;
    if (same) exec(cmd); // off again
    else if (kind === 'task' || isTask) {
      if (list.tagName === 'OL') exec('insertUnorderedList');
      const now = caretIn(root, 'li');
      markTasks(now && now.parentElement, kind === 'task');
      if (kind === 'ol') exec('insertOrderedList');
    } else exec(cmd);
    richNormalize(root);
    touched(root);
    return;
  }
  exec(cmd);
  if (kind === 'task') { const now = caretIn(root, 'li'); markTasks(now && now.parentElement, true); }
  richNormalize(root);
  touched(root);
}

function toggleInlineCode(root) {
  const code = caretIn(root, 'code');
  if (code && !code.closest('pre')) {
    structural(root, 'code', () => { unwrapEl(code); });
    return;
  }
  if (caretIn(root, 'pre')) return;
  const s = window.getSelection();
  if (s.isCollapsed) { toast('Select the text to mark as code — or type it between `backticks`'); return; }
  const text = s.toString();
  if (/\n/.test(text)) { toggleCodeBlock(root); return; }
  codeSelection(root, text);
}

function insertRule(root) {
  if (caretIn(root, 'li, td, th, pre')) { toast('A rule sits between paragraphs — not inside a list, table, or code'); return; }
  exec('insertHorizontalRule');
  richNormalize(root);
  const hr = caretNode() && caretNode().closest && [...root.querySelectorAll('hr')].find((h) => !h.nextElementSibling || h.nextElementSibling.tagName === 'P');
  touched(root);
  return hr;
}

function clearFormatting(root) {
  exec('removeFormat');
  exec('unlink');
  const blk = caretIn(root, 'h1, h2, h3, h4, h5, h6');
  if (blk) exec('formatBlock', '<p>');
  touched(root);
}

const RICH_COMMANDS = {
  bold: () => exec('bold'),
  italic: () => exec('italic'),
  strike: () => exec('strikeThrough'),
  code: toggleInlineCode,
  link: openLinkDialog,
  image: (root) => openImageDialog(root),
  table: openTableDialog,
  hr: insertRule,
  p: (root) => setBlock(root, 'p'),
  h1: (root) => setBlock(root, 'h1'),
  h2: (root) => setBlock(root, 'h2'),
  h3: (root) => setBlock(root, 'h3'),
  quote: toggleQuote,
  codeblock: toggleCodeBlock,
  ul: (root) => toggleList(root, 'ul'),
  ol: (root) => toggleList(root, 'ol'),
  task: (root) => toggleList(root, 'task'),
  clear: clearFormatting
};

function runRich(cmd) {
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  if (cmd === 'shortcuts') { showHelp(); return; }
  if (cmd === 'darling') {
    if (currentTab !== 'manuscript') { toast('Darlings come from the manuscript — switch to it, select a passage, then send it'); return; }
    darlingFromKeyboard(); // same move as ⌘⇧D and dragging onto the Darlings tab
    return;
  }
  if (!book || $('#editor-view').hidden) return;
  const root = richRoot() || lastRoot();
  if (!root) { toast('Click into your writing first'); return; }
  const fn = RICH_COMMANDS[cmd];
  if (fn) fn(root);
  refreshBar();
}

// the toolbar and menu act on the page the caret was last in
let lastRootEl = null;
const lastRoot = () => (lastRootEl && lastRootEl.isConnected && !lastRootEl.closest('[hidden]') ? lastRootEl : null);

/* ---------- escaping a freshly made run ---------- */

// After **bold** or a link is made, the next keystroke would normally keep
// going inside it. This puts that character just outside instead.
let escapeEl = null;
function armEscape(el) { escapeEl = el || null; }

function inlineBeforeCaret(tag) {
  const s = window.getSelection();
  if (!s.rangeCount) return null;
  let n = s.anchorNode;
  const off = s.anchorOffset;
  let prev = null;
  if (n.nodeType === 3) {
    if (off < n.data.length) return n.parentElement.closest(tag.toLowerCase());
    prev = n.previousSibling;
    if (!prev || off > 0) return n.parentElement.closest(tag.toLowerCase()) || (prev && prev.nodeName === tag ? prev : null);
  } else prev = n.childNodes[off - 1];
  while (prev && prev.nodeType === 1 && prev.nodeName !== tag && prev.lastChild) prev = prev.lastChild;
  if (prev && prev.nodeType === 3) prev = prev.parentElement;
  return prev && prev.closest ? prev.closest(tag.toLowerCase()) : null;
}

document.addEventListener('beforeinput', (e) => {
  if (!escapeEl) return;
  const el = escapeEl;
  if (e.inputType !== 'insertText' || !e.data || !el.isConnected) { escapeEl = null; return; }
  escapeEl = null;
  const s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed) return;
  const n = s.anchorNode;
  const inside = el.contains(n);
  const r = document.createRange();
  if (inside) {
    r.selectNodeContents(el);
    r.setStart(n, s.anchorOffset);
    if (r.toString() !== '') return; // caret moved into the middle: leave it alone
  } else {
    const justAfter = (n === el.parentNode && n.childNodes[s.anchorOffset - 1] === el) ||
      (n.nodeType === 3 && s.anchorOffset === 0 && n.previousSibling === el);
    if (!justAfter) return;
  }
  e.preventDefault();
  let t = el.nextSibling;
  if (t && t.nodeType === 3) t.insertData(0, e.data);
  else { t = document.createTextNode(e.data); el.after(t); }
  const c = document.createRange();
  c.setStart(t, e.data.length);
  c.collapse(true);
  s.removeAllRanges();
  s.addRange(c);
  const root = el.closest(RICH_EDITABLE);
  if (root) root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: e.data }));
}, true);

/* ---------- markdown while typing ---------- */

let inputRuleBusy = false;
const INLINE_RULES = [
  { re: /(^|[^*\w])\*\*([^\s*](?:[^*]*[^\s*])?)\*\*$/, cmd: 'bold' },
  { re: /(^|[^_\w])__([^\s_](?:[^_]*[^\s_])?)__$/, cmd: 'bold' },
  { re: /(^|[^*\w])\*([^\s*](?:[^*]*[^\s*])?)\*$/, cmd: 'italic' },
  { re: /(^|[^_\w])_([^\s_](?:[^_]*[^\s_])?)_$/, cmd: 'italic' },
  { re: /(^|[^~])~~([^\s~](?:[^~]*[^\s~])?)~~$/, cmd: 'strikeThrough' },
  { re: /(^|[^`])`([^`\n]+)`$/, cmd: 'code' }
];

// select the n characters just before the caret
function selectBack(n) {
  const s = window.getSelection();
  for (let k = 0; k < n; k++) s.modify('extend', 'backward', 'character');
}

function richInputRules(e, root) {
  if (inputRuleBusy || !mdShortcutsOn() || e.inputType !== 'insertText' || !e.data) return;
  const s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed) return;
  const node = s.anchorNode;
  if (!node || node.nodeType !== 3 || !root.contains(node)) return;
  if (node.parentElement.closest('pre, code, a')) return;
  const off = s.anchorOffset;
  const before = node.data.slice(0, off);
  const select = (start) => {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, off);
    s.removeAllRanges();
    s.addRange(r);
  };
  const ch = e.data.slice(-1);
  inputRuleBusy = true;
  try {
    if (ch === ')') {
      let m = before.match(/!\[([^\]\n]*)\]\(([^()\s]+)\)$/);
      if (m && book) {
        const src = /^(https?|file):/i.test(m[2]) ? m[2] : (normalizeHref(m[2]) || m[2]);
        select(m.index);
        insertBlocksDom(root, [{ type: 'image', src, alt: m[1], caption: m[1], width: 0, bookId: book.id }]);
        return;
      }
      m = before.match(/\[([^\]\n]+)\]\(([^()\s]+)\)$/);
      const href = m && normalizeHref(m[2]);
      if (href) {
        // the words stay, the markup goes, and they become the link
        select(m.index);
        exec('insertText', m[1]);
        selectBack(m[1].length);
        exec('createLink', href);
        window.getSelection().collapseToEnd();
        armEscape(inlineBeforeCaret('A'));
      }
      return;
    }
    if (!'*_~`'.includes(ch)) return;
    for (const rule of INLINE_RULES) {
      const m = before.match(rule.re);
      if (!m) continue;
      select(m.index + m[1].length);
      if (rule.cmd === 'code') { codeSelection(root, m[2]); return; }
      exec('insertText', m[2]);
      selectBack(m[2].length);
      exec(rule.cmd);
      window.getSelection().collapseToEnd();
      // what's typed next is plain again
      if (document.queryCommandState(rule.cmd)) exec(rule.cmd);
      return;
    }
  } finally {
    inputRuleBusy = false;
  }
}

// block shortcuts typed at the start of a paragraph, fired by the space
function richSpace(e, root) {
  if (!mdShortcutsOn()) return false;
  const s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed) return false;
  const li = caretIn(root, 'li');
  if (li) {
    const pre = textBefore(li);
    if (/^\[[ xX]?\]$/.test(pre) && !li.parentElement.classList.contains('tasks')) {
      e.preventDefault();
      deleteBefore(li);
      markTasks(li.parentElement, true);
      li.dataset.checked = /x/i.test(pre) ? 'true' : 'false';
      touched(root);
      return true;
    }
    return false;
  }
  const p = caretIn(root, 'p');
  if (!p || p.classList.contains('scene-break') || p.classList.contains('ghost')) return false;
  if (p.parentElement !== root && p.parentElement.tagName !== 'BLOCKQUOTE') return false;
  const pre = textBefore(p);
  let act = null;
  if (/^#{1,3}$/.test(pre)) act = () => exec('formatBlock', `<h${pre.length}>`);
  else if (pre === '-' || pre === '+') act = () => toggleList(root, 'ul');
  else if (/^\d{1,3}[.)]$/.test(pre)) {
    const n = parseInt(pre, 10);
    act = () => {
      toggleList(root, 'ol');
      const ol = caretIn(root, 'ol');
      if (ol && n > 1) ol.setAttribute('start', n);
    };
  } else if (pre === '>' && p.parentElement === root) act = () => toggleQuote(root);
  else if (/^\[[ xX]?\]$/.test(pre)) act = () => {
    toggleList(root, 'task');
    const now = caretIn(root, 'li');
    if (now) now.dataset.checked = /x/i.test(pre) ? 'true' : 'false';
  };
  if (!act) return false;
  e.preventDefault();
  deleteBefore(p);
  act();
  richNormalize(root);
  touched(root);
  return true;
}

function deleteBefore(el) {
  const s = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(s.anchorNode, s.anchorOffset);
  s.removeAllRanges();
  s.addRange(r);
  exec('delete');
}

function richEnter(e, root) {
  const pre = caretIn(root, 'pre');
  if (pre) {
    e.preventDefault();
    // Enter on an empty last line leaves the code block
    const after = textAfter(pre);
    const before = (() => {
      const s = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(pre);
      r.setEnd(s.anchorNode, s.anchorOffset);
      const d = document.createElement('div');
      d.appendChild(r.cloneContents());
      return preText(d) + (d.lastChild && d.lastChild.nodeName === 'BR' ? '\n' : '');
    })();
    if (!after && (before === '' || before.endsWith('\n'))) {
      structural(root, 'code block', () => {
        while (pre.lastChild && (pre.lastChild.nodeName === 'BR' || (pre.lastChild.nodeType === 3 && !pre.lastChild.data.replace(/\n+$/, '')))) pre.lastChild.remove();
        if (pre.lastChild && pre.lastChild.nodeType === 3) pre.lastChild.data = pre.lastChild.data.replace(/\n+$/, '');
        if (!pre.textContent) pre.innerHTML = '<br>';
        const p = newPara();
        pre.after(p);
        return p;
      });
      return true;
    }
    exec('insertLineBreak');
    return true;
  }
  const cell = caretIn(root, 'td, th');
  if (cell) { e.preventDefault(); moveCell(root, cell, 'down'); return true; }
  const li = caretIn(root, 'li');
  if (li) {
    // an empty item inside a nested list steps back out one level
    if (!li.textContent.trim() && li.parentElement.parentElement && li.parentElement.parentElement.closest('li, ul, ol') && li.parentElement.parentElement !== root) {
      e.preventDefault();
      exec('outdent');
      touched(root);
      return true;
    }
    if (li.parentElement.classList.contains('tasks')) {
      setTimeout(() => {
        const now = caretIn(root, 'li');
        if (now && now !== li) { now.dataset.checked = 'false'; touched(root); }
      }, 0);
    }
    return false;
  }
  const p = caretIn(root, 'p');
  if (p && p.parentElement.tagName === 'BLOCKQUOTE') {
    e.preventDefault();
    if (!p.textContent.trim()) {
      // an empty line in a quote ends it
      const q = p.parentElement;
      structural(root, 'quote', () => {
        const rest = [];
        for (let n = p.nextElementSibling; n; n = n.nextElementSibling) rest.push(n);
        q.after(p);
        if (rest.length) {
          const q2 = document.createElement('blockquote');
          q2.append(...rest);
          p.after(q2);
        }
        if (!q.firstElementChild) q.remove();
        return p;
      });
    } else exec('insertParagraph');
    return true;
  }
  if (p && p.parentElement === root && mdShortcutsOn()) {
    const t = p.textContent.trim();
    const fence = t.match(/^(```|~~~)\s*([\w+#.-]*)$/);
    if (fence) {
      e.preventDefault();
      structural(root, 'code block', () => {
        const c = document.createElement('pre');
        if (fence[2]) c.dataset.lang = fence[2];
        c.innerHTML = '<br>';
        p.replaceWith(c);
        return c;
      });
      return true;
    }
    if (/^(-{3,}|_{3,}|—-|——)$/.test(t)) {
      e.preventDefault();
      structural(root, 'rule', () => {
        const hr = document.createElement('hr');
        const np = newPara();
        p.replaceWith(hr);
        hr.after(np);
        return np;
      });
      return true;
    }
  }
  return false;
}

function richTab(e, root) {
  const cell = caretIn(root, 'td, th');
  if (cell) { e.preventDefault(); moveCell(root, cell, e.shiftKey ? 'prev' : 'next'); return true; }
  const li = caretIn(root, 'li');
  if (li) {
    e.preventDefault();
    exec(e.shiftKey ? 'outdent' : 'indent');
    richNormalize(root);
    touched(root);
    return true;
  }
  return false;
}

function richBackspace(e, root) {
  const s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed) return false;
  const h = caretIn(root, 'h1, h2, h3, h4, h5, h6');
  if (h && textBefore(h) === '') { e.preventDefault(); exec('formatBlock', '<p>'); touched(root); return true; }
  const pre = caretIn(root, 'pre');
  if (pre && textBefore(pre) === '') { e.preventDefault(); toggleCodeBlock(root); return true; }
  const p = caretIn(root, 'p');
  if (p && p.parentElement.tagName === 'BLOCKQUOTE' && p === p.parentElement.firstElementChild && textBefore(p) === '') {
    e.preventDefault();
    const q = p.parentElement;
    structural(root, 'quote', () => {
      q.before(p);
      if (!q.firstElementChild) q.remove();
      return [p, 0];
    });
    return true;
  }
  return false;
}

// called from each editable's keydown before NEO's own handlers
function richKeydown(e, root) {
  if (e.isComposing || e.keyCode === 229) return false;
  lastRootEl = root;
  const mod = e.metaKey || e.ctrlKey;
  if (mod || e.altKey) return false;
  if (e.key === 'Enter' && !e.shiftKey) return richEnter(e, root);
  if (e.key === 'Tab') return richTab(e, root);
  if (e.key === ' ') return richSpace(e, root) || autolinkBeforeSpace(root);
  if (e.key === 'Backspace') return richBackspace(e, root);
  return false;
}

// a web address typed and followed by a space becomes a link
function autolinkBeforeSpace(root) {
  if (!mdShortcutsOn()) return false;
  const s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed) return false;
  const n = s.anchorNode;
  if (!n || n.nodeType !== 3 || n.parentElement.closest('a, pre, code')) return false;
  const before = n.data.slice(0, s.anchorOffset);
  const m = before.match(/(^|\s)((?:https?:\/\/|www\.)[^\s]+[^\s.,;:!?)"'’”])$/i);
  if (!m) return false;
  const href = normalizeHref(m[2]);
  if (!href) return false;
  const r = document.createRange();
  r.setStart(n, m.index + m[1].length);
  r.setEnd(n, s.anchorOffset);
  s.removeAllRanges();
  s.addRange(r);
  exec('createLink', href);
  const sel = window.getSelection();
  sel.collapseToEnd();
  armEscape(inlineBeforeCaret('A') || caretIn(root, 'a'));
  return false; // the space itself still types, just outside the link
}

/* ---------- tables ---------- */

function moveCell(root, cell, dir) {
  const table = cell.closest('table');
  const rows = [...table.rows];
  const tr = cell.parentElement;
  const ri = rows.indexOf(tr);
  const ci = [...tr.cells].indexOf(cell);
  let target = null;
  if (dir === 'next') target = tr.cells[ci + 1] || (rows[ri + 1] && rows[ri + 1].cells[0]);
  else if (dir === 'prev') target = tr.cells[ci - 1] || (rows[ri - 1] && rows[ri - 1].cells[rows[ri - 1].cells.length - 1]);
  else if (dir === 'down') target = rows[ri + 1] && rows[ri + 1].cells[ci];
  if (!target && dir !== 'prev') {
    // off the end: a fresh row
    structural(root, 'table row', () => {
      const nr = tableRowLike(tr, false);
      tr.after(nr);
      return [nr.cells[dir === 'down' ? ci : 0], 0];
    });
    return;
  }
  if (target) richPlaceCaret(target);
}

function tableRowLike(tr, header) {
  const nr = document.createElement('tr');
  for (let k = 0; k < tr.cells.length; k++) {
    const c = document.createElement(header ? 'th' : 'td');
    const a = tr.cells[k].style.textAlign;
    if (a) c.style.textAlign = a;
    c.innerHTML = '<br>';
    nr.appendChild(c);
  }
  return nr;
}

async function tableMenu(root, cell) {
  const table = cell.closest('table');
  const tr = cell.parentElement;
  const ci = [...tr.cells].indexOf(cell);
  const hasHead = !!table.tHead;
  const choice = await optionModal('Table', null, [
    { label: 'Insert row above', value: 'rowAbove' },
    { label: 'Insert row below', value: 'rowBelow' },
    { label: 'Insert column left', value: 'colLeft' },
    { label: 'Insert column right', value: 'colRight' },
    { label: hasHead ? 'Make the first row ordinary' : 'Make the first row a header', value: 'head' },
    { label: 'Align this column…', value: 'align' },
    { label: 'Delete row', value: 'delRow', danger: true },
    { label: 'Delete column', value: 'delCol', danger: true },
    { label: 'Delete table', value: 'delTable', danger: true }
  ]);
  if (!choice) return;
  let align = null;
  if (choice === 'align') {
    align = await optionModal('Align column', null, [
      { label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }
    ]);
    if (!align) return;
  }
  structural(root, 'table edit', () => {
    const rows = [...table.rows];
    if (choice === 'rowAbove' || choice === 'rowBelow') {
      const nr = tableRowLike(tr, false);
      if (choice === 'rowAbove' && tr.parentElement.tagName === 'THEAD') table.tBodies[0].prepend(nr);
      else if (choice === 'rowAbove') tr.before(nr);
      else if (tr.parentElement.tagName === 'THEAD') table.tBodies[0].prepend(nr);
      else tr.after(nr);
      return [nr.cells[ci], 0];
    }
    if (choice === 'colLeft' || choice === 'colRight') {
      for (const r of rows) {
        const ref = r.cells[ci];
        const c = document.createElement(ref && ref.tagName === 'TH' ? 'th' : 'td');
        c.innerHTML = '<br>';
        if (!ref) r.appendChild(c); else if (choice === 'colLeft') ref.before(c); else ref.after(c);
      }
      return [tr.cells[choice === 'colLeft' ? ci : ci + 1], 0];
    }
    if (choice === 'head') {
      if (hasHead) {
        const head = table.tHead.rows[0];
        for (const c of [...head.cells]) { const td = document.createElement('td'); td.append(...c.childNodes); td.style.textAlign = c.style.textAlign; c.replaceWith(td); }
        table.tBodies[0].prepend(head);
        table.tHead.remove();
      } else {
        const first = rows[0];
        const thead = table.createTHead();
        for (const c of [...first.cells]) { const th = document.createElement('th'); th.append(...c.childNodes); th.style.textAlign = c.style.textAlign; c.replaceWith(th); }
        thead.appendChild(first);
      }
      return null;
    }
    if (align) {
      for (const r of rows) if (r.cells[ci]) { if (align === 'left') r.cells[ci].style.removeProperty('text-align'); else r.cells[ci].style.textAlign = align; }
      return null;
    }
    if (choice === 'delRow') {
      if (rows.length <= 1) { const p = newPara(); table.replaceWith(p); return p; }
      const next = rows[rows.indexOf(tr) + 1] || rows[rows.indexOf(tr) - 1];
      tr.remove();
      if (table.tHead && !table.tHead.rows.length) table.tHead.remove();
      return [next.cells[Math.min(ci, next.cells.length - 1)], 0];
    }
    if (choice === 'delCol') {
      if (tr.cells.length <= 1) { const p = newPara(); table.replaceWith(p); return p; }
      for (const r of rows) if (r.cells[ci]) r.cells[ci].remove();
      return [tr.cells[Math.max(0, ci - 1)], 0];
    }
    if (choice === 'delTable') {
      const p = newPara();
      table.replaceWith(p);
      return p;
    }
    return null;
  });
}

/* ---------- paste and drop ---------- */

const fileToBase64 = (f) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = rej;
  r.readAsDataURL(f);
});

// pasted pictures that live somewhere this book can't see get a copy here
async function adoptPastedImages(blocks, bookId) {
  for (const b of walkBlocks(blocks)) {
    if (b.type !== 'image') continue;
    b.bookId = bookId;
    const shown = b.shown;
    delete b.shown;
    if (!bookId) continue;
    const dm = b.src.match(/^data:image\/([\w+.-]+);base64,(.*)$/i);
    if (dm) {
      const rel = await window.neo.saveImageData(bookId, dm[2], dm[1].replace('svg+xml', 'svg'));
      if (rel) b.src = rel;
      continue;
    }
    if (!hasScheme(b.src) && shown && /^file:/i.test(shown) && shown !== mediaUrl(b.src, bookId)) {
      const p = pathFromFileUrl(shown);
      const rel = p && await window.neo.importImage(bookId, p);
      if (rel) b.src = rel;
    }
  }
}

// Put whole blocks in at the caret by hand: the paragraph splits there, the
// first and last pasted paragraphs join its two halves (as pasting does
// everywhere), and everything in between goes in whole. The engine's own
// insertHTML shuffles pictures and lists out of order, so it isn't used.
const isPlainP = (n) => n && n.nodeType === 1 && n.tagName === 'P' && !n.className;
const emptyBlock = (n) => !n.textContent.trim() && !n.querySelector('img, .ph-mark');
function insertBlocksDom(root, blocks) {
  const s = window.getSelection();
  if (!s.rangeCount || !blocks.length) return null;
  const t = document.createElement('template');
  t.innerHTML = blocksToEditorHtml(blocks);
  const nodes = [...t.content.childNodes];
  let placed = null;
  structural(root, 'insert', () => {
    const r = s.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    const at = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    let blk = at.closest('p, h1, h2, h3, h4, h5, h6');
    if (!blk || !root.contains(blk)) {
      // caret between blocks: they simply go in there
      const frag = document.createDocumentFragment();
      frag.append(...nodes);
      r.insertNode(frag);
      placed = nodes[nodes.length - 1];
      return placed;
    }
    const tailRange = document.createRange();
    tailRange.setStart(r.startContainer, r.startOffset);
    tailRange.setEnd(blk, blk.childNodes.length);
    const tail = blk.cloneNode(false);
    tail.appendChild(tailRange.extractContents());
    tail.classList.remove('scene-break', 'ghost');
    if (!tail.className) tail.removeAttribute('class');
    const dropBr = (el) => { if (emptyBlock(el)) el.innerHTML = ''; };
    dropBr(blk);
    if (isPlainP(nodes[0]) && blk.tagName === 'P') {
      const first = nodes.shift();
      if (!emptyBlock(first)) blk.append(...first.childNodes);
    }
    const lastP = isPlainP(nodes[nodes.length - 1]) ? nodes.pop() : null;
    let ref = blk;
    for (const n of nodes) { ref.after(n); ref = n; }
    let caret;
    if (lastP) {
      dropBr(lastP);
      ref.after(lastP);
      caret = [lastP, lastP.textContent.length];
      if (!emptyBlock(tail)) lastP.append(...tail.childNodes);
      if (!lastP.firstChild) lastP.innerHTML = '<br>';
    } else if (!emptyBlock(tail)) {
      ref.after(tail);
      caret = [tail, 0];
    } else {
      const np = newPara();
      ref.after(np);
      caret = [np, 0];
    }
    if (!blk.firstChild) {
      if (blk.nextElementSibling) blk.remove(); else blk.innerHTML = '<br>';
    }
    placed = nodes[nodes.length - 1] || caret[0];
    return caret;
  });
  return placed;
}

function insertBlocks(root, blocks) {
  if (!blocks.length) return;
  if (caretIn(root, 'pre, td, th')) {
    // inside code or a table cell, only the words come in
    const text = blocks.map(blockPlainText).join('\n');
    if (caretIn(root, 'pre')) execHTML(root, escHtml(text));
    else exec('insertText', text.replace(/\n+/g, ' '));
  } else if (blocks.length === 1 && blocks[0].type === 'p') {
    execHTML(root, runsHtml(blocks[0].runs, { marks: true })); // one paragraph slots in inline
    richNormalize(root);
    touched(root);
  } else {
    insertBlocksDom(root, blocks);
  }
  reconcileMarks();
}

async function insertFiles(files, root) {
  const bookId = book && book.id;
  if (!bookId) return false;
  const html = [];
  const pics = [];
  for (const f of files) {
    let p = null;
    try { p = window.neo.pathForFile(f); } catch { /* no path: bytes only */ }
    const isImg = /^image\//.test(f.type) || (p && IMG_FILE_RE.test(p));
    if (isImg) {
      let rel = null;
      if (p) rel = await window.neo.importImage(bookId, p);
      else {
        const named = f.name && !/^image\.\w+$/i.test(f.name) ? f.name.replace(/\.[^.]+$/, '') : undefined;
        rel = await window.neo.saveImageData(bookId, await fileToBase64(f), (f.type.split('/')[1] || 'png').replace('svg+xml', 'svg'), named);
      }
      if (rel) pics.push({ type: 'image', src: rel, alt: '', caption: '', width: 0, bookId });
    } else if (p) {
      html.push(`<a href="${escAttr(fileUrlFromPath(p))}">${escHtml(baseName(p))}</a>&nbsp;`);
    }
  }
  if (!html.length && !pics.length) return false;
  if (html.length) { execHTML(root, html.join('')); touched(root); }
  if (pics.length) insertBlocksDom(root, pics);
  return true;
}

// the paste handler for every editable page
async function richPaste(e, root) {
  e.preventDefault();
  lastRootEl = root;
  const cd = e.clipboardData;
  const bookId = book && book.id;
  const files = [...(cd.files || [])];
  const html = cd.getData('text/html');
  const text = cd.getData('text/plain');
  const htmlHasWords = html && new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
  // copied picture files, screenshots, images copied from a browser
  if (files.length && !htmlHasWords && !caretIn(root, 'pre, td, th')) {
    if (await insertFiles(files, root)) return;
  }
  let blocks = null;
  if (html) blocks = parseHtmlString(html, { loose: true, marks: true, bookId });
  else if (text && looksLikeMarkdown(text) && !caretIn(root, 'pre')) blocks = mdToBlocks(text, {});
  if (blocks) {
    await adoptPastedImages(blocks, bookId);
    insertBlocks(root, blocks);
    return;
  }
  if (!text) return;
  if (caretIn(root, 'pre')) { execHTML(root, escHtml(text.replace(/\r/g, ''))); return; }
  if (root.id === 'aux-editor' || caretIn(root, 'td, th, li')) {
    exec('insertText', caretIn(root, 'td, th') ? text.replace(/\s*\n\s*/g, ' ') : text.replace(/\r/g, ''));
    return;
  }
  const parts = text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim());
  parts.forEach((p, i) => {
    if (i > 0) document.execCommand('insertParagraph');
    document.execCommand('insertText', false, p.trim());
  });
}

function wireDrop(el) {
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files') && e.target.closest && e.target.closest(RICH_EDITABLE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  el.addEventListener('drop', async (e) => {
    const root = e.target.closest && e.target.closest(RICH_EDITABLE);
    if (!root) return;
    const dt = e.dataTransfer;
    const files = [...(dt.files || [])];
    // NEO's own drags (moving a passage) stay native; anything from outside is cleaned
    const foreignHtml = !draggedRange && dt.types.includes('text/html');
    if (!files.length && !foreignHtml) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (pos && root.contains(pos.startContainer)) {
      root.focus({ preventScroll: true });
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(pos);
    }
    lastRootEl = root;
    if (files.length) await insertFiles(files, root);
    else {
      const blocks = parseHtmlString(dt.getData('text/html'), { loose: true, bookId: book && book.id });
      await adoptPastedImages(blocks, book && book.id);
      insertBlocks(root, blocks);
    }
  });
}

/* ================================================================== */
/*  DIALOGS                                                            */
/* ================================================================== */

// a small modal in NEO's own style; resolves with fn's value or null
function richModal(width, html, wire) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal rich-modal" style="width:${width}px">${html}</div>`;
    document.body.appendChild(bd);
    const done = (v) => { bd.remove(); resolve(v); };
    bd.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        e.preventDefault();
        const ok = bd.querySelector('.m-ok');
        if (ok) ok.click();
      }
    });
    const c = bd.querySelector('.m-cancel');
    if (c) c.onclick = () => done(null);
    wire(bd, done);
  });
}

function saveSelection() {
  const s = window.getSelection();
  return s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
}
function restoreSelection(root, range) {
  root.focus({ preventScroll: true });
  if (!range) return;
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(range);
}

async function openLinkDialog(root) {
  const range = saveSelection();
  const a = caretIn(root, 'a[href]');
  const selected = range && !range.collapsed ? range.toString() : '';
  const guess = a ? a.getAttribute('href') : (/^(https?:\/\/|www\.|mailto:|\/|~\/)/i.test(selected.trim()) ? selected.trim() : '');
  const needText = !a && !selected;
  const res = await richModal(460, `
    <h2 style="font-size:16px">${a ? 'Edit link' : 'Add a link'}</h2>
    ${needText || a ? `<label class="rm-label">Text<input class="rm-text" type="text" spellcheck="false"/></label>` : ''}
    <label class="rm-label">Web address, email, or a file on this Mac
      <span class="rm-row"><input class="rm-url" type="text" spellcheck="false" placeholder="https://…   name@example.com   ~/Documents/report.pdf"/>
      <button class="rm-file btn-quiet" type="button">Choose file…</button></span>
    </label>
    <p class="rm-hint">${K('⌘', 'Ctrl')}-click a link while writing to open it. Links to files open in the app your Mac uses for them.</p>
    <div class="rm-actions">
      ${a ? '<button class="rm-remove btn-quiet">Remove link</button>' : ''}
      <span style="flex:1"></span>
      <button class="m-cancel btn-quiet">Cancel</button>
      <button class="m-ok btn-gold">${a ? 'Save' : 'Add link'}</button>
    </div>`, (bd, done) => {
    const url = bd.querySelector('.rm-url');
    const txt = bd.querySelector('.rm-text');
    url.value = a ? displayHref(guess) === guess ? guess : (/^file:/i.test(guess) ? displayHref(guess) : guess) : guess;
    if (txt) txt.value = a ? a.textContent : '';
    (txt && !a ? txt : url).focus();
    bd.querySelector('.rm-file').onclick = async () => {
      const p = await window.neo.pickFile();
      if (p) {
        url.value = p;
        if (txt && !txt.value.trim()) txt.value = baseName(p);
      }
    };
    const rm = bd.querySelector('.rm-remove');
    if (rm) rm.onclick = () => done({ remove: true });
    bd.querySelector('.m-ok').onclick = () => done({ href: url.value, text: txt ? txt.value : null });
  });
  restoreSelection(root, range);
  if (!res) return;
  if (res.remove) {
    const r = document.createRange();
    r.selectNodeContents(a);
    restoreSelection(root, r);
    exec('unlink');
    touched(root);
    return;
  }
  const href = normalizeHref(res.href);
  if (!href) { toast('That doesn’t look like a web address, email, or file path'); return; }
  if (a) {
    structural(root, 'link', () => {
      a.setAttribute('href', href);
      if (res.text != null && res.text.trim() && res.text !== a.textContent) a.textContent = res.text;
      return [a, Infinity];
    });
    return;
  }
  if (!range || range.collapsed) {
    execHTML(root, `<a href="${escAttr(href)}">${escHtml((res.text || '').trim() || displayHref(href))}</a>`);
    armEscape(inlineBeforeCaret('A'));
  } else exec('createLink', href);
  touched(root);
}

async function openImageDialog(root, replace) {
  if (!book) return;
  const range = saveSelection();
  const res = await richModal(480, `
    <h2 style="font-size:16px">${replace ? 'Replace image' : 'Insert an image'}</h2>
    <div class="rm-row"><button class="rm-pick btn-quiet" type="button">Choose a picture…</button><span class="rm-picked soft">No file chosen</span></div>
    <label class="rm-check"><input class="rm-linkonly" type="checkbox"/> Link to the original instead of copying it into this book</label>
    <label class="rm-label">…or a web address or file path
      <input class="rm-url" type="text" spellcheck="false" placeholder="https://example.com/photo.jpg   or   ~/Pictures/photo.jpg"/></label>
    <label class="rm-label">Caption <span class="soft">(optional — also used as the description for screen readers)</span>
      <input class="rm-cap" type="text" spellcheck="false"/></label>
    <div class="rm-actions"><span style="flex:1"></span>
      <button class="m-cancel btn-quiet">Cancel</button>
      <button class="m-ok btn-gold">${replace ? 'Replace' : 'Insert'}</button></div>`, (bd, done) => {
    let picked = null;
    const cap = bd.querySelector('.rm-cap');
    if (replace) {
      const img = replace.querySelector('img');
      cap.value = (replace.querySelector('figcaption') || {}).textContent || (img && img.alt) || '';
    }
    bd.querySelector('.rm-pick').onclick = async () => {
      const p = await window.neo.pickImage();
      if (p) { picked = p; bd.querySelector('.rm-picked').textContent = baseName(p); bd.querySelector('.rm-url').value = ''; }
    };
    bd.querySelector('.rm-pick').focus();
    bd.querySelector('.m-ok').onclick = () => done({
      picked,
      url: bd.querySelector('.rm-url').value.trim(),
      linkOnly: bd.querySelector('.rm-linkonly').checked,
      caption: cap.value.trim()
    });
  });
  restoreSelection(root, range);
  if (!res || (!res.picked && !res.url)) return;
  let src = null;
  if (res.picked) src = res.linkOnly ? fileUrlFromPath(res.picked) : await window.neo.importImage(book.id, res.picked);
  else {
    let u = res.url.replace(/^["']|["']$/g, '');
    if (u.startsWith('~/') && homeDir) u = homeDir + u.slice(1);
    src = u.startsWith('/') ? fileUrlFromPath(u) : /^www\./i.test(u) ? 'https://' + u : safeImgSrc(u);
  }
  if (!src) { toast('NEO couldn’t use that picture'); return; }
  const b = { type: 'image', src, alt: res.caption, caption: res.caption, width: replace ? (+replace.dataset.width || 0) : 0, bookId: book.id };
  if (replace) {
    structural(root, 'image', () => {
      const t = document.createElement('template');
      t.innerHTML = figureHtml(b);
      const fig = t.content.firstElementChild;
      replace.replaceWith(fig);
      return null;
    });
    return;
  }
  if (caretIn(root, 'li, td, th, pre')) { toast('Pictures sit between paragraphs — not inside a list, table, or code'); return; }
  insertBlocksDom(root, [b]);
}

async function openTableDialog(root) {
  if (caretIn(root, 'li, td, th, pre')) { toast('Tables sit between paragraphs — not inside a list, table, or code'); return; }
  const range = saveSelection();
  const res = await richModal(360, `
    <h2 style="font-size:16px">Insert a table</h2>
    <div class="rm-row">
      <label class="rm-label rm-num">Columns<input class="rm-cols" type="number" min="1" max="12" value="3"/></label>
      <label class="rm-label rm-num">Rows<input class="rm-rows" type="number" min="1" max="100" value="3"/></label>
    </div>
    <label class="rm-check"><input class="rm-head" type="checkbox" checked/> First row is a header</label>
    <p class="rm-hint">Tab moves between cells (and adds a row at the end). Right-click a cell for rows, columns and alignment.</p>
    <div class="rm-actions"><span style="flex:1"></span>
      <button class="m-cancel btn-quiet">Cancel</button><button class="m-ok btn-gold">Insert</button></div>`, (bd, done) => {
    bd.querySelector('.rm-cols').focus();
    bd.querySelector('.rm-cols').select();
    bd.querySelector('.m-ok').onclick = () => done({
      cols: Math.max(1, Math.min(12, parseInt(bd.querySelector('.rm-cols').value, 10) || 3)),
      rows: Math.max(1, Math.min(100, parseInt(bd.querySelector('.rm-rows').value, 10) || 3)),
      head: bd.querySelector('.rm-head').checked
    });
  });
  restoreSelection(root, range);
  if (!res) return;
  const rows = Array.from({ length: res.rows }, (_, k) => ({
    header: res.head && k === 0,
    cells: Array.from({ length: res.cols }, () => ({ runs: [], align: '' }))
  }));
  const t = insertBlocksDom(root, [{ type: 'table', rows }]);
  // caret into the first cell, ready to type
  if (t && t.tagName === 'TABLE' && t.rows[0]) richPlaceCaret(t.rows[0].cells[0], 0);
}

/* ================================================================== */
/*  TOOLBAR · LINK CARD · PICTURE CARD                                 */
/* ================================================================== */

const ICON = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
const BAR_ITEMS = [
  ['bold', '<b>B</b>', 'Bold', K('⌘B', 'Ctrl+B')],
  ['italic', '<i>I</i>', 'Italic', K('⌘I', 'Ctrl+I')],
  ['strike', '<s>S</s>', 'Strikethrough', K('⌘⇧S', 'Ctrl+Shift+S')],
  ['code', ICON('<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>'), 'Inline code', K('⌘⇧C', 'Ctrl+Shift+C')],
  ['link', ICON('<path d="M6.6 9.4l2.8-2.8"/><path d="M7.2 4.6l.9-.9a2.8 2.8 0 0 1 4 4l-.9.9"/><path d="M8.8 11.4l-.9.9a2.8 2.8 0 0 1-4-4l.9-.9"/>'), 'Link', K('⌘K', 'Ctrl+K')],
  '|',
  ['p', '<span class="fb-t">¶</span>', 'Body text', K('⌘⌥0', 'Ctrl+Alt+0')],
  ['h1', '<span class="fb-t">H1</span>', 'Heading 1', K('⌘⌥1', 'Ctrl+Alt+1')],
  ['h2', '<span class="fb-t">H2</span>', 'Heading 2', K('⌘⌥2', 'Ctrl+Alt+2')],
  ['h3', '<span class="fb-t">H3</span>', 'Heading 3', K('⌘⌥3', 'Ctrl+Alt+3')],
  '|',
  ['ul', ICON('<circle cx="3" cy="4" r="1.1" class="fill"/><circle cx="3" cy="8" r="1.1" class="fill"/><circle cx="3" cy="12" r="1.1" class="fill"/><path d="M6.5 4h7.5M6.5 8h7.5M6.5 12h7.5"/>'), 'Bulleted list', K('⌘⇧8', 'Ctrl+Shift+8')],
  ['ol', ICON('<path d="M2.2 2.8h1v3M2 6h2.2M2 9.6c.3-.6 2-.7 2 .3 0 .8-2 1.2-2 2.3h2.2"/><path d="M6.5 4h7.5M6.5 8h7.5M6.5 12h7.5"/>'), 'Numbered list', K('⌘⇧7', 'Ctrl+Shift+7')],
  ['task', ICON('<rect x="1.8" y="2.3" width="3.6" height="3.6" rx=".8"/><path d="M2.3 10.6l1 1 1.9-2.1"/><path d="M7.5 4.1h6.5M7.5 10.5h6.5"/>'), 'Checklist', K('⌘⇧9', 'Ctrl+Shift+9')],
  '|',
  ['quote', ICON('<path class="fill" d="M2.2 9.6c0-2.9 1.4-4.9 3.8-5.8l.5 1c-1.3.6-2 1.5-2.2 2.6.2-.1.5-.1.8-.1 1 0 1.8.8 1.8 1.9S6 11.2 4.8 11.2c-1.5 0-2.6-.8-2.6-1.6zm6.7 0c0-2.9 1.4-4.9 3.8-5.8l.5 1c-1.3.6-2 1.5-2.2 2.6.2-.1.5-.1.8-.1 1 0 1.8.8 1.8 1.9s-.8 2-2 2c-1.5 0-2.7-.8-2.7-1.6z"/>'), 'Block quote', K('⌘⌥Q', 'Ctrl+Alt+Q')],
  ['codeblock', ICON('<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2"/><path d="M6.2 6.3 4.5 8l1.7 1.7M9.8 6.3 11.5 8l-1.7 1.7"/>'), 'Code block', K('⌘⌥C', 'Ctrl+Alt+C')],
  '|',
  ['image', ICON('<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="2"/><circle cx="5.4" cy="6.1" r="1.2"/><path d="M2 12.2l3.8-3.8 2.9 2.9 1.9-1.9 3.4 3.4"/>'), 'Image', K('⌘⇧P', 'Ctrl+Shift+P')],
  ['table', ICON('<rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6"/><path d="M1.6 6.3h12.8M1.6 9.9h12.8M6 6.3v7.1M10.2 6.3v7.1"/>'), 'Table', K('⌘⌥T', 'Ctrl+Alt+T')],
  ['hr', ICON('<path d="M2 8h12"/><path d="M5 4.5h6M5 11.5h6" class="faint"/>'), 'Horizontal rule', K('⌘⌥R', 'Ctrl+Alt+R')],
  '|',
  ['clear', ICON('<path d="M4 3.5h8M8.3 3.5 6.5 12"/><path d="M10.2 10.2l3.6 3.6M13.8 10.2l-3.6 3.6"/>'), 'Clear formatting', ''],
  '|',
  ['darling', ICON('<path d="M8 13.2S2.3 9.9 2.3 6.1A2.9 2.9 0 0 1 8 4.8a2.9 2.9 0 0 1 5.7 1.3C13.7 9.9 8 13.2 8 13.2z"/>'), 'Send selection to Darlings', KDA],
  ['shortcuts', ICON('<rect x="1.3" y="4" width="13.4" height="8.4" rx="1.6"/><path d="M3.8 6.5h.01M6.3 6.5h.01M8.8 6.5h.01M11.3 6.5h.01M3.8 8.7h.01M11.3 8.7h.01M5.6 10.4h4.8M6.3 8.7h3.4"/>'), 'All keyboard shortcuts', K('⌘/', 'Ctrl+/')]
];

const fmtBar = document.createElement('div');
fmtBar.id = 'fmt-bar';
fmtBar.setAttribute('role', 'toolbar');
fmtBar.setAttribute('aria-label', 'Formatting');
fmtBar.innerHTML = BAR_ITEMS.map((it) => (it === '|' ? '<span class="sep"></span>'
  : `<button data-cmd="${it[0]}" data-tip="${it[2]}" data-keys="${it[3]}" aria-label="${it[2]}${it[3] ? ' (' + it[3] + ')' : ''}">${it[1]}</button>`)).join('');
$('#editor-view').appendChild(fmtBar);

// tooltips that answer in a quarter of a second, with the shortcut beside the name
const fmtTip = document.createElement('div');
fmtTip.id = 'fmt-tip';
fmtTip.hidden = true;
document.body.appendChild(fmtTip);
let tipTimer = null;
let tipWarm = false; // once one tip has shown, moving along the bar shows the next at once
fmtBar.addEventListener('mouseover', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    fmtTip.innerHTML = `${escHtml(b.dataset.tip)}${b.dataset.keys ? `<span class="tip-keys">${escHtml(b.dataset.keys)}</span>` : ''}`;
    fmtTip.hidden = false;
    const r = b.getBoundingClientRect();
    const w = fmtTip.offsetWidth;
    fmtTip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
    fmtTip.style.top = (r.bottom + 8) + 'px';
    tipWarm = true;
  }, tipWarm ? 0 : 250);
});
fmtBar.addEventListener('mouseleave', () => {
  clearTimeout(tipTimer);
  fmtTip.hidden = true;
  tipTimer = setTimeout(() => { tipWarm = false; }, 400);
});
fmtBar.addEventListener('mousedown', () => { fmtTip.hidden = true; });

fmtBar.addEventListener('mousedown', (e) => {
  const b = e.target.closest('button');
  e.preventDefault(); // the writing keeps its selection
  if (b) runRich(b.dataset.cmd);
});

let barHover = false;
let barNear = false;
fmtBar.addEventListener('mouseenter', () => { barHover = true; updateBarVisibility(); });
fmtBar.addEventListener('mouseleave', () => { barHover = false; updateBarVisibility(); });

function barAllowed() {
  return !!book && !$('#editor-view').hidden && currentTab !== 'outline' && currentTab !== 'darlings' &&
    $('#searchbar').hidden && !document.querySelector('.modal-backdrop:not([hidden])');
}
function updateBarVisibility() {
  const s = window.getSelection();
  const selecting = s && !s.isCollapsed && richRoot();
  const show = barAllowed() && (library.fmtBarPinned || barHover || barNear || selecting);
  fmtBar.classList.toggle('show', !!show);
}

// the bar wakes when the pointer drifts to the top of the page, or when
// text is selected; it sleeps again as soon as typing resumes
document.addEventListener('mousemove', (e) => {
  const near = e.clientY < 110 && e.clientY > 20;
  if (near !== barNear) { barNear = near; updateBarVisibility(); }
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.key.length !== 1) return;
  if (barNear && !barHover) { barNear = false; updateBarVisibility(); }
}, true);

function refreshBar() {
  const root = richRoot();
  if (root) lastRootEl = root;
  const q = (sel) => !!(root && caretIn(root, sel));
  const state = {};
  if (root) {
    state.bold = document.queryCommandState('bold') && !q('h1,h2,h3');
    state.italic = document.queryCommandState('italic');
    state.strike = document.queryCommandState('strikeThrough');
    state.code = q('code') && !q('pre');
    state.link = q('a[href]');
    state.h1 = q('h1'); state.h2 = q('h2'); state.h3 = q('h3');
    state.quote = q('blockquote');
    state.codeblock = q('pre');
    const li = caretIn(root, 'li');
    state.task = !!(li && li.parentElement.classList.contains('tasks'));
    state.ul = !!(li && li.parentElement.tagName === 'UL' && !state.task);
    state.ol = !!(li && li.parentElement.tagName === 'OL');
    state.p = q('p') && !state.quote;
    state.table = q('table');
  }
  for (const b of fmtBar.querySelectorAll('button')) b.classList.toggle('on', !!state[b.dataset.cmd]);
}

let barRAF = null;
document.addEventListener('selectionchange', () => {
  if (barRAF) return;
  barRAF = requestAnimationFrame(() => {
    barRAF = null;
    if (!book) return;
    refreshBar();
    updateBarVisibility();
    updateLinkCard();
  });
});

/* ---------- the link card ---------- */

const linkCard = document.createElement('div');
linkCard.id = 'link-card';
linkCard.hidden = true;
linkCard.innerHTML = '<span class="lc-url"></span><button data-a="open">Open</button><button data-a="edit">Edit</button><button data-a="unlink">Remove</button>';
document.body.appendChild(linkCard);
let cardLink = null;
let cardHover = false;
let hoverTimer = null;

function openHref(href) {
  if (!href) return;
  window.neo.openLink(href, book && book.id).then((ok) => {
    if (!ok) toast(/^file:|^[^:]+$/i.test(href) ? 'That file isn’t where the link says — it may have moved' : 'Couldn’t open that link');
  });
}

function showLinkCard(a) {
  cardLink = a;
  const href = a.getAttribute('href');
  const u = linkCard.querySelector('.lc-url');
  u.textContent = displayHref(href);
  u.title = displayHref(href);
  linkCard.classList.toggle('lc-file', !/^(https?|mailto|tel):/i.test(href));
  const editable = !!a.closest(RICH_EDITABLE);
  linkCard.querySelector('[data-a="edit"]').hidden = !editable;
  linkCard.querySelector('[data-a="unlink"]').hidden = !editable;
  linkCard.hidden = false;
  const r = a.getBoundingClientRect();
  const w = linkCard.offsetWidth;
  linkCard.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  const below = r.bottom + 6;
  linkCard.style.top = (below + linkCard.offsetHeight > window.innerHeight - 50 ? r.top - linkCard.offsetHeight - 6 : below) + 'px';
}
function hideLinkCard() { linkCard.hidden = true; cardLink = null; }

function updateLinkCard() {
  const s = window.getSelection();
  const root = richRoot();
  const a = root && s.isCollapsed ? caretIn(root, 'a[href]') : null;
  if (a) showLinkCard(a);
  else if (!cardHover && cardLink && !cardLink.matches(':hover')) hideLinkCard();
}

linkCard.addEventListener('mouseenter', () => { cardHover = true; clearTimeout(hoverTimer); });
linkCard.addEventListener('mouseleave', () => { cardHover = false; hoverTimer = setTimeout(updateLinkCard, 250); });
linkCard.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const b = e.target.closest('button');
  const a = cardLink;
  if (!b || !a) return;
  const root = a.closest(RICH_EDITABLE);
  if (b.dataset.a === 'open') openHref(a.getAttribute('href'));
  if (b.dataset.a === 'edit' && root) { richPlaceCaret(a, 1); hideLinkCard(); openLinkDialog(root); }
  if (b.dataset.a === 'unlink' && root) {
    const r = document.createRange();
    r.selectNodeContents(a);
    restoreSelection(root, r);
    exec('unlink');
    touched(root);
    hideLinkCard();
  }
});

document.addEventListener('mouseover', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || !a.closest('.chapter-body, #aux-editor, .darling')) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => showLinkCard(a), 350);
  a.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (!cardHover) updateLinkCard(); }, 300);
  }, { once: true });
});
$('#paper-scroll').addEventListener('scroll', () => { if (!linkCard.hidden) hideLinkCard(); hidePicCard(); }, { passive: true });

// links never navigate the app; ⌘-click (or any click where you can't type) opens them
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.closest('#link-card')) return;
  e.preventDefault();
  if (!a.closest('.chapter-body, #aux-editor, .darling, .modal')) return;
  if (!a.isContentEditable || e.metaKey || e.ctrlKey) openHref(a.getAttribute('href'));
}, true);

/* ---------- the picture card ---------- */

const picCard = document.createElement('div');
picCard.id = 'pic-card';
picCard.hidden = true;
picCard.innerHTML = `
  <button data-w="25" title="Quarter width">S</button><button data-w="50" title="Half width">M</button>
  <button data-w="75" title="Three-quarter width">L</button><button data-w="100" title="Full width">Full</button>
  <span class="sep"></span>
  <button data-a="caption">Caption…</button><button data-a="replace">Replace…</button>
  <button data-a="open">Open</button><button data-a="remove" class="danger">Remove</button>`;
document.body.appendChild(picCard);
let picFig = null;

function selectPic(fig) {
  if (picFig && picFig !== fig) picFig.classList.remove('selected');
  picFig = fig;
  fig.classList.add('selected');
  const w = +fig.dataset.width || 100;
  for (const b of picCard.querySelectorAll('[data-w]')) b.classList.toggle('on', +b.dataset.w === w);
  picCard.hidden = false;
  const r = fig.querySelector('img').getBoundingClientRect();
  picCard.style.left = Math.max(8, Math.min(r.left + r.width / 2 - picCard.offsetWidth / 2, window.innerWidth - picCard.offsetWidth - 8)) + 'px';
  picCard.style.top = Math.max(34, r.top + 8) + 'px';
}
function hidePicCard() {
  if (picFig) picFig.classList.remove('selected');
  picFig = null;
  picCard.hidden = true;
}

document.addEventListener('mousedown', (e) => {
  if (picCard.contains(e.target)) return;
  const fig = e.target.closest && e.target.closest('figure.neo-img');
  if (fig && fig.closest(RICH_EDITABLE)) {
    e.preventDefault();
    lastRootEl = fig.closest(RICH_EDITABLE);
    selectPic(fig);
    return;
  }
  hidePicCard();
}, true);

document.addEventListener('dblclick', (e) => {
  const fig = e.target.closest && e.target.closest('figure.neo-img');
  if (fig) { const img = fig.querySelector('img'); openHref(img && img.dataset.src); }
});

// with a picture selected, Delete removes it and Escape lets go
document.addEventListener('keydown', (e) => {
  if (!picFig) return;
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    e.stopPropagation();
    picAction('remove');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    hidePicCard();
  } else if (!e.metaKey && !e.ctrlKey) hidePicCard();
}, true);

picCard.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const b = e.target.closest('button');
  if (!b || !picFig) return;
  if (b.dataset.w) {
    const fig = picFig;
    const root = fig.closest(RICH_EDITABLE);
    structural(root, 'image size', () => {
      if (b.dataset.w === '100') delete fig.dataset.width; else fig.dataset.width = b.dataset.w;
      return null;
    });
    requestAnimationFrame(() => selectPic(fig));
    return;
  }
  picAction(b.dataset.a);
});

async function picAction(a) {
  const fig = picFig;
  if (!fig) return;
  const root = fig.closest(RICH_EDITABLE);
  const img = fig.querySelector('img');
  if (a === 'open') { openHref(img.dataset.src); return; }
  hidePicCard();
  if (a === 'remove') {
    structural(root, 'image removed', () => {
      const next = fig.nextElementSibling || fig.previousElementSibling;
      fig.remove();
      return next && next.matches(CARET_BLOCKS) ? next : null;
    });
  }
  if (a === 'replace') openImageDialog(root, fig);
  if (a === 'caption') {
    const cur = (fig.querySelector('figcaption') || {}).textContent || img.alt || '';
    const cap = await askInput('Caption', 'Shown under the picture — blank for none', cur);
    if (cap === null) return;
    structural(root, 'caption', () => {
      let fc = fig.querySelector('figcaption');
      if (cap) {
        if (!fc) { fc = document.createElement('figcaption'); fig.appendChild(fc); }
        fc.textContent = cap;
      } else if (fc) fc.remove();
      img.alt = cap;
      return null;
    });
  }
}

/* ---------- checklists ---------- */

document.addEventListener('mousedown', (e) => {
  const li = e.target.closest && e.target.closest('ul.tasks > li');
  if (!li) return;
  const root = li.closest(RICH_EDITABLE);
  if (!root) return;
  // the box is the strip left of the text
  if (e.clientX > li.getBoundingClientRect().left + parseFloat(getComputedStyle(li).paddingLeft)) return;
  e.preventDefault();
  li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
  touched(root);
});

/* ---------- right-click a table cell ---------- */

document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  const cell = e.target.closest && e.target.closest('td, th');
  const root = cell && cell.closest(RICH_EDITABLE);
  if (!root) return;
  e.preventDefault();
  tableMenu(root, cell);
});

/* ---------- wiring ---------- */

wireDrop($('#chapters'));
wireDrop($('#aux-editor'));
$('#aux-editor').addEventListener('keydown', (e) => { richKeydown(e, $('#aux-editor')); });
$('#aux-editor').addEventListener('input', (e) => richInputRules(e, $('#aux-editor')));

// after the library loads: menu checkmarks follow the saved settings
function richInit() {
  window.neo.setMenuChecked({ mdShortcuts: library.mdShortcuts !== false, fmtBarPinned: !!library.fmtBarPinned });
}

function richMenu(msg) {
  if (msg.type === 'rich') runRich(msg.cmd);
  if (msg.type === 'mdShortcuts') {
    library.mdShortcuts = !!msg.value;
    window.neo.writeLibrary(library);
    toast(msg.value ? 'Markdown shortcuts on — # heading, - list, **bold**, [text](link)…' : 'Markdown shortcuts off');
  }
  if (msg.type === 'fmtBarPinned') {
    library.fmtBarPinned = !!msg.value;
    window.neo.writeLibrary(library);
    updateBarVisibility();
  }
}

/* ================================================================== */
/*  IMPORT                                                             */
/*  main.js hands over the raw file; here it becomes blocks, then      */
/*  chapters (page breaks and "Chapter N" lines), then a book.         */
/* ================================================================== */

/* ---------- .docx ---------- */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docxToBlocks(r) {
  const parse = (s) => (s ? new DOMParser().parseFromString(s, 'application/xml') : null);
  const kid = (el, name) => (el ? [...el.children].find((c) => c.localName === name) : null);
  const wv = (el, name = 'val') => (el ? el.getAttributeNS(W_NS, name) || el.getAttribute('w:' + name) : null);
  const on = (el) => !!el && !/^(0|false|off|none)$/i.test(wv(el) || '');
  const rid = (el, name) => el.getAttributeNS(R_NS, name) || el.getAttribute('r:' + name);

  const rels = {};
  const relDoc = parse(r.rels);
  if (relDoc) {
    for (const rel of relDoc.getElementsByTagName('Relationship')) {
      rels[rel.getAttribute('Id')] = { target: rel.getAttribute('Target'), external: rel.getAttribute('TargetMode') === 'External' };
    }
  }
  const styles = {};
  const styleDoc = parse(r.styles);
  if (styleDoc) {
    for (const s of styleDoc.getElementsByTagNameNS(W_NS, 'style')) {
      const rPr = kid(s, 'rPr');
      const fonts = kid(rPr, 'rFonts');
      styles[wv(s, 'styleId')] = {
        name: (wv(kid(s, 'name')) || '').toLowerCase(),
        basedOn: wv(kid(s, 'basedOn')),
        outline: wv(kid(kid(s, 'pPr'), 'outlineLvl')),
        mono: !!(fonts && /courier|consolas|menlo|monaco|mono|source code/i.test(wv(fonts, 'ascii') || '')),
        b: on(kid(rPr, 'b')), i: on(kid(rPr, 'i'))
      };
    }
  }
  const styleName = (id) => {
    for (let s = styles[id], n = 0; s && n < 8; s = styles[s.basedOn], n++) {
      if (/^(heading \d|title|subtitle)$/.test(s.name) || /quote|code|preformat|source|list/.test(s.name)) return s.name;
    }
    return (styles[id] && styles[id].name) || String(id || '').toLowerCase();
  };
  // numbering: numId → level → bullet or number
  const nums = {};
  const numDoc = parse(r.numbering);
  if (numDoc) {
    const abs = {};
    for (const a of numDoc.getElementsByTagNameNS(W_NS, 'abstractNum')) {
      const lv = {};
      for (const l of a.getElementsByTagNameNS(W_NS, 'lvl')) {
        lv[wv(l, 'ilvl')] = { fmt: wv(kid(l, 'numFmt')) || 'bullet', start: parseInt(wv(kid(l, 'start')), 10) || 1 };
      }
      abs[wv(a, 'abstractNumId')] = lv;
    }
    for (const n of numDoc.getElementsByTagNameNS(W_NS, 'num')) nums[wv(n, 'numId')] = abs[wv(kid(n, 'abstractNumId'))] || {};
  }

  const hrefFor = (target) => (target ? safeHref(/^[a-z]+:/i.test(target) ? target : (r.dir ? fileUrlFromPath(joinPath(r.dir, safeDecode(target))) : target)) : null);

  function runsOf(p) {
    const out = [];
    let field = null;
    let pageBreak = false;
    const walk = (node, href) => {
      for (const c of node.children) {
        switch (c.localName) {
          case 'r': runOf(c, href || (field && field.phase === 'result' ? field.href : null)); break;
          case 'hyperlink': {
            const id = rid(c, 'id');
            walk(c, (id && rels[id] && hrefFor(rels[id].target)) || href);
            break;
          }
          case 'fldSimple': {
            const m = (wv(c, 'instr') || '').match(/HYPERLINK\s+"([^"]+)"/);
            walk(c, m ? hrefFor(m[1]) : href);
            break;
          }
          case 'ins': case 'smartTag': case 'customXml': case 'sdt': case 'sdtContent': case 'bdo': case 'dir':
            walk(c, href);
            break;
          default: break; // w:del, w:moveFrom: deleted words stay deleted
        }
      }
    };
    const runOf = (rEl, href) => {
      const rPr = kid(rEl, 'rPr');
      const rs = styles[wv(kid(rPr, 'rStyle'))] || {};
      const fonts = kid(rPr, 'rFonts');
      const fmt = {
        b: kid(rPr, 'b') ? on(kid(rPr, 'b')) : !!rs.b,
        i: kid(rPr, 'i') ? on(kid(rPr, 'i')) : !!rs.i,
        s: on(kid(rPr, 'strike')) || on(kid(rPr, 'dstrike')),
        code: rs.mono || !!(fonts && /courier|consolas|menlo|monaco|mono|source code/i.test(wv(fonts, 'ascii') || ''))
      };
      if (href) fmt.href = href;
      for (const c of rEl.children) {
        switch (c.localName) {
          case 'fldChar': {
            const t = wv(c, 'fldCharType');
            if (t === 'begin') field = { instr: '', phase: 'instr' };
            else if (t === 'separate' && field) {
              const m = field.instr.match(/HYPERLINK\s+"([^"]+)"/);
              field.href = m ? hrefFor(m[1]) : null;
              field.phase = 'result';
            } else if (t === 'end') field = null;
            break;
          }
          case 'instrText': if (field) field.instr += c.textContent; break;
          case 't': if (!field || field.phase === 'result') out.push({ ...fmt, text: c.textContent }); break;
          case 'tab': out.push({ ...fmt, text: '\t' }); break;
          case 'br': if (wv(c, 'type') === 'page') pageBreak = true; else out.push({ ...fmt, text: '\n' }); break;
          case 'cr': out.push({ ...fmt, text: '\n' }); break;
          case 'noBreakHyphen': out.push({ ...fmt, text: '-' }); break;
          case 'drawing': case 'pict': case 'object': {
            const blip = c.getElementsByTagNameNS('*', 'blip')[0] || c.getElementsByTagNameNS('*', 'imagedata')[0];
            const id = blip && (rid(blip, 'embed') || rid(blip, 'link') || rid(blip, 'id'));
            const rel = id && rels[id];
            if (!rel) break;
            const pr = c.getElementsByTagNameNS('*', 'docPr')[0];
            const alt = pr ? (pr.getAttribute('descr') || pr.getAttribute('title') || '') : '';
            const ext = c.getElementsByTagNameNS('*', 'extent')[0];
            const width = ext ? Math.min(100, Math.round((+ext.getAttribute('cx') / 5486400) * 100)) : 0;
            const img = { type: 'image', src: '', alt, caption: '', width: snapWidth(width), bookId: null };
            if (rel.external) img.src = safeImgSrc(rel.target) || '';
            else {
              const key = rel.target.startsWith('/') ? rel.target.slice(1) : 'word/' + rel.target.replace(/^\.\//, '');
              const data = r.media && r.media[key];
              const slug = (alt || r.name || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
              if (data) img.pending = { kind: 'data', base64: data, ext: key.split('.').pop().toLowerCase(), name: slug };
            }
            if (img.src || img.pending) out.push({ mdImg: img });
            break;
          }
          default: break;
        }
      }
    };
    walk(p, null);
    return { runs: out, pageBreak };
  }

  function paraInfo(p) {
    const pPr = kid(p, 'pPr');
    const sName = styleName(wv(kid(pPr, 'pStyle')));
    const numPr = kid(pPr, 'numPr');
    const { runs, pageBreak } = runsOf(p);
    const jc = wv(kid(pPr, 'jc'));
    const border = kid(kid(pPr, 'pBdr'), 'bottom') || kid(kid(pPr, 'pBdr'), 'top');
    const info = {
      rule: !!border && !/^(nil|none)$/i.test(wv(border) || ''),
      caption: sName === 'caption',
      runs,
      pageBreak: pageBreak || on(kid(pPr, 'pageBreakBefore')),
      align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' ? 'justify' : '',
      style: sName
    };
    const hm = sName.match(/^heading (\d)$/);
    const outline = wv(kid(pPr, 'outlineLvl'));
    if (sName === 'title') info.heading = 1, info.title = true;
    else if (hm) info.heading = +hm[1];
    else if (outline != null && +outline < 6) info.heading = +outline + 1;
    if (sName === 'subtitle') info.subtitle = true;
    if (/quote/.test(sName)) info.quote = true;
    if (/code|preformat|source|plain text/.test(sName) || (runs.length && runs.every((x) => x.mdImg || x.code || !x.text.trim()) && runs.some((x) => x.code && x.text.trim()))) info.code = true;
    const numId = numPr ? wv(kid(numPr, 'numId')) : null;
    if (numId && numId !== '0') {
      const lvl = parseInt(wv(kid(numPr, 'ilvl')), 10) || 0;
      const def = (nums[numId] || {})[lvl] || {};
      info.list = { lvl, ordered: !!def.fmt && def.fmt !== 'bullet' && def.fmt !== 'none', start: def.start || 1, numId };
    } else if (/list bullet/.test(sName)) info.list = { lvl: 0, ordered: false, start: 1 };
    else if (/list number/.test(sName)) info.list = { lvl: 0, ordered: true, start: 1 };
    return info;
  }

  function tableBlock(tbl) {
    const rows = [];
    for (const tr of [...tbl.children].filter((c) => c.localName === 'tr')) {
      const header = on(kid(kid(tr, 'trPr'), 'tblHeader'));
      const cells = [...tr.children].filter((c) => c.localName === 'tc').map((tc) => {
        const runs = [];
        let align = '';
        for (const p of tc.getElementsByTagNameNS(W_NS, 'p')) {
          const info = paraInfo(p);
          if (runs.length) runs.push({ text: '\n' });
          runs.push(...info.runs.filter((x) => !x.mdImg));
          align = align || (info.align === 'justify' ? '' : info.align);
        }
        const clean = tidyRuns(runs, { trim: true });
        if (header) for (const x of clean) delete x.b;
        return { runs: clean, align };
      });
      if (cells.length) rows.push({ header, cells });
    }
    if (!rows.length) return null;
    const cols = Math.max(...rows.map((x) => x.cells.length));
    for (const x of rows) while (x.cells.length < cols) x.cells.push({ runs: [], align: '' });
    return { type: 'table', rows };
  }

  const doc = parse(r.xml);
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  const out = [];
  let listStack = null; // [{list, lvl}]
  let pendingBreak = false;
  const push = (b) => {
    if (pendingBreak) { b.pageBreak = true; pendingBreak = false; }
    out.push(b);
  };

  const visit = (el) => {
    for (const c of el.children) {
      if (c.localName === 'sdt') { const content = kid(c, 'sdtContent'); if (content) visit(content); continue; }
      if (c.localName === 'tbl') {
        listStack = null;
        const t = tableBlock(c);
        if (t) push(t);
        continue;
      }
      if (c.localName !== 'p') continue;
      const info = paraInfo(c);
      const text = runsText(info.runs.filter((x) => !x.mdImg));
      if (info.list && text.trim()) {
        const item = { runs: tidyRuns(info.runs, { trim: true }), checked: null, children: [] };
        const glyph = item.runs[0] && item.runs[0].text && item.runs[0].text.match(/^([☐☑☒])\s*/);
        if (glyph) { item.checked = glyph[1] !== '☐'; item.runs[0].text = item.runs[0].text.slice(glyph[0].length); }
        const lvl = Math.min(info.list.lvl, 8);
        if (!listStack) {
          const l = { type: 'list', ordered: info.list.ordered, start: info.list.start, task: false, items: [] };
          push(l);
          listStack = [l];
        }
        while (listStack.length - 1 > lvl) listStack.pop();
        while (listStack.length - 1 < lvl) {
          const parent = listStack[listStack.length - 1];
          let last = parent.items[parent.items.length - 1];
          if (!last) { last = { runs: [], checked: null, children: [] }; parent.items.push(last); }
          const l = { type: 'list', ordered: info.list.ordered, start: 1, task: false, items: [] };
          last.children.push(l);
          listStack.push(l);
        }
        const target = listStack[listStack.length - 1];
        target.items.push(item);
        if (item.checked !== null) target.task = true;
        continue;
      }
      listStack = null;
      if (!text.trim() && !info.runs.some((x) => x.mdImg)) {
        if (info.pageBreak) pendingBreak = true;
        if (info.rule) push({ type: 'hr' });
        continue;
      }
      // a Caption paragraph right under a picture belongs to it
      const prev = out[out.length - 1];
      if (info.caption && prev && prev.type === 'image' && !prev.caption) {
        prev.caption = text.trim();
        continue;
      }
      if (info.code) {
        const last = out[out.length - 1];
        const t = runsText(info.runs.filter((x) => !x.mdImg));
        if (last && last.type === 'code' && last._docx && !info.pageBreak) last.text += '\n' + t;
        else push({ type: 'code', lang: '', text: t, _docx: true, pageBreak: info.pageBreak || undefined });
        continue;
      }
      const blocks = splitMdImages(info.runs, info.align);
      blocks.forEach((b, k) => {
        if (k === 0 && info.pageBreak) b.pageBreak = true;
        if (b.type === 'p') {
          if (info.heading) { b.type = 'heading'; b.level = info.heading; if (info.title) b.title = true; }
          if (info.subtitle) b.subtitle = true;
        }
      });
      if (info.quote && blocks.length) {
        const last = out[out.length - 1];
        if (last && last.type === 'quote' && last._docx) last.blocks.push(...blocks);
        else push({ type: 'quote', blocks, _docx: true, pageBreak: blocks[0].pageBreak });
        continue;
      }
      for (const b of blocks) push(b);
    }
  };
  visit(body);
  for (const b of walkBlocks(out)) {
    delete b._docx;
    if (b.type === 'list') for (const it of b.items) if (b.task && it.checked === null) it.checked = false;
  }
  return out;
}

/* ---------- plain text ---------- */

function txtToBlocks(text) {
  return String(text || '').split(/\r?\n\s*\r?\n/)
    .map((b) => b.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((t) => ({ type: 'p', runs: [{ text: t }], align: '' }));
}

/* ---------- chapters, title page ---------- */

const SPELLED_NUM = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\.?$/i;
const isNumeralish = (t) => /^\d{1,3}\.?$/.test(t) || /^[IVXLC]{1,7}\.?$/.test(t) || SPELLED_NUM.test(t);

// "Chapter 3 — The Storm" → "The Storm"; "Prologue" stays itself
function chapterTitleOf(t) {
  if (/^(prologue|epilogue|part)\b/i.test(t)) return t.trim();
  const m = t.match(/^chapter\s+([\divxlc]+|[a-z]+(?:-[a-z]+)?)\b\s*[—–:.\-]*\s*(.*)$/i);
  return m ? m[2].trim() : '';
}

function chapterizeBlocks(blocks, name, meta = {}) {
  const plain = (b) => (b && (b.type === 'p' || b.type === 'heading') ? runsText(b.runs).trim() : '');
  // Bare numbers only count as chapter markers when there's a ladder of
  // them — a story that merely OPENS with "Seven." keeps its seven.
  const numeralMode = blocks.filter((b) => isNumeralish(plain(b))).length >= 2;
  const isHeading = (b) => {
    const t = plain(b);
    return !!t && (chapterHeads.has(b) || (/^(chapter|prologue|epilogue|part)\b/i.test(t) && t.length < 60) || (numeralMode && isNumeralish(t)));
  };
  const isBreak = (b) => b.type === 'break' || (b.type === 'p' && /^\s*([*#•~⁂—–-]\s*){1,7}$/.test(plain(b)));
  // Headings start chapters and title them (as in NEO 0.8.1) — the
  // document's top heading level, when it's used more than once. A lone
  // leading "# Title" is the book's title, and deeper headings stay put.
  const allHeads = blocks.filter((b) => b.type === 'heading' && !b.title);
  const lead = allHeads[0] && allHeads[0] === blocks[0] && allHeads.filter((h) => h.level === allHeads[0].level).length === 1 ? allHeads[0] : null;
  const rest = allHeads.filter((h) => h !== lead);
  const top = rest.length ? Math.min(...rest.map((h) => h.level)) : 0;
  const chapterHeads = new Set(rest.filter((h) => h.level === top).length >= 2 ? rest.filter((h) => h.level === top) : []);

  const chapterize = (usePageBreaks) => {
    const chapters = [];
    let cur = { title: '', blocks: [] };
    for (const b of blocks) {
      const brk = usePageBreaks && b.pageBreak;
      const head = isHeading(b);
      if ((brk || head) && cur.blocks.length) {
        chapters.push(cur);
        cur = { title: '', blocks: [] };
      }
      if (head) {
        // "Chapter 3 — The Storm" gives "The Storm"; any other heading is the title itself
        if (!cur.blocks.length) cur.title = /^(chapter|prologue|epilogue|part)\b/i.test(plain(b)) || isNumeralish(plain(b)) ? chapterTitleOf(plain(b)) : plain(b);
        continue;
      }
      if (isBreak(b)) { cur.blocks.push({ type: 'break' }); continue; }
      cur.blocks.push(b);
    }
    if (cur.blocks.length || cur.title) chapters.push(cur);
    return chapters;
  };
  const countAll = (chs) => chs.reduce((n, c) => n + blocksWordCount(c.blocks), 0);

  // First pass trusts page breaks. Some word processors sprinkle page-break
  // formatting on every paragraph — if the result is confetti (lots of tiny
  // "chapters"), re-run trusting headings only.
  let chapters = chapterize(true);
  if (chapters.length > 6 && countAll(chapters) / chapters.length < 250) chapters = chapterize(false);
  if (!chapters.length) chapters.push({ title: '', blocks: [] });

  // Front matter: a short title line, a subtitle, and a "by Author" line
  // belong on the title page, not in the body.
  let title = meta.title || null;
  let author = meta.author || null;
  let subtitle = meta.subtitle || null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const first = chapters[0];
  if (first.blocks.length && !title) {
    const b0 = first.blocks[0];
    const t0 = plain(b0);
    const t1 = plain(first.blocks[1]);
    const titleish = t0 && t0.length < 90 && !/[.!?]$/.test(t0) && (
      b0.title || (b0.type === 'heading' && b0.level === 1 && !first.blocks.slice(1).some((b) => b.type === 'heading' && b.level === 1)) ||
      (norm(t0).length > 3 && norm(name).includes(norm(t0))) ||
      /^by\s+\S/i.test(t1) ||
      (t0 === t0.toUpperCase() && /[A-Z].*[A-Z]/.test(t0) && t0.length < 60)
    );
    if (titleish) {
      title = t0;
      first.blocks.shift();
      // a subtitle: Word's Subtitle style, or an all-italic line right under
      // a markdown title (how NEO's own export writes one)
      const s = first.blocks[0];
      if (s && (s.subtitle || (b0.type === 'heading' && s.type === 'p' && s.runs.every((x) => x.i || !x.text.trim()))) && plain(s).length < 140) {
        subtitle = plain(s);
        first.blocks.shift();
      }
    }
  }
  const bl = first.blocks.length ? plain(first.blocks[0]).match(/^by\s+(.{2,60})$/i) : null;
  if (bl && !author) {
    author = bl[1].trim();
    first.blocks.shift();
  }
  // a title page of short centred lines (how NEO's own .docx is laid out):
  // the italic one is the subtitle, the other the author
  if (title && chapters.length > 1 && first.blocks.length && first.blocks.length <= 2 &&
      first.blocks.every((b) => b.type === 'p' && b.align === 'center' && plain(b).length < 80)) {
    for (const b of first.blocks) {
      if (b.runs.every((x) => x.i || !x.text.trim())) subtitle = subtitle || plain(b);
      else author = author || plain(b).replace(/^by\s+/i, '');
    }
    first.blocks = [];
  }
  if (!first.blocks.length && chapters.length > 1) chapters.shift();

  // headings left in the body: the shallowest becomes Heading 1
  const heads = [];
  for (const ch of chapters) for (const b of walkBlocks(ch.blocks)) if (b.type === 'heading') heads.push(b);
  const min = heads.length ? Math.min(...heads.map((h) => h.level)) : 1;
  for (const h of heads) { h.level = clampLevel(h.level - min + 1); delete h.title; delete h.subtitle; }
  for (const ch of chapters) for (const b of walkBlocks(ch.blocks)) { delete b.pageBreak; delete b.subtitle; }

  return { title, author, subtitle, chapters };
}

function parseImportedManuscript(r) {
  if (r.kind === 'docx') return chapterizeBlocks(docxToBlocks(r), r.name);
  if (r.kind === 'md') {
    const { blocks, meta } = mdDocument(r.text, { base: r.dir, copyLocal: true, indentedCode: true });
    return chapterizeBlocks(blocks, r.name, meta);
  }
  return chapterizeBlocks(txtToBlocks(r.text), r.name);
}

// pictures found while importing are copied into the new book's folder
async function materializeImages(blocks, bookId) {
  for (const b of walkBlocks(blocks)) {
    if (b.type !== 'image') continue;
    b.bookId = bookId;
    const p = b.pending;
    delete b.pending;
    if (!p) continue;
    const rel = p.kind === 'path'
      ? await window.neo.importImage(bookId, p.path)
      : await window.neo.saveImageData(bookId, p.base64, p.ext, p.name || undefined);
    if (rel) b.src = rel;
  }
  return blocks.filter((b) => b.type !== 'image' || b.src);
}
