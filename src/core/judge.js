'use strict';
// Decision engine ("judge"): a System One model answers small typed questions — yes/no probabilities,
// choices with a distribution, scores — in ~150 ms. ORCA asks it for judgments plain code makes badly:
// what kind of request this is, whether a shell command is dangerous, whether an answer is broken or
// only a promise, which search results matter, which file a cut-off write was meant for.
// It never generates text. It is optional: without a key every caller falls back to the built-in
// heuristics, and every call fails open (null) on error or timeout so a chat is never blocked by it.
const config = require('./config');

const DEFAULT_URL = 'https://api.typesafe.ai/v1';
const DEFAULT_MODEL = 'jev-latest';
const stats = { calls: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, ms: 0, lastError: '' };
let cooldownUntil = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function settings() {
  const j = config.load().judge || {};
  const apiKey = j.apiKey || process.env.ORCA_JUDGE_KEY || process.env.TYPESAFE_API_KEY || '';
  return { enabled: j.enabled !== false && !!apiKey, apiKey, baseUrl: (j.baseUrl || DEFAULT_URL).replace(/\/+$/, ''), model: j.model || DEFAULT_MODEL };
}
function enabled() { return settings().enabled && Date.now() >= cooldownUntil; }
function status() { const s = settings(); return { configured: !!s.apiKey, enabled: s.enabled, model: s.model, cooling: Date.now() < cooldownUntil, stats: { ...stats, avgMs: stats.ok ? Math.round(stats.ms / stats.ok) : 0 } }; }

// One evaluation: `state` (string | object | array) against a map of typed questions.
// Returns the `answers` map or null (disabled, error, timeout). Retries once on 429/529/5xx.
async function ask(state, questions, { timeoutMs = 4000, retries = 1, force = false } = {}) {
  const s = settings();
  if (!s.apiKey || (!force && (!s.enabled || Date.now() < cooldownUntil))) return null;
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now(); stats.calls++;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(s.baseUrl + '/systemone', { method: 'POST', headers: { authorization: 'Bearer ' + s.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ state, model: s.model, questions }), signal: ctl.signal });
      const txt = await r.text();
      if (r.status === 429 || r.status === 529 || r.status >= 500) {
        if (attempt < retries) { clearTimeout(timer); await sleep(300 * (attempt + 1)); continue; }
        throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
      }
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status + ': ' + txt.slice(0, 160)), { status: r.status });
      const j = JSON.parse(txt);
      stats.ok++; stats.ms += Date.now() - t0; stats.inputTokens += j.usage?.input_tokens || 0; stats.outputTokens += j.usage?.output_tokens || 0;
      return j.answers || null;
    } catch (e) {
      stats.failed++; stats.lastError = String(e.message || e).slice(0, 200);
      if (e.status === 401 || e.status === 403) cooldownUntil = Date.now() + 10 * 60 * 1000; // rejected key: stop asking for a while
      else if (e.status === 429 || e.status === 529) cooldownUntil = Date.now() + 5000;
      else if (e.name === 'AbortError') cooldownUntil = Date.now() + 2000;
      if (e.status === 401 || e.status === 403 || e.status === 400 || e.status === 422 || force) { const err = new Error(stats.lastError); err.status = e.status; if (force) throw err; }
      return null;
    } finally { clearTimeout(timer); }
  }
}

const noul = (a, k) => (a && a[k] && typeof a[k].noul === 'number' ? a[k].noul : null);
const clip = (t, n) => { const s = String(t == null ? '' : t); return s.length > n ? s.slice(0, n) + '…' : s; };

// ---- what kind of request is this? → { kind: light|build|research|long_text, confidence } ----
const INTENT_Q = {
  kind: { type: 'choice', instructions: 'What kind of work does the latest user `message` require from a coding agent that has tools (shell, files, web search)? `recent` holds the previous exchange for context.', criteria: {
    light: 'A greeting, small talk, a short factual or explanatory question, a translation, a question about the agent itself, or any quick reply that needs no tools and no long output',
    build: 'Writing or changing code, files, projects, websites, apps, games, scripts or documents, running or fixing things, or anything that needs tools to create or modify something on the computer — including a short confirmation ("yes", "do it", "continue") that approves such work',
    research: 'Looking up current information on the web: news, prices, releases, comparisons, "latest", or any fact that needs a live search',
    long_text: 'Writing a long text in the chat itself — essay, article, story, tutorial, report — with no tools needed',
  } },
};
async function intent(message, recent = []) {
  const a = await ask({ message: clip(message, 2000), recent: recent.map((m) => clip(m, 300)) }, INTENT_Q, { timeoutMs: 2500 });
  const k = a && a.kind; if (!k || !k.choice) return null;
  return { kind: k.choice, confidence: +k.confidence || 0, probabilities: k.probabilities || {} };
}

// ---- is this shell command destructive? → probability 0..1 ----
const RISK_Q = { destructive: { type: 'noul', instructions: 'Could running `command` on the developer\'s machine destroy data, delete or overwrite files outside the project folder `cwd`, harm the operating system, exfiltrate secrets or credentials, or perform an irreversible remote action (force push, deleting branches, dropping databases, sending money)?', criteria: { true: 'Irreversible or damaging outside the project workspace, destructive to shared/remote state, or leaking private data', false: 'Read-only, or ordinary local project work such as installing dependencies, running tests, building, creating or editing files inside the project' } } };
async function commandRisk(command, cwd = '') {
  const a = await ask({ command: clip(command, 3000), cwd }, RISK_Q, { timeoutMs: 2500 });
  return noul(a, 'destructive');
}

