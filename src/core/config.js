'use strict';
// Central config: data directory, persisted settings, API keys, provider registry.
const fs = require('fs');
const path = require('path');
const os = require('os');

let DATA_DIR = path.join(os.homedir(), '.orca');

const APP = (() => { try { return require('../../orca.config.json'); } catch (_) { return {}; } })();

// No provider keys ship with the app in plain text. Built-in models are served from the Sealed Vault
// (remote/vault.json in the GitHub repo — ciphertext that only the app can open, see vault.js). Users can
// add their own providers in Settings → Providers; those keys are stored only on their machine.
const PROVIDERS = {
  // brand-neutral built-in slot; the vault decides which upstream serves each alias right now
  vault: { label: 'Built-in', baseUrl: '', keyName: 'vault', builtin: true, hidden: true },
};

// Built-in models (served via the vault; alias → whatever upstream is live right now).
// Order = fallback priority. The vault can override/extend this list without a new release.
const BUILTIN_MODELS = [
  { key: 'minimax',  label: 'MiniMax M2.7',      vendor: 'MiniMax',  provider: 'vault', model: 'orca/minimax',  maxTokens: 4096, tier: 'strong', note: { fa: 'قوی‌ترین — استدلال عمیق و کارهای طولانی', en: 'Strongest — deep reasoning, long tasks', ru: 'Самая сильная — глубокие рассуждения, долгие задачи', zh: '最强 — 深度推理、长任务' } },
  { key: 'deepseek', label: 'DeepSeek V4 Flash', vendor: 'DeepSeek', provider: 'vault', model: 'orca/deepseek', maxTokens: 4096, tier: 'fast',   note: { fa: 'سریع‌ترین — پاسخ تمیز و کوتاه', en: 'Fastest — clean, concise answers', ru: 'Самая быстрая — чёткие короткие ответы', zh: '最快 — 简洁清晰的回答' } },
  { key: 'glm',      label: 'GLM 5.3 Flash',     vendor: 'Zhipu',    provider: 'vault', model: 'orca/glm',      maxTokens: 4096, tier: 'backup', note: { fa: 'پشتیبان', en: 'Backup', ru: 'Резерв', zh: '备用' } },
  { key: 'glimmer',  label: 'Glimmer 30B',       vendor: 'Meta',     provider: 'vault', model: 'orca/glimmer',  maxTokens: 4096, tier: 'vision', vision: true, note: { fa: 'تصویر می‌بیند — عکس، اسکرین‌شات، UI', en: 'Sees images — photos, screenshots, UI', ru: 'Видит изображения — фото, скриншоты, UI', zh: '能看图 — 照片、截图、界面' } },
];
let remoteModels = null; // set by vault.js when the vault publishes a model list
function setRemoteModels(list) { remoteModels = Array.isArray(list) && list.length ? list.map((m) => ({ maxTokens: 4096, provider: 'vault', tier: 'custom', ...m })) : null; _cfg = null; }
function builtinModels() { return remoteModels || BUILTIN_MODELS; }

