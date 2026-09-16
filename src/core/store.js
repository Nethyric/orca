'use strict';
// Persistent storage: every conversation, message, event and checkpoint is saved to disk
// immediately (JSON files in <dataDir>/chats). Full-text search across all chats.
const fs = require('fs');
const path = require('path');
const config = require('./config');

function chatsDir() { const d = path.join(config.getDataDir(), 'chats'); fs.mkdirSync(d, { recursive: true }); return d; }
function ckDir() { const d = path.join(config.getDataDir(), 'checkpoints'); fs.mkdirSync(d, { recursive: true }); return d; }
function file(id) { if (!/^[\w-]+$/.test(id)) throw new Error('bad id'); return path.join(chatsDir(), id + '.json'); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const cache = new Map();
let indexCache = null;

function readChat(id) {
  if (cache.has(id)) return cache.get(id);
  try { const c = JSON.parse(fs.readFileSync(file(id), 'utf8')); cache.set(id, c); return c; } catch (_) { return null; }
}
function writeChat(c) {
  c.updatedAt = Date.now();
  cache.set(c.id, c);
  const tmp = file(c.id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c));
  fs.renameSync(tmp, file(c.id));
  indexCache = null;
  return c;
}

function createChat({ title = '', mode = 'direct', model = '', models = [] } = {}) {
  const c = { id: uid(), title, mode, model, models, createdAt: Date.now(), updatedAt: Date.now(), pinned: false, messages: [], votes: [] };
  return writeChat(c);
}

function sweepRunning() {
  // called at server start: any message left in 'running' from a previous process is dead
  let n = 0;
  for (const f of fs.readdirSync(chatsDir())) {
    if (!f.endsWith('.json')) continue;
    let c; try { c = JSON.parse(fs.readFileSync(path.join(chatsDir(), f), 'utf8')); } catch (_) { continue; }
    let dirty = false;
    for (const m of c.messages || []) if (m.role === 'assistant' && m.status === 'running') { m.status = 'stopped'; if (!m.content) m.content = '(interrupted)'; dirty = true; n++; }
    if (dirty) { cache.delete(c.id); fs.writeFileSync(path.join(chatsDir(), f), JSON.stringify(c)); }
  }
  return n;
}
function importChat(c) {
  if (!/^[\w-]+$/.test(String(c.id))) c.id = uid();
  const clean = { id: c.id, title: String(c.title || '').slice(0, 200), mode: c.mode || 'direct', models: c.models || [], messages: c.messages || [], votes: c.votes || [], pinned: !!c.pinned, createdAt: c.createdAt || Date.now(), updatedAt: c.updatedAt || Date.now() };
  return writeChat(clean);
}
function listChats() {
  if (indexCache) return indexCache;
  const out = [];
  for (const f of fs.readdirSync(chatsDir())) {
    if (!f.endsWith('.json')) continue;
    const c = readChat(f.slice(0, -5));
    if (!c) continue;
    const last = [...c.messages].reverse().find((m) => m.role === 'assistant' || m.role === 'user');
    out.push({ id: c.id, title: c.title || '(بدون عنوان)', mode: c.mode, model: c.model, models: c.models, pinned: !!c.pinned, createdAt: c.createdAt, updatedAt: c.updatedAt, count: c.messages.length, preview: last ? String(last.content || '').replace(/<attached_(file|image)[\s\S]*?<\/attached_\1>/g, '').replace(/\n\n<attached_(file|image)[\s\S]*$/, '').slice(0, 120) : '' });
  }
  out.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  indexCache = out;
  return out;
}

function getChat(id) { return readChat(id); }
function updateChat(id, patch) { const c = readChat(id); if (!c) return null; Object.assign(c, patch); return writeChat(c); }
function deleteChat(id) { cache.delete(id); try { fs.unlinkSync(file(id)); } catch (_) {} indexCache = null; return true; }

// message = { id, role: 'user'|'assistant', content, model?, lane?, events?: [...], ts, meta? }
function addMessage(chatId, msg) {
  const c = readChat(chatId); if (!c) return null;
  msg.id = msg.id || uid(); msg.ts = msg.ts || Date.now();
  c.messages.push(msg);
  if (!c.title && msg.role === 'user') c.title = String(msg.content || '').replace(/\s+/g, ' ').slice(0, 60);
  writeChat(c);
  return msg;
}
function updateMessage(chatId, msgId, patch) {
  const c = readChat(chatId); if (!c) return null;
  const m = c.messages.find((x) => x.id === msgId); if (!m) return null;
  Object.assign(m, patch); writeChat(c); return m;
}
function truncateAfter(chatId, msgId) {
  const c = readChat(chatId); if (!c) return null;
  const i = c.messages.findIndex((x) => x.id === msgId);
  if (i >= 0) { c.messages = c.messages.slice(0, i); writeChat(c); }
  return c;
}
function addVote(chatId, vote) { const c = readChat(chatId); if (!c) return null; c.votes.push({ ...vote, ts: Date.now() }); writeChat(c); return c; }

