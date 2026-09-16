'use strict';
// Provider catalog for "bring your own key": a cached mirror of the open models.dev database
// (217 providers, thousands of models with context/output limits, tool-calling + reasoning flags, prices),
// plus live discovery (GET /models on the provider) and a one-shot probe used by the Settings "Test" button.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SRC = 'https://models.dev/api.json';
const TTL = 24 * 3600e3;
let mem = null, memAt = 0;
function cacheFile() { return path.join(config.getDataDir(), 'models-dev.json'); }

// Curated order + hints so the picker feels like a product, not a dump. Everything else follows alphabetically.
const FEATURED = ['openai', 'anthropic', 'google', 'openrouter', 'deepseek', 'xai', 'groq', 'mistral', 'togetherai', 'fireworks-ai', 'cerebras', 'zhipuai', 'moonshotai', 'minimax', 'nvidia', 'huggingface', 'github-copilot', 'lmstudio', 'ollama', 'requesty', 'chutes', 'nebius', 'deepinfra', 'perplexity', 'cohere', 'llama', 'tokenrouter', 'dahl'];
// Providers models.dev does not list (or lists with a non-OpenAI api) but people use daily.
const EXTRA = {
  ollama:  { id: 'ollama', name: 'Ollama (local)', api: 'http://127.0.0.1:11434/v1', env: [], local: true, models: {} },
  dahl:    { id: 'dahl', name: 'Dahl', api: 'https://inference.dahl.global/v1', env: ['DAHL_API_KEY'], models: {} },
  custom:  { id: 'custom', name: 'Custom OpenAI-compatible', api: '', env: [], models: {} },
};
// Native-API base URLs for providers whose models.dev entry has api=null (they publish a first-party SDK only).
const BASES = {
  openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1', xai: 'https://api.x.ai/v1', mistral: 'https://api.mistral.ai/v1', togetherai: 'https://api.together.xyz/v1',
  cerebras: 'https://api.cerebras.ai/v1', perplexity: 'https://api.perplexity.ai', cohere: 'https://api.cohere.ai/compatibility/v1', deepinfra: 'https://api.deepinfra.com/v1/openai',
  vercel: 'https://ai-gateway.vercel.sh/v1', sambanova: 'https://api.sambanova.ai/v1',
};

async function fetchDb(force) {
  const now = Date.now();
  if (!force && mem && now - memAt < TTL) return mem;
  if (!force) { try { const st = fs.statSync(cacheFile()); if (now - st.mtimeMs < TTL) { mem = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); memAt = now; return mem; } } catch (_) {} }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(SRC, { signal: ctl.signal, headers: { 'User-Agent': 'ORCA' } }); clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    // keep only what the UI needs (the full file is 4.6 MB)
    const slim = {};
    for (const [id, p] of Object.entries(j)) {
      slim[id] = { id, name: p.name || id, api: p.api || BASES[id] || '', env: p.env || [], doc: p.doc || '', models: Object.fromEntries(Object.entries(p.models || {}).map(([mid, m]) => [mid, { id: mid, name: m.name || mid, reasoning: !!m.reasoning, toolCall: !!m.tool_call, attachment: !!m.attachment, context: m.limit?.context || 0, output: m.limit?.output || 0, input: m.cost?.input ?? null, outputCost: m.cost?.output ?? null, free: (m.cost?.input === 0 && m.cost?.output === 0) || /:free$/.test(mid), date: m.release_date || '' }])) };
    }
    mem = slim; memAt = now;
    try { fs.writeFileSync(cacheFile(), JSON.stringify(slim)); } catch (_) {}
    return mem;
  } catch (e) {
    try { mem = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); memAt = now; return mem; } catch (_) {}
    mem = {}; memAt = now; return mem;
  }
}
async function db(force) { const d = await fetchDb(force); return { ...EXTRA, ...d, ...Object.fromEntries(Object.entries(EXTRA).filter(([k]) => !d[k]).map(([k, v]) => [k, v])) }; }

async function list(force) {
  const d = await db(force);
  const rows = Object.entries(d).map(([id, p]) => ({ id, name: p.name || id, api: p.api || BASES[id] || '', env: p.env || [], count: Object.keys(p.models || {}).length, local: !!p.local, anthropic: /anthropic\.com/.test(p.api || BASES[id] || '') }));
  const rank = (id) => { const i = FEATURED.indexOf(id); return i === -1 ? 999 : i; };
  rows.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  return { providers: rows, featured: FEATURED, fetchedAt: memAt };
}
async function models(id) {
  const d = await db(false); const p = d[id]; if (!p) return { models: [] };
  const ms = Object.values(p.models || {});
  ms.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
  return { id, name: p.name, api: p.api || BASES[id] || '', env: p.env || [], models: ms };
}
// Live discovery: GET {baseUrl}/models (works for OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM, …; Anthropic too).
async function discover({ baseUrl, apiKey, api }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('baseUrl required');
  const anth = api === 'anthropic' || /anthropic\.com/.test(base);
  const headers = anth ? { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' } : { authorization: 'Bearer ' + (apiKey || '') };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(base + '/models', { headers, signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`), { status: r.status });
    const j = JSON.parse(txt);
    const arr = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : Array.isArray(j) ? j : [];
    return arr.map((m) => ({ id: m.id || m.name || m.model, name: m.display_name || m.name || m.id, context: m.context_length || m.context_window || 0, owned: m.owned_by || '' })).filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2000);
  } finally { clearTimeout(t); }
}
async function probe({ baseUrl, apiKey, model, api }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base || !model) throw new Error('baseUrl and model required');
  const anth = api === 'anthropic' || /anthropic\.com/.test(base);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 40000);
  try {
    if (anth) {
      const r = await fetch(base + '/messages', { method: 'POST', signal: ctl.signal, headers: { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with the single word: OK' }] }) });
      const txt = await r.text(); if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`), { status: r.status });
      const j = JSON.parse(txt); return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
    const r = await fetch(base + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { authorization: 'Bearer ' + (apiKey || ''), 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: OK' }], max_tokens: 200 }) });
    const txt = await r.text(); if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`), { status: r.status });
    const j = JSON.parse(txt); const m = j.choices?.[0]?.message || {}; return (m.content || m.reasoning_content || m.reasoning || '').toString();
  } finally { clearTimeout(t); }
}
module.exports = { list, models, discover, probe, BASES };
