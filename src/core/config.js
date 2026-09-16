'use strict';
// Central config: data directory, persisted settings, API keys, provider registry.
const fs = require('fs');
const path = require('path');
const os = require('os');

let DATA_DIR = path.join(os.homedir(), '.orca');

const APP = (() => { try { return require('../../orca.config.json'); } catch (_) { return {}; } })();
const GATEWAY = (process.env.ORCA_GATEWAY || APP.gateway || '').replace(/\/+$/, '');

// No provider keys ship with the app. Built-in models are served through the ORCA gateway
// (a tiny Cloudflare Worker that holds the real keys — see gateway/). Users may add their own
// keys/providers in Settings; those are stored only on their machine.
const DEFAULT_KEYS = { gateway: '', dahl: '', tokenrouter: '', openrouter: '' };

const PROVIDERS = {
  gateway:     { label: 'ORCA Cloud',  baseUrl: GATEWAY ? GATEWAY + '/v1' : '', keyName: 'gateway', builtin: true, hidden: true },
  openrouter:  { label: 'OpenRouter',  baseUrl: 'https://openrouter.ai/api/v1',     keyName: 'openrouter' },
  dahl:        { label: 'Dahl',        baseUrl: 'https://inference.dahl.global/v1', keyName: 'dahl' },
  tokenrouter: { label: 'TokenRouter', baseUrl: 'https://api.tokenrouter.com/v1',   keyName: 'tokenrouter' },
};

// Built-in models (served via the gateway; the gateway maps these ids to whatever upstream is live right now).
// Order = fallback priority. The remote config can override/extend this list without a new release.
const BUILTIN_MODELS = [
  { key: 'minimax',  label: 'MiniMax M2.7',      vendor: 'MiniMax',  provider: 'gateway', model: 'orca/minimax',  maxTokens: 16384, tier: 'strong', note: { fa: 'قوی‌ترین — استدلال عمیق', en: 'Strongest — deep reasoning', ru: 'Самая сильная — глубокие рассуждения', zh: '最强 — 深度推理' } },
  { key: 'deepseek', label: 'DeepSeek V4 Flash', vendor: 'DeepSeek', provider: 'gateway', model: 'orca/deepseek', maxTokens: 16384, tier: 'fast',   note: { fa: 'سریع‌ترین — پاسخ تمیز', en: 'Fastest — clean answers', ru: 'Самая быстрая — чистые ответы', zh: '最快 — 简洁回答' } },
  { key: 'glm',      label: 'GLM 5.3',           vendor: 'Zhipu',    provider: 'gateway', model: 'orca/glm',      maxTokens: 3000,  tier: 'backup', note: { fa: 'پشتیبان', en: 'Backup', ru: 'Резервная', zh: '备用' } },
];
let remoteModels = null; // set by remote.js when the gateway/remote config publishes a model list
function setRemoteModels(list) { remoteModels = Array.isArray(list) && list.length ? list.map((m) => ({ maxTokens: 8192, provider: 'gateway', tier: 'custom', ...m })) : null; _cfg = null; }
function builtinModels() { return remoteModels || BUILTIN_MODELS; }

const DEFAULT_CONFIG = {
  keys: { ...DEFAULT_KEYS },
  customModels: [],          // { key, label, provider:'openrouter'|'custom', baseUrl?, apiKey?, model, maxTokens }
  defaultModel: 'auto',
  compareModels: ['minimax', 'deepseek'],
  autonomy: 'auto',          // 'ask' | 'auto' | 'yolo'
  planMode: false,
  lang: APP.defaultLanguage || 'en',   // 'en' | 'fa' | 'ru' | 'zh' (default English; auto-detected from the OS on first run)
  workspace: '',             // '' => <DATA_DIR>/workspace
  maxSteps: 40,
  temperature: 0.5,
  // appearance & behaviour (all editable in Settings)
  theme: 'dark',             // 'dark' | 'light' | 'system'
  accent: 'indigo',          // 'indigo' | 'violet' | 'cyan' | 'emerald' | 'amber' | 'rose'
  fontSize: 14,              // base px
  density: 'comfortable',    // 'comfortable' | 'compact'
  codeTheme: 'auto',
  showReasoning: true,       // expand reasoning while streaming
  sendKey: 'enter',          // 'enter' | 'ctrlEnter'
  sound: false,
  notifications: true,
  rules: '',                 // custom instructions appended to the system prompt (like Cursor rules)
  persona: '',               // short profile of the user (name, role, preferences)
  reasoningEffort: 'medium', // hint to the model: 'low' | 'medium' | 'high'
  shellTimeout: 120,
  webSearchEngine: 'auto',
  // 1.4: vision / generation / social
  vision: { provider: 'openrouter', model: '', baseUrl: '', apiKey: '' },   // any OpenAI-compatible vision model; empty model + OpenRouter key → free default
  imageGen: { provider: '', baseUrl: '', apiKey: '', model: '' },           // '' = free built-in provider | 'openai' (/images/generations) | 'openrouter'
  videoGen: { provider: '', apiKey: '', model: '' },                       // '' = animated key-frames | 'replicate' | 'fal'
  cookiesFile: '',                                                          // cookies.txt for login-walled social content
  cookiesBrowser: '',                                                       // 'chrome' | 'firefox' | 'edge' … (yt-dlp --cookies-from-browser)
  // 1.5: updates
  autoUpdate: true,
  dismissedUpdate: '',
};

