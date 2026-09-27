#!/usr/bin/env node
// My Notes MCP server — lets AI agents (Codex, Hermes, Claude…) read and
// write your notes through the running app.
//
// Speaks MCP over stdio and relays each tool call to My Notes over a local
// socket. My Notes must be open with File → "Allow AI Agents to Read & Write
// Notes" ticked; nothing here touches your files directly.
//
// Run with any Node 18+:   node /path/to/neo-mcp.mjs
// or with the app itself:  ELECTRON_RUN_AS_NODE=1 "/Applications/My Notes.app/Contents/MacOS/My Notes" /path/to/neo-mcp.mjs

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const VERSION = '1.0.0';

function socketPath() {
  if (process.env.NEO_AGENT_SOCKET) return process.env.NEO_AGENT_SOCKET;
  const p = path.join(os.homedir(), 'Library', 'Application Support', 'My Notes', 'agent.sock');
  return p.length < 100 ? p : path.join(os.tmpdir(), 'my-notes-agent.sock');
}

const NOTEBOOK = { type: 'string', description: 'The notebook: its id, or its title (or a unique part of it)' };
const CHAPTER = { type: ['string', 'integer'], description: 'Chapter number (from 1), chapter id, or chapter title' };

const TOOLS = [
  {
    name: 'list_notebooks',
    description: 'List every notebook (book) in My Notes with its id, title, shelf, chapters and word count.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'read_note',
    description: 'Read a notebook as Markdown — one chapter, or the whole notebook when no chapter is given. Headings, lists, checklists, tables, quotes, code, links and pictures come through as Markdown.',
    inputSchema: { type: 'object', properties: { notebook: NOTEBOOK, chapter: CHAPTER }, required: ['notebook'] }
  },
  {
    name: 'write_note',
    description: 'Write Markdown into a notebook chapter. mode "append" (default) adds to the end, "prepend" to the start, "replace" rewrites the chapter. Without a chapter, append/prepend use the last/first chapter. Pictures given as local paths are copied into the notebook; web pictures stay linked. The writer can undo it in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook: NOTEBOOK,
        chapter: CHAPTER,
        markdown: { type: 'string', description: 'The text to write, in Markdown' },
        mode: { type: 'string', enum: ['append', 'prepend', 'replace'], default: 'append' }
      },
      required: ['notebook', 'markdown']
    }
  },
  {
    name: 'add_chapter',
    description: 'Add a new chapter at the end of a notebook, with optional title and Markdown content.',
    inputSchema: {
      type: 'object',
      properties: { notebook: NOTEBOOK, title: { type: 'string' }, markdown: { type: 'string' } },
      required: ['notebook']
    }
  },
  {
    name: 'create_notebook',
    description: 'Start a new notebook on the first shelf, optionally with Markdown content.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, markdown: { type: 'string' }, author: { type: 'string' } },
      required: ['title']
    }
  },
  {
    name: 'search_notes',
    description: 'Search the text of every notebook (or just one) and return each match with a little context.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, notebook: NOTEBOOK }, required: ['query'] }
  },
  {
    name: 'read_notes_tab',
    description: "Read a notebook's Notes tab (the side notes kept beside the manuscript) as Markdown.",
    inputSchema: { type: 'object', properties: { notebook: NOTEBOOK }, required: ['notebook'] }
  },
  {
    name: 'write_notes_tab',
    description: "Write Markdown into a notebook's Notes tab. mode \"append\" (default) or \"replace\".",
    inputSchema: {
      type: 'object',
      properties: { notebook: NOTEBOOK, markdown: { type: 'string' }, mode: { type: 'string', enum: ['append', 'replace'], default: 'append' } },
      required: ['notebook', 'markdown']
    }
  }
];

// one request to the app, one answer
function callApp(tool, args) {
  return new Promise((resolve) => {
    const conn = net.createConnection(socketPath());
    let buf = '';
    const done = (v) => { resolve(v); conn.destroy(); };
    conn.setEncoding('utf8');
    conn.setTimeout(90000, () => done({ error: 'My Notes did not answer in time' }));
    conn.on('connect', () => conn.write(JSON.stringify({ id: 1, tool, args }) + '\n'));
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        try { done(JSON.parse(buf.slice(0, nl))); } catch { done({ error: 'My Notes sent something unreadable' }); }
      }
    });
    conn.on('error', (err) => done({
      error: err.code === 'ENOENT' || err.code === 'ECONNREFUSED'
        ? 'My Notes is not reachable. Open My Notes and tick File → "Allow AI Agents to Read & Write Notes".'
        : 'Could not reach My Notes: ' + err.message
    }));
  });
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notifications need no answer
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'my-notes', title: 'My Notes', version: VERSION },
        instructions: 'Read and write the writer\'s notebooks in My Notes. Content is Markdown. Use list_notebooks first to find notebook ids and chapter numbers; prefer append over replace unless asked to rewrite.'
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      if (!TOOLS.some((t) => t.name === name)) return fail(id, -32602, 'Unknown tool: ' + name);
      const res = await callApp(name, (params && params.arguments) || {});
      if (res.error) return reply(id, { content: [{ type: 'text', text: res.error }], isError: true });
      const r = res.result;
      const text = r && typeof r.markdown === 'string' && Object.keys(r).length <= 4
        ? `${r.notebook ? `# ${r.notebook}${r.chapter && r.chapter !== 'all' ? ' · ' + r.chapter : ''}\n\n` : ''}${r.markdown}`
        : JSON.stringify(r, null, 2);
      return reply(id, { content: [{ type: 'text', text }], structuredContent: r && typeof r === 'object' && !Array.isArray(r) ? r : { items: r } });
    }
    default:
      return fail(id, -32601, 'Method not found: ' + method);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  handle(msg).catch((err) => fail(msg.id ?? null, -32603, String(err && err.message || err)));
});