// ---- votes / local leaderboard (Arena-style) ----
function leaderboard() {
  const stats = {};
  const bump = (k) => (stats[k] = stats[k] || { wins: 0, losses: 0, ties: 0, elo: 1000 });
  const all = [];
  for (const s of listChats()) { const c = readChat(s.id); if (c && c.votes.length) all.push(...c.votes.map((v) => ({ ...v, chat: c.id }))); }
  all.sort((a, b) => a.ts - b.ts);
  for (const v of all) {
    if (!v.a || !v.b) continue;
    const A = bump(v.a), B = bump(v.b);
    const ea = 1 / (1 + Math.pow(10, (B.elo - A.elo) / 400));
    let sa;
    if (v.winner === 'a') { sa = 1; A.wins++; B.losses++; }
    else if (v.winner === 'b') { sa = 0; B.wins++; A.losses++; }
    else { sa = 0.5; A.ties++; B.ties++; }
    A.elo += 32 * (sa - ea); B.elo += 32 * ((1 - sa) - (1 - ea));
  }
  return Object.entries(stats).map(([model, s]) => ({ model, ...s, elo: Math.round(s.elo), games: s.wins + s.losses + s.ties })).sort((a, b) => b.elo - a.elo);
}

// ---- full-text search ----
function search(q, limit = 40) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const s of listChats()) {
    const c = readChat(s.id); if (!c) continue;
    for (const m of c.messages) {
      const txt = String(m.content || '').toLowerCase();
      if (terms.every((t) => txt.includes(t))) {
        const i = txt.indexOf(terms[0]);
        hits.push({ chatId: c.id, title: c.title, msgId: m.id, role: m.role, ts: m.ts, snippet: String(m.content).slice(Math.max(0, i - 60), i + 120) });
        if (hits.length >= limit) return hits;
      }
    }
    if (c.title && terms.every((t) => c.title.toLowerCase().includes(t))) hits.push({ chatId: c.id, title: c.title, role: 'title', ts: c.updatedAt, snippet: c.title });
  }
  return hits;
}

// ---- checkpoints (Cursor-style): snapshot file before every mutation, restore later ----
function saveCheckpoint(chatId, runId, diff) {
  if (!diff) return null;
  const id = uid();
  const rec = { id, chatId, runId, path: diff.path, before: diff.before, after: diff.after, ts: Date.now() };
  fs.writeFileSync(path.join(ckDir(), id + '.json'), JSON.stringify(rec));
  return { id, path: diff.path, ts: rec.ts, created: diff.before === null, deleted: diff.after === null };
}
function getCheckpoint(id) { try { return JSON.parse(fs.readFileSync(path.join(ckDir(), id.replace(/[^\w-]/g, '') + '.json'), 'utf8')); } catch (_) { return null; } }
function listCheckpoints(chatId) {
  const out = [];
  for (const f of fs.readdirSync(ckDir())) { const r = getCheckpoint(f.slice(0, -5)); if (r && r.chatId === chatId) out.push({ id: r.id, path: r.path, ts: r.ts, runId: r.runId, created: r.before === null, deleted: r.after === null }); }
  return out.sort((a, b) => a.ts - b.ts);
}
function restoreCheckpoint(id, direction = 'before') {
  const r = getCheckpoint(id); if (!r) return { error: 'not found' };
  const ws = config.workspaceDir();
  const full = path.resolve(ws, r.path);
  if (!full.startsWith(path.resolve(ws))) return { error: 'bad path' };
  const content = direction === 'before' ? r.before : r.after;
  if (content === null) { try { fs.unlinkSync(full); } catch (_) {} return { ok: true, path: r.path, action: 'deleted' }; }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return { ok: true, path: r.path, action: 'restored' };
}

function exportChat(id) {
  const c = readChat(id); if (!c) return '';
  const lines = [`# ${c.title || 'ORCA chat'}`, '', `_${new Date(c.createdAt).toLocaleString()} · mode: ${c.mode}_`, ''];
  for (const m of c.messages) {
    const who = m.role === 'user' ? '👤 User' : `🐋 ORCA${m.model ? ' (' + m.model + ')' : ''}`;
    lines.push(`## ${who}`, '', String(m.content || ''), '');
    for (const e of m.events || []) if (e.event === 'tool_call') lines.push(`> 🔧 \`${e.data.name}\` ${JSON.stringify(e.data.args).slice(0, 200)}`);
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { importChat, sweepRunning, createChat, listChats, getChat, updateChat, deleteChat, addMessage, updateMessage, truncateAfter, addVote, leaderboard, search, saveCheckpoint, listCheckpoints, restoreCheckpoint, exportChat, uid };