let _cfg = null;

function setDataDir(dir) {
  DATA_DIR = dir;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _cfg = null;
}
function getDataDir() { fs.mkdirSync(DATA_DIR, { recursive: true }); return DATA_DIR; }
function configPath() { return path.join(getDataDir(), 'config.json'); }

function load() {
  if (_cfg) return _cfg;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (_) {}
  _cfg = { ...DEFAULT_CONFIG, ...saved, keys: { ...DEFAULT_KEYS, ...(saved.keys || {}) } };
  for (const k of ['vision', 'imageGen', 'videoGen']) _cfg[k] = { ...DEFAULT_CONFIG[k], ...((saved[k] && typeof saved[k] === 'object') ? saved[k] : {}) };
  if (!Array.isArray(_cfg.customModels)) _cfg.customModels = [];
  return _cfg;
}
function save(patch) {
  const c = load();
  if (patch) {
    if (patch.keys) { c.keys = { ...c.keys, ...patch.keys }; delete patch.keys; }
    for (const k of ['vision', 'imageGen', 'videoGen']) if (patch[k] && typeof patch[k] === 'object') { const nx = { ...c[k] }; for (const [kk, vv] of Object.entries(patch[k])) { if (kk === 'apiKey' && (vv == null || String(vv).includes('…'))) continue; nx[kk] = vv; } c[k] = nx; delete patch[k]; }
    Object.assign(c, patch);
  }
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
  return c;
}

function workspaceDir() {
  const c = load();
  const w = c.workspace || path.join(getDataDir(), 'workspace');
  fs.mkdirSync(w, { recursive: true });
  return w;
}

// ---- model resolution ----
function allModels() {
  const c = load();
  const list = builtinModels().map((m) => ({ ...m, builtin: true }));
  for (const m of c.customModels) list.push({ ...m, builtin: false, tier: m.tier || 'custom' });
  return list;
}
function modelInfo(key) { return allModels().find((m) => m.key === key) || null; }
const AUTO = { key: 'auto', label: 'ORCA', vendor: 'ORCA', tier: 'auto', builtin: true, provider: 'router', note: { fa: 'همه‌کاره — خودش بهترین مدل را برای هر پیام انتخاب می‌کند', en: 'All-purpose — picks the best model for every message', ru: 'Универсальная — сама выбирает лучшую модель для каждого сообщения', zh: '全能 — 为每条消息自动选择最佳模型' } };

function resolve(key) {
  const c = load();
  const m = modelInfo(key);
  if (!m) return null;
  let baseUrl, apiKey;
  if (m.provider === 'custom') { baseUrl = m.baseUrl; apiKey = m.apiKey || ''; }
  else {
    const p = PROVIDERS[m.provider] || PROVIDERS.gateway;
    baseUrl = m.baseUrl || p.baseUrl;
    apiKey = m.apiKey || c.keys[p.keyName] || '';
    if (m.provider === 'gateway') apiKey = apiKey || (baseUrl ? 'gateway' : ''); // the gateway authenticates with signed headers, not a bearer key
  }
  if (!baseUrl) return null;
  return { key: m.key, label: m.label, vendor: m.vendor || '', baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model: m.model, maxTokens: m.maxTokens || 4096 };
}

function fallbackOrder(primary) {
  const keys = allModels().map((m) => m.key);
  const builtinOrder = builtinModels().map((m) => m.key);
  return [primary, ...builtinOrder.filter((k) => k !== primary), ...keys.filter((k) => k !== primary && !builtinOrder.includes(k))];
}

function publicView() {
  const c = load();
  const mask = (k) => (k ? k.slice(0, 6) + '…' + k.slice(-4) : '');
  return {
    ...c,
    keys: Object.fromEntries(Object.entries(c.keys).map(([k, v]) => [k, mask(v)])),
    keysSet: Object.fromEntries(Object.entries(c.keys).map(([k, v]) => [k, !!v])),
    customModels: c.customModels.map((m) => ({ ...m, apiKey: m.apiKey ? mask(m.apiKey) : '' })),
    vision: { ...c.vision, apiKey: mask(c.vision.apiKey), keySet: !!c.vision.apiKey },
    imageGen: { ...c.imageGen, apiKey: mask(c.imageGen.apiKey), keySet: !!c.imageGen.apiKey },
    videoGen: { ...c.videoGen, apiKey: mask(c.videoGen.apiKey), keySet: !!c.videoGen.apiKey },
    version: (() => { try { return require('../../package.json').version; } catch (_) { return ''; } })(),
    dataDir: getDataDir(),
    workspaceDir: workspaceDir(),
    models: [AUTO, ...allModels().map((m) => ({ key: m.key, label: m.label, vendor: m.vendor, tier: m.tier, note: m.note, builtin: m.builtin, provider: m.provider }))],
    providers: Object.fromEntries(Object.entries(PROVIDERS).filter(([, p]) => !p.hidden)),
    gateway: !!GATEWAY,
    app: { name: APP.name || 'ORCA Agent', company: APP.company || '', repo: APP.repo || '', homepage: APP.homepage || '' },
  };
}

module.exports = { AUTO, setDataDir, getDataDir, load, save, workspaceDir, allModels, modelInfo, resolve, fallbackOrder, publicView, PROVIDERS, BUILTIN_MODELS, builtinModels, setRemoteModels, GATEWAY, APP };