// ---- final-answer check → { garbage, promise, asksUser, done, langMismatch } (each 0..1 or null) ----
const ANSWER_Q = {
  garbage: { type: 'noul', instructions: 'Is `final_answer` broken output rather than a real reply to `request`: repeated fragments, random digits or tokens, leaked markup tags, an answer duplicated and glued to itself, or text unrelated to the request?', criteria: { true: 'Broken, repetitive, or unrelated output', false: 'A coherent answer, even if short, imperfect, or in another language' } },
  promise: { type: 'noul', instructions: 'Does `final_answer` announce or promise work that is still to be done — phrases like "I will now create…", "Next I\'ll…", "Let me build…", "I\'m going to fix…" — instead of reporting work that is finished or answering the question? A completed report, an explanation, a direct answer, or a genuine question to the user is NOT a promise.', criteria: { true: 'Ends with unfinished intentions; the promised work has not happened yet', false: 'Reports finished work, answers directly, or asks the user a real question' } },
  asks_user: { type: 'noul', instructions: 'Does `final_answer` ask the user a question or offer choices that need the user\'s reply before work can continue?' },
  done: { type: 'noul', instructions: 'Considering `request`, `final_answer` and `actions_taken` (the tools the agent ran), has the agent delivered what the user asked for in this turn — the artifact exists or the question is answered — rather than a plan, partial work, or a question back?', criteria: { true: 'Delivered and consistent with the actions taken', false: 'Only a plan, partial work, a question back to the user, or a promise' } },
  lang_mismatch: { type: 'noul', instructions: 'Is the prose of `final_answer` written in a different language than the prose of `request`, when `request` does not explicitly ask for a particular language? Ignore code, file paths, commands, product names and quoted error messages.', criteria: { true: 'The user wrote in one language and the answer\'s prose is in another, without being asked to', false: 'Same language, or the user asked for that language, or the answer is only code/paths' } },
};
async function answerCheck({ request, answer, actions = [] }) {
  const a = await ask({ request: clip(request, 1500), final_answer: clip(answer, 6000), actions_taken: actions.slice(-25).map((x) => clip(x, 160)) }, ANSWER_Q, { timeoutMs: 3500 });
  if (!a) return null;
  return { garbage: noul(a, 'garbage'), promise: noul(a, 'promise'), asksUser: noul(a, 'asks_user'), done: noul(a, 'done'), langMismatch: noul(a, 'lang_mismatch') };
}

// ---- rerank search results by relevance to the query; drops clear misses when enough remain ----
async function rerank(query, results, { keepMin = 3, drop = 0.5 } = {}) {
  if (!Array.isArray(results) || results.length < 2) return results;
  const rows = results.slice(0, 10).map((r) => clip(`${r.title || ''} — ${r.snippet || ''} (${r.url || ''})`, 400));
  const qs = {}; rows.forEach((_, i) => { qs['r' + i] = { type: 'score', instructions: `How relevant is \`results[${i}]\` to \`query\`?`, criteria: ['Unrelated or spam', 'Loosely related topic', 'Directly about the query'] }; });
  const a = await ask({ query: clip(query, 500), results: rows }, qs, { timeoutMs: 2500 });
  if (!a) return results;
  const scored = results.slice(0, 10).map((r, i) => ({ ...r, relevance: a['r' + i] && typeof a['r' + i].score === 'number' ? Math.round(a['r' + i].score * 50) / 100 : null }));
  const sorted = [...scored].sort((x, y) => (y.relevance ?? 0.5) - (x.relevance ?? 0.5));
  const kept = sorted.filter((r) => r.relevance == null || r.relevance >= drop);
  return (kept.length >= keepMin ? kept : sorted.slice(0, Math.max(keepMin, kept.length))).concat(results.slice(10));
}

// ---- which file was a cut-off write meant for? → path or null ----
async function pickPath({ conversation = [], contentHead = '', candidates = [] }) {
  const cands = candidates.filter(Boolean).slice(0, 8); if (cands.length < 2) return null;
  const criteria = Object.fromEntries(cands.map((c) => [c, null])); criteria.none = 'None of the candidates fits this content';
  const a = await ask({ conversation: conversation.slice(-6).map((m) => clip(m, 400)), content_head: clip(contentHead, 600), candidates: cands }, { path: { type: 'choice', instructions: 'The agent produced file content but its `path` argument was lost. Given `conversation` and the beginning of the content, which of the `candidates` is the intended target path?', criteria } }, { timeoutMs: 2500 });
  const p = a && a.path; if (!p || !p.choice || p.choice === 'none' || (p.confidence || 0) < 0.6) return null;
  return p.choice;
}

// Settings → "Test": one real call with the given credentials (bypasses enabled/cooldown), returns latency + a sample verdict.
async function test({ apiKey, baseUrl, model } = {}) {
  const prev = config.load().judge || {};
  const s = { apiKey: apiKey || prev.apiKey || '', baseUrl: (baseUrl || prev.baseUrl || DEFAULT_URL).replace(/\/+$/, ''), model: model || prev.model || DEFAULT_MODEL };
  if (!s.apiKey) throw new Error('API key required');
  const t0 = Date.now();
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(s.baseUrl + '/systemone', { method: 'POST', headers: { authorization: 'Bearer ' + s.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ state: { command: 'rm -rf /' }, model: s.model, questions: { destructive: RISK_Q.destructive } }), signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status + ': ' + txt.slice(0, 160)), { status: r.status });
    const j = JSON.parse(txt);
    cooldownUntil = 0;
    return { ok: true, ms: Date.now() - t0, model: j.model, sample: `rm -rf / → destructive ${Math.round((noul(j.answers, 'destructive') || 0) * 100)}%` };
  } finally { clearTimeout(timer); }
}

module.exports = { enabled, status, ask, intent, commandRisk, answerCheck, rerank, pickPath, test, DEFAULT_URL, DEFAULT_MODEL };