// ---- user providers (bring your own key) ----
// cfg.providers = { [providerId]: { apiKey, baseUrl?, name?, models: [{ id, name?, maxTokens?, reasoning?, toolCall? }] } }
// providerId is a models.dev id ('openai', 'anthropic', 'openrouter', 'groq', …) or a user-defined id for any OpenAI-compatible endpoint.
const DEFAULT_CONFIG = {
  providers: {},             // bring-your-own-key providers (see above)
  customModels: [],          // legacy (< 0.0.1) custom models: { key, label, provider, baseUrl?, apiKey?, model, maxTokens }
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
  vision: { provider: '', model: '', baseUrl: '', apiKey: '' },   // '' = auto (any user provider with an image-capable model) | <providerId> | 'custom' (baseUrl + apiKey + model)
  imageGen: { provider: '', baseUrl: '', apiKey: '', model: '' },           // '' = free built-in provider | 'openai' (= any /images/generations API) | <providerId> (chat model with image output)
  videoGen: { provider: '', apiKey: '', model: '' },                       // '' = animated key-frames | 'replicate' | 'fal'
  // decision engine (System One judge — optional, bring your own key; see docs/decision-engine.md)
  judge: { enabled: true, apiKey: '', baseUrl: '', model: '' },
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
  _cfg = { ...DEFAULT_CONFIG, ...saved, providers: (saved.providers && typeof saved.providers === 'object') ? saved.providers : {} };
  delete _cfg.keys; // pre-0.0.1 layout
  for (const k of ['vision', 'imageGen', 'videoGen', 'judge']) _cfg[k] = { ...DEFAULT_CONFIG[k], ...((saved[k] && typeof saved[k] === 'object') ? saved[k] : {}) };
  if (!Array.isArray(_cfg.customModels)) _cfg.customModels = [];
  return _cfg;
}
function save(patch) {
  const c = load();
  if (patch) {
    delete patch.keys;
    if (patch.providers && typeof patch.providers === 'object') { // merge per provider; empty apiKey keeps the stored one, null removes the provider
      const nx = { ...c.providers };
      for (const [id, pv] of Object.entries(patch.providers)) { if (pv === null) { delete nx[id]; continue; } const cur = nx[id] || {}; const m = { ...cur, ...pv }; if (!pv.apiKey) m.apiKey = cur.apiKey || ''; nx[id] = m; }
      c.providers = nx; delete patch.providers;
    }
    for (const k of ['vision', 'imageGen', 'videoGen', 'judge']) if (patch[k] && typeof patch[k] === 'object') { const nx = { ...c[k] }; for (const [kk, vv] of Object.entries(patch[k])) { if (kk === 'apiKey' && (vv == null || String(vv).includes('…'))) continue; nx[kk] = vv; } c[k] = nx; delete patch[k]; }
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
  for (const [pid, pv] of Object.entries(c.providers || {})) {
    for (const m of (pv.models || [])) list.push({ key: `${pid}/${m.id}`, label: m.name || m.id, vendor: pv.name || pid, provider: pid, model: m.id, maxTokens: m.maxTokens || 8192, tier: m.tier || 'custom', builtin: false, reasoning: !!m.reasoning, toolCall: m.toolCall !== false });
  }
  for (const m of c.customModels) list.push({ ...m, builtin: false, tier: m.tier || 'custom' });
  return list;
}
function modelInfo(key) { return allModels().find((m) => m.key === key) || null; }
const AUTO = { key: 'auto', label: 'ORCA', vendor: 'ORCA', tier: 'auto', builtin: true, provider: 'router', note: { fa: 'همه‌کاره — خودش بهترین مدل را برای هر پیام انتخاب می‌کند', en: 'All-purpose — picks the best model for every message', ru: 'Универсальная — сама выбирает лучшую модель для каждого сообщения', zh: '全能 — 为每条消息自动选择最佳模型' } };

function resolve(key) {
  const c = load();
  const m = modelInfo(key);
  if (!m) return null;
  let baseUrl = '', apiKey = '';
  if (m.provider === 'vault') { baseUrl = 'vault'; apiKey = vaultEnabled() ? 'vault' : ''; } // expanded per request by vault.js
  else if (m.provider === 'custom') { baseUrl = m.baseUrl || ''; apiKey = m.apiKey || ''; }
  else {
    const pv = (c.providers || {})[m.provider];
    if (pv) { baseUrl = pv.baseUrl || m.baseUrl || ''; apiKey = pv.apiKey || ''; }
    else { baseUrl = m.baseUrl || ''; apiKey = m.apiKey || ''; } // legacy customModels rows
  }
  if (!baseUrl) return null;
  return { key: m.key, label: m.label, vendor: m.vendor || '', provider: m.provider, baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model: m.model, maxTokens: m.maxTokens || 4096, reasoning: m.reasoning, toolCall: m.toolCall };
}
let vaultEnabled = () => false; // injected by vault.js (avoids a require cycle)
function setVaultProbe(fn) { vaultEnabled = fn; }

function fallbackOrder(primary) {
  const keys = allModels().map((m) => m.key);
  const builtinOrder = builtinModels().map((m) => m.key);
  return [primary, ...builtinOrder.filter((k) => k !== primary), ...keys.filter((k) => k !== primary && !builtinOrder.includes(k))];
}

function publicView() {
  const c = load();
  const mask = (k) => (k ? k.slice(0, 4) + '…' + k.slice(-4) : '');
  const { providers: pvs, ...rest } = c;
  return {
    ...rest,
    providers: Object.fromEntries(Object.entries(pvs || {}).map(([id, p]) => [id, { ...p, apiKey: mask(p.apiKey), keySet: !!p.apiKey, models: p.models || [] }])),
    customModels: c.customModels.map((m) => ({ ...m, apiKey: m.apiKey ? mask(m.apiKey) : '' })),
    vision: { ...c.vision, apiKey: mask(c.vision.apiKey), keySet: !!c.vision.apiKey },
    imageGen: { ...c.imageGen, apiKey: mask(c.imageGen.apiKey), keySet: !!c.imageGen.apiKey },
    videoGen: { ...c.videoGen, apiKey: mask(c.videoGen.apiKey), keySet: !!c.videoGen.apiKey },
    judge: { ...c.judge, apiKey: mask(c.judge.apiKey), keySet: !!c.judge.apiKey },
    version: (() => { try { return require('../../package.json').version; } catch (_) { return ''; } })(),
    dataDir: getDataDir(),
    workspaceDir: workspaceDir(),
    models: [AUTO, ...allModels().map((m) => ({ key: m.key, label: m.label, vendor: m.vendor, tier: m.tier, note: m.note, builtin: m.builtin, provider: m.provider, ready: !!resolve(m.key)?.apiKey }))],
    builtin: vaultEnabled(),
    app: { name: APP.name || 'ORCA', company: APP.company || '', repo: APP.repo || '', homepage: APP.homepage || '' },
  };
}

module.exports = { AUTO, setDataDir, getDataDir, load, save, workspaceDir, allModels, modelInfo, resolve, fallbackOrder, publicView, PROVIDERS, BUILTIN_MODELS, builtinModels, setRemoteModels, setVaultProbe, APP };
