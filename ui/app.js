/* ORCA UI v3 */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (name, cls = '') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const TOK = (() => { const t0 = window.__ORCA_TOKEN__ || ''; if (t0 && t0 !== '__ORCA_TOKEN__') return t0; const q = new URLSearchParams(location.search).get('token'); if (q) { try { sessionStorage.setItem('orca.token', q); } catch (_) {} history.replaceState(null, '', location.pathname); return q; } try { return sessionStorage.getItem('orca.token') || ''; } catch (_) { return ''; } })();
// Isolated preview origin (separate port serving ONLY static workspace files, no API, no token).
// Previewed agent-generated HTML must never share the app's origin, or it could read the API token.
const PREV_PORT = parseInt(window.__ORCA_PREVIEW__, 10) || 0;
const PREV_BASE = PREV_PORT ? (location.protocol + '//' + location.hostname + ':' + PREV_PORT) : '';
const authHdr = () => (TOK ? { 'x-orca-token': TOK } : {});
const authQs = (p) => (TOK ? p + (p.includes('?') ? '&' : '?') + 'token=' + TOK : p);
const api = async (p, o = {}) => { const r = await fetch(p, { headers: { 'content-type': 'application/json', ...authHdr() }, ...o, body: o.body ? JSON.stringify(o.body) : undefined }); return r.json(); };
const desktop = window.orcaDesktop || null;
if (!desktop) document.body.classList.add('web');
const PLAN_RE = /اجرا\s*کنم\s*[؟?:]?\s*$|Shall I (execute|proceed)\??\s*$|Выполнить\??\s*$|要执行吗[？?]?\s*$/m;
const root = document.documentElement;

// ───────────────────────── i18n ─────────────────────────
const I18N = window.ORCA_I18N; // ui/i18n.js — en (default), fa, ru, zh
const LANGS = window.ORCA_LANGS; const RTL = window.ORCA_RTL;

const sysLang = () => { const n = (navigator.language || 'en').toLowerCase(); return n.startsWith('fa') ? 'fa' : n.startsWith('ru') ? 'ru' : n.startsWith('zh') ? 'zh' : 'en'; };
let lang = localStorage.getItem('orca.lang') || sysLang();
if (!I18N[lang]) lang = 'en';
const t = (k) => (I18N[lang][k] ?? I18N.en[k] ?? k);
const ts = (k) => (I18N[lang].st[k] ?? I18N.en.st[k] ?? k);
const tu = (k) => (I18N[lang].upd[k] ?? I18N.en.upd[k] ?? k);
const isFa = () => lang === 'fa';
function applyLang() {
  root.lang = lang === 'zh' ? 'zh-CN' : lang; root.dir = RTL[lang] ? 'rtl' : 'ltr'; root.dataset.lang = lang;
  $$('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n)));
  $$('[data-i18n-ph]').forEach((e) => (e.placeholder = t(e.dataset.i18nPh)));
  $('#cmdk-input').placeholder = t('cmdPh');
  document.body.dataset.drop = t('dropHere');
  $('#suggestions').innerHTML = t('sugs').map(([i, a, b]) => `<div class="sug" data-p="${esc(b)}"><span class="sug-ico">${ico(i)}</span><div><b>${esc(a)}</b><span>${esc(b)}</span></div></div>`).join('');
  localStorage.setItem('orca.lang', lang);
}

// ───────────────────────── theme ─────────────────────────
const P = { theme: 'dark', accent: 'indigo', fontSize: 14, density: 'comfortable', showReasoning: true, sendKey: 'enter', sound: false, notifications: true };
const mq = window.matchMedia('(prefers-color-scheme: light)');
function applyPrefs() {
  const th = P.theme === 'system' ? (mq.matches ? 'light' : 'dark') : P.theme;
  root.dataset.theme = th; root.dataset.accent = P.accent; root.dataset.density = P.density;
  root.style.setProperty('--fs', P.fontSize + 'px');
  $('#tb-theme').innerHTML = ico(th === 'dark' ? 'moon' : 'sun');
  $('#send-hint').textContent = P.sendKey === 'enter' ? 'Enter ↵' : 'Ctrl ↵';
  localStorage.setItem('orca.prefs', JSON.stringify(P));
}
try { Object.assign(P, JSON.parse(localStorage.getItem('orca.prefs') || '{}')); } catch (_) {}
mq.addEventListener('change', applyPrefs);
applyPrefs();

// ───────────────────────── markdown ─────────────────────────
marked.setOptions({ gfm: true, breaks: true });
const mdCache = new Map();
function md(text, live = false) {
  text = String(text || '');
  if (live) text = text.replace(/<(?:｜DSML｜|\|DSML\|)[\s\S]*$/, '').replace(/<\/?(?:tool_call|invoke|parameter)[^>]*>/g, '').replace(/<\/?(?:minimax|kimi|glm|deepseek|qwen)?:?tool_calls?[^>]*>/gi, ''); // never show half-streamed tool markup
  if (!live && mdCache.has(text)) return mdCache.get(text);
  let html;
  try { html = marked.parse(text); } catch (_) { html = esc(text); }
  html = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  const box = el('div'); box.innerHTML = html;
  $$('pre', box).forEach((pre) => {
    const code = $('code', pre); if (!code) return;
    const langName = (code.className.match(/language-([\w+-]+)/) || [])[1] || '';
    try { if (!live && code.textContent.length < 30000) hljs.highlightElement(code); } catch (_) {} // highlight once, when the answer is final
    const head = el('div', 'pre-head', `<span>${esc(langName || 'text')}</span><span class="ph-btns"><button class="ph-open" title="${t('openInPanel')}">${ico('panel-r')}</button><button class="ph-dl" title="${t('download')}">${ico('download')}</button><button class="ph-copy">${ico('copy')}<span>${t('copy')}</span></button></span>`);
    $('.ph-copy', head).onclick = async (e) => { e.stopPropagation(); const ok = await copyText(code.textContent); const s = $('span', e.currentTarget); s.textContent = ok ? t('copied') : t('copyFail'); setTimeout(() => (s.textContent = t('copy')), 1400); };
    $('.ph-dl', head).onclick = (e) => { e.stopPropagation(); const ext = { javascript: 'js', typescript: 'ts', python: 'py', html: 'html', css: 'css', json: 'json', bash: 'sh', shell: 'sh', markdown: 'md' }[langName] || langName || 'txt'; dl('snippet.' + ext, code.textContent); };
    $('.ph-open', head).onclick = (e) => { e.stopPropagation(); openPanel(); showTab('preview'); previewText('snippet.' + (langName || 'txt'), code.textContent, langName); };
    pre.prepend(head);
  });
  $$('a', box).forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; if (/^\[?\d{1,2}\]?$/.test(a.textContent.trim())) { a.classList.add('cite'); a.textContent = a.textContent.replace(/[\[\]]/g, ''); a.title = a.href; } });
  const out = box.innerHTML;
  if (!live) { if (mdCache.size > 300) mdCache.clear(); if (text.length < 30000) mdCache.set(text, out); }
  return out;
}
const dl = (name, text) => { if (desktop) return desktop.saveFile(name, text); const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name; a.click(); };
document.addEventListener('click', (e) => { const a = e.target.closest('a[href^="http"]'); if (a && desktop) { e.preventDefault(); desktop.openExternal(a.href); } });
const detectDir = (s) => (/[\u0600-\u06FF]/.test(String(s).slice(0, 300)) ? 'rtl' : 'ltr');

// ───────────────────────── state ─────────────────────────
const S = { webMode: false, cfg: null, chats: [], chat: null, mode: 'direct', planMode: false, autonomy: 'auto', running: new Map(), lanes: new Map(), attach: [], allowAll: false, regenFrom: null, stepCount: 0 };
const toast = (m, k = '') => { const d = el('div', 'toast ' + k, (k === 'ok' ? ico('check') : k === 'err' ? ico('x') : '') + `<span>${esc(m)}</span>`); $('#toasts').appendChild(d); setTimeout(() => d.remove(), 3200); };
// Copy that survives hostile embeds: Clipboard API first, execCommand fallback, honest feedback.
const copyText = async (txt) => { try { await navigator.clipboard.writeText(txt); return true; } catch (_) {} try { const ta = el('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, txt.length); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (_) { return false; } };
const copyFeedback = async (txt) => { if (await copyText(txt)) toast(t('copied'), 'ok'); else toast(t('copyFail'), 'err'); };
const modelOf = (key) => S.cfg?.models.find((x) => x.key === key);
// ── brand marks (simple-icons CC0 paths in brands.js; monogram fallback) ──
const BRANDS = window.ORCA_BRANDS || {};
const BRAND_RULES = [[/openai|gpt-|chatgpt/, 'openai'], [/anthropic|claude/, 'anthropic'], [/google|gemini|bard/, 'google'], [/meta|llama/, 'meta'], [/mistral/, 'mistralai'], [/minimax|abab/, 'minimax'], [/deepseek/, 'deepseek'], [/qwen|alibaba|dashscope|tongyi/, 'qwen'], [/moonshot|kimi/, 'kimi'], [/perplexity/, 'perplexity'], [/hugging|hf-/, 'huggingface'], [/openrouter/, 'openrouter'], [/nvidia/, 'nvidia'], [/amazon|aws|bedrock/, 'amazon'], [/microsoft|azure/, 'microsoft'], [/ollama/, 'ollama']];
const brandHue = (str) => { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
// official brand hex → a legible variant for dark themes (lift lightness of dark colors, like brands' own dark-mode logos)
const brandDark = (hex) => {
  const n = parseInt(hex, 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255; const l = (mx + mn) / 2;
  if (l >= 0.45) return '#' + hex;
  const hsl = (() => { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const ll = (max + min) / 2; const d = max - min; if (d) { s = d / (1 - Math.abs(2 * ll - 1)); switch (max) { case r: h = ((g - b) / d) % 6; break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h = Math.round(h * 60); if (h < 0) h += 360; } return [h, s, ll]; })();
  const [h, s] = hsl; const L = 0.68, S = Math.min(s, 0.85);
  const c = (1 - Math.abs(2 * L - 1)) * S, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - c / 2;
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.min(5, Math.floor(h / 60))];
  return '#' + seg.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
};
const brandMark = (m, cls = '') => {
  const k = String(m?.key || '');
  const lbl = esc(m?.vendor || m?.label || m?.provider || '');
  if (k === 'auto' || /orca/i.test(String(m?.vendor || ''))) return `<img class="brand-img ${cls}" src="/assets/logo.png" alt="ORCA"${lbl ? ` title="${lbl}"` : ''}>`;
  // custom logo set by the user for a provider (or model) — any future brand gets its real logo this way
  const logo = m?.logo || S.cfg?.providers?.[m?.provider]?.logo || '';
  if (logo && /^(https?:\/\/|data:image\/)/i.test(logo)) return `<img class="brand-img ${cls}" src="${esc(logo)}" alt="${lbl}"${lbl ? ` title="${lbl}"` : ''}>`;
  const hay = [m?.vendor, m?.provider, m?.label, k].join(' ').toLowerCase();
  let slug = ''; for (const [re, sl] of BRAND_RULES) if (re.test(hay)) { slug = sl; break; }
  const B = slug && BRANDS[slug];
  if (B) { const c = '#' + (B.c || '000000'); return `<svg class="brand ${cls}" viewBox="0 0 24 24" role="img" aria-label="${lbl}" style="--bc:${c};--bcd:${brandDark(B.c || '000000')}"${lbl ? ` title="${lbl}"` : ''}><path d="${B.d}"/></svg>`; }
  const ch = String(m?.label || m?.vendor || m?.provider || '?').trim()[0] || '?';
  return `<span class="brand-m ${cls}" style="--h:${brandHue(hay || ch)}"${lbl ? ` title="${lbl}"` : ''}>${esc(ch.toUpperCase())}</span>`;
};

// tooltips
const tip = $('#tip');
document.addEventListener('mouseover', (e) => { const b = e.target.closest('[data-tip]'); if (!b) { tip.classList.remove('show'); return; } tip.textContent = b.dataset.tip; const r = b.getBoundingClientRect(); tip.style.left = r.left + r.width / 2 + 'px'; tip.style.top = (r.bottom + 6) + 'px'; tip.classList.add('show'); });
document.addEventListener('mousedown', () => tip.classList.remove('show'));

// ───────────────────────── model pickers ─────────────────────────
function closeModelMenu() { const m = $('#pk-menu'); if (!m) return; if (m._key) document.removeEventListener('keydown', m._key, true); m.remove(); }
function openModelMenu(anchor, value, onChange) {
  closeModelMenu();
  const menu = el('div', 'pk-menu'); menu.id = 'pk-menu'; menu.setAttribute('role', 'listbox');
  const groups = new Map();
  for (const x of S.cfg.models) { const g = x.provider || x.vendor || 'ORCA'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
  for (const [g, list] of groups) {
    menu.appendChild(el('div', 'pk-group', esc(g)));
    for (const x of list) {
      const row = el('button', 'pk-item' + (x.key === value ? ' sel' : ''));
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', x.key === value ? 'true' : 'false');
      row.innerHTML = `<span class="pk-i-top"><span class="pk-i-label">${esc(x.label)}</span>${x.tier ? `<em class="pk-i-tier">${esc(t('tier')[x.tier] || '')}</em>` : ''}${x.key === value ? ico('check', 'pk-i-check') : ''}</span><span class="pk-i-sub">${esc(x.note?.[lang] || x.vendor || '')}</span>`;
      row.onclick = (e) => { e.stopPropagation(); closeModelMenu(); buildPicker(anchor, x.key, onChange); onChange(x.key); };
      menu.appendChild(row);
    }
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect(); const mw = menu.offsetWidth; const mh = menu.offsetHeight;
  menu.style.left = Math.min(Math.max(8, r.left), innerWidth - mw - 8) + 'px';
  menu.style.top = (r.bottom + 6 + mh > innerHeight - 8 ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
  const items = $$('.pk-item', menu); let i = Math.max(0, items.findIndex((x) => x.classList.contains('sel')));
  menu._key = (e) => {
    if (!menu.isConnected) { document.removeEventListener('keydown', menu._key, true); return; } // never swallow keys for a menu that is gone
    if (e.key === 'Escape') { closeModelMenu(); anchor.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((x, k) => x.classList.toggle('hov', k === i)); items[i].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); items[i].click(); }
  };
  document.addEventListener('keydown', menu._key, true);
  setTimeout(() => document.addEventListener('click', closeModelMenu, { once: true }), 0);
}
function buildPicker(container, value, onChange) {
  container.innerHTML = '';
  const m = modelOf(value) || S.cfg.models[0];
  container.append(el('span', 'pk-label', esc(m?.label || value)), el('span', 'pk-tier', m ? esc(t('tier')[m.tier] || '') : ''), el('span', 'pk-chev', ico('chev')));
  container.tabIndex = 0; container.setAttribute('role', 'button'); container.setAttribute('aria-haspopup', 'listbox');
  container.onclick = (e) => { e.stopPropagation(); openModelMenu(container, container.value, onChange); };
  container.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModelMenu(container, container.value, onChange); } };
  container.value = m?.key || value;
}
async function loadConfig() {
  S.cfg = await api('/api/config');
  buildPicker($('#pick-single'), S.cfg.defaultModel, (v) => api('/api/config', { method: 'POST', body: { defaultModel: v } }));
  const cmp = S.cfg.compareModels || [];
  const saveCmp = () => api('/api/config', { method: 'POST', body: { compareModels: [$('#pick-a').value, $('#pick-b').value] } });
  buildPicker($('#pick-a'), cmp[0] || 'minimax', saveCmp);
  buildPicker($('#pick-b'), cmp[1] || 'deepseek', saveCmp);
  S.autonomy = S.cfg.autonomy || 'auto'; $$('#autonomy button').forEach((b) => b.classList.toggle('active', b.dataset.a === S.autonomy));
  $('#ws-path').textContent = S.cfg.workspaceDir; $('#ws-lbl').textContent = S.cfg.workspaceDir;
  $('#tb-status').className = 'dot on';
  api('/api/health').then((h) => { S.cfg.visionOn = !!h.vision; S.health = h; }).catch(() => {});
}

// ───────────────────────── chats list ─────────────────────────
function groupLabel(ts) { const n = new Date(); const day = 864e5; const sd = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); if (ts >= sd) return t('today'); if (ts >= sd - day) return t('yesterday'); if (ts >= sd - 6 * day) return t('week'); return t('older'); }
async function loadChats() { S.chats = (await api('/api/chats')).chats; if (!$('#search').value.trim()) renderChatList(S.chats); }
function renderChatList(list) {
  const box = $('#chat-list'); box.innerHTML = '';
  if (!list.length) { box.appendChild(el('div', 'empty', t('noChats'))); return; }
  let g = null;
  for (const c of list) {
    const lbl = c.pinned ? t('pinned') : groupLabel(c.updatedAt);
    if (lbl !== g) { g = lbl; box.appendChild(el('div', 'chat-group', esc(lbl))); }
    const it = el('div', 'chat-item' + (S.chat && S.chat.id === c.id ? ' active' : '') + (c.pinned ? ' pinned' : ''));
    it.innerHTML = `${ico(c.pinned ? 'pin' : c.mode === 'battle' ? 'swords' : c.mode === 'side' ? 'compare' : 'chat', 'ci-ico')}<span class="ci-title" dir="auto">${esc(c.title)}</span><button class="ci-x pin" data-tip="${c.pinned ? t('unpin') : t('pin')}">${ico('pin')}</button><button class="ci-x del" data-tip="${t('deleted')}">${ico('trash')}</button>`;
    it.onclick = () => openChat(c.id);
    it.ondblclick = async (e) => { e.stopPropagation(); const nm = prompt(t('rename'), c.title); if (nm && nm.trim()) { await api('/api/chats/' + c.id, { method: 'POST', body: { title: nm.trim() } }); if (S.chat?.id === c.id) $('#tb-title').textContent = nm.trim(); loadChats(); } };
    $('.pin', it).onclick = async (e) => { e.stopPropagation(); await api('/api/chats/' + c.id, { method: 'POST', body: { pinned: !c.pinned } }); loadChats(); };
    $('.del', it).onclick = async (e) => { e.stopPropagation(); if (!confirm(t('delChat'))) return; await api('/api/chats/' + c.id, { method: 'DELETE' }); if (S.chat && S.chat.id === c.id) newChat(); loadChats(); };
    box.appendChild(it);
  }
}
let searchTimer;
$('#search').oninput = () => { clearTimeout(searchTimer); const q = $('#search').value.trim(); if (!q) return renderChatList(S.chats); searchTimer = setTimeout(async () => { const { hits } = await api('/api/search?q=' + encodeURIComponent(q)); const box = $('#chat-list'); box.innerHTML = ''; if (!hits.length) box.appendChild(el('div', 'empty', '—')); const re = new RegExp('(' + q.split(/\s+/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi'); for (const h of hits) { const d = el('div', 'search-hit'); d.innerHTML = `<b dir="auto">${esc(h.title)}</b><span dir="auto">${esc(h.snippet).replace(re, '<mark>$1</mark>')}</span>`; d.onclick = () => openChat(h.chatId, h.msgId); box.appendChild(d); } }, 180); };

// ───────────────────────── mode ─────────────────────────
function setMode(m) { S.mode = m; $$('#mode-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m)); $('#pick-single').classList.toggle('hidden', m !== 'direct'); $('#pick-a').classList.toggle('hidden', m !== 'side'); $('#pick-b').classList.toggle('hidden', m !== 'side'); $('#messages').classList.toggle('wide', m !== 'direct'); }
$$('#mode-seg button').forEach((b) => (b.onclick = () => { if (runningHere()) return toast(t('running'), 'err'); if (S.chat && S.chat.messages.length && S.chat.mode !== b.dataset.mode) newChat(); setMode(b.dataset.mode); }));
// runs that belong to the chat currently on screen (others keep streaming in the background and are re-rendered when you return)
const runningHere = () => [...S.lanes.values()].some((L) => L.group && L.group.chatId === S.chat?.id && S.running.has(L.runId));
function newChat() { S.chat = null; S.regenFrom = null; S.queue = []; renderQueue(); setBusy(false); refreshPins(); refreshNotes(); $('#messages').innerHTML = ''; $('#welcome').classList.remove('hidden'); $('#tb-title').textContent = ''; $('#tab-timeline').innerHTML = `<div class="empty">${t('emptyTimeline')}</div>`; $('#changes-list').innerHTML = ''; $('#chg-badge').classList.add('hidden'); renderChatList(S.chats); swapAtts(); $('#input').focus(); }
$('#new-chat').onclick = newChat;

async function openChat(id, focusMsg) {
  const c = await api('/api/chats/' + id); if (c.error) return;
  S.chat = c; setMode(c.mode || 'direct'); swapAtts();
  $('#welcome').classList.add('hidden'); $('#tb-title').textContent = c.title || '';
  setBusy(runningHere());
  const box = $('#messages'); box.innerHTML = '';
  const rendered = new Set();
  for (const m of c.messages) {
    if (m.role === 'user') box.appendChild(renderUser(m));
    else if (m.role === 'assistant' && !rendered.has(m.id)) {
      const group = m.runId ? c.messages.filter((x) => x.role === 'assistant' && x.runId === m.runId) : [m];
      group.forEach((x) => rendered.add(x.id));
      // still streaming? re-attach the live lane elements instead of a static snapshot
      const live = [...S.lanes.values()].filter((L) => group.some((x) => x.id === L.m.id) && S.running.has(L.runId));
      if (live.length) { const wrap = live[0].wrap; if (!wrap.isConnected) box.appendChild(wrap); else box.appendChild(wrap); }
      else box.appendChild(renderGroup(group, c));
    }
  }
  renderChatList(S.chats); refreshTimeline(); refreshChanges(); refreshPins(); refreshNotes();
  requestAnimationFrame(() => { const target = focusMsg && $(`[data-mid="${focusMsg}"]`); if (target) { target.scrollIntoView({ block: 'center' }); target.style.outline = '2px solid var(--acc)'; target.style.borderRadius = '12px'; setTimeout(() => (target.style.outline = ''), 1600); } else $('#thread').scrollTop = 1e9; });
}

// ───────────────────────── rendering ─────────────────────────
function renderUser(m) {
  const w = el('div', 'msg user' + (m.pinned ? ' pinned' : '')); w.dataset.mid = m.id;
  if (m.hidden) { w.classList.add('hidden-sys'); w.innerHTML = `<div class="sysnote">${ico('refresh')}<span>${esc(t('continuedNote'))}</span></div>`; return w; }
  const shown = String(m.content || '').replace(/\n\n<attached_(file|image)[\s\S]*$/, '').replace(/<attached_image[\s\S]*?<\/attached_image>/g, '').trim();
  const imgs = m.images || [...String(m.content || '').matchAll(/<attached_image path="([^"]+)"/g)].map((x) => x[1]);
  if (imgs.length) { const g = el('div', 'msg-imgs'); imgs.forEach((p) => { const im = el('img'); im.src = wsUrl(p); im.alt = p; im.loading = 'lazy'; im.onclick = () => lightbox(wsUrl(p)); g.appendChild(im); }); w.appendChild(g); }
  const b = el('div', 'bubble'); b.dir = detectDir(shown); b.textContent = shown || (imgs.length ? '🖼' : ''); w.appendChild(b);
  const files = m.files || [...String(m.content || '').matchAll(/<attached_file name="([^"]+)"/g)].map((x) => x[1]);
  if (files.length) { const f = el('div', 'files'); files.forEach((n) => f.appendChild(el('span', 'filechip', ico('file') + esc(n)))); w.appendChild(f); }
  const tools = el('div', 'msg-tools');
  const cp = el('button', '', ico('copy') + t('copy')); cp.onclick = () => copyFeedback(shown);
  const ed = el('button', '', ico('edit') + t('edit')); ed.onclick = () => { $('#input').value = shown; autosize(); $('#input').focus(); S.regenFrom = m.id; };
  const rg = el('button', '', ico('refresh') + t('regen')); rg.onclick = () => send(m.content, m.id);
  const pn = el('button', m.pinned ? 'on' : '', ico('pin') + (m.pinned ? t('unpin') : t('pin'))); pn.onclick = () => togglePinMsg(m);
  const fk = el('button', '', ico('branch') + t('fork')); fk.onclick = () => forkChat(m.id);
  const dx = el('button', 'danger', ico('trash') + t('delMsg')); dx.onclick = () => deleteMsg(m.id);
  tools.append(cp, ed, rg, pn, fk, dx); w.appendChild(tools);
  if (m.pastedPath) { const chip = el('div', 'files'); chip.appendChild(el('span', 'filechip', ico('file') + esc(m.pastedPath.split('/').pop()) + ` · ${fmtB(String(m.content || '').length)}`)); w.appendChild(chip); const b = $('.bubble', w); if (String(m.content || '').length > 1500) { b.textContent = String(m.content).slice(0, 1500) + ' …'; b.title = t('pasteSaved'); } }
  return w;
}
async function togglePinMsg(m) {
  const r = await api(`/api/chats/${S.chat.id}/messages/${m.id}`, { method: 'POST', body: { pinned: !m.pinned } });
  if (r.error) return toast(r.error, 'err');
  m.pinned = r.pinned; const w = $(`[data-mid="${m.id}"]`); if (w) w.classList.toggle('pinned', !!m.pinned);
  const sm = S.chat.messages.find((x) => x.id === m.id); if (sm) sm.pinned = m.pinned;
  toast(m.pinned ? t('pinnedMsg') : t('unpinnedMsg'), 'ok'); refreshPins(); if (w) { const btn = [...$$('.msg-tools button, .lane-foot button', w)].find((b) => b.textContent.trim() === t('pin') || b.textContent.trim() === t('unpin')); if (btn) { btn.innerHTML = ico('pin') + (m.pinned ? t('unpin') : t('pin')); btn.classList.toggle('on', !!m.pinned); } }
}
async function forkChat(messageId) {
  if (!S.chat) return;
  const c = await api(`/api/chats/${S.chat.id}/fork`, { method: 'POST', body: { messageId } });
  if (c.error) return toast(c.error, 'err');
  toast(t('forked'), 'ok'); await loadChats(); openChat(c.id);
}
async function deleteMsg(id) {
  if (!confirm(t('delMsgQ'))) return;
  await api(`/api/chats/${S.chat.id}/messages/${id}`, { method: 'DELETE' });
  S.chat = await api('/api/chats/' + S.chat.id); openChat(S.chat.id); loadChats();
}
function laneEl(m, anon, idx) {
  const lane = el('div', 'lane'); lane.dataset.mid = m.id;
  const info = modelOf(m.modelKey);
  const name = anon ? `${t(idx === 0 ? 'modelA' : 'modelB')} <span class="anon">?</span>` : `${brandMark(modelOf(m.model) || info || { label: m.model || '' })}${esc(m.model || info?.label || '')}`;
  lane.innerHTML = `<div class="lane-head"><span class="mname">${name}</span>${!anon && info?.vendor ? `<span class="vendor">${esc(info.vendor)}</span>` : ''}<span class="usage"></span></div>
    <details class="thought hidden"><summary>${ico('brain')}<span>${t('thoughts')}</span><span class="th-time"></span></summary><div class="th-body"></div></details>
    <div class="todos hidden"></div><div class="steps"></div><div class="content" dir="auto"></div><div class="outputs hidden"></div><div class="extra"></div>
    <div class="lane-foot"><button class="cp">${ico('copy')}${t('copy')}</button><button class="rg">${ico('refresh')}${t('regen')}</button><button class="pn${m.pinned ? ' on' : ''}">${ico('pin')}${m.pinned ? t('unpin') : t('pin')}</button><button class="fk">${ico('branch')}${t('fork')}</button><button class="ex">${ico('download')}.md</button><span class="meta"></span></div>`;
  if (m.pinned) lane.classList.add('pinned');
  $('.cp', lane).onclick = () => copyFeedback(L_text(lane));
  $('.pn', lane).onclick = () => togglePinMsg(m);
  $('.fk', lane).onclick = () => forkChat(m.id);
  $('.rg', lane).onclick = () => { const um = [...S.chat.messages].reverse().find((x) => x.role === 'user' && !x.hidden && x.ts <= (m.ts || Infinity)); if (um) send(um.content, um.id); };
  $('.ex', lane).onclick = () => dl('orca-answer.md', L_text(lane));
  return lane;
}
// answers longer than ~12k characters are folded to a preview with a "Show more" bar (the full text is still there for copy/export/search)
function collapseLong(c, text) {
  if (String(text || '').length < 12000 || c.dataset.folded) return;
  c.dataset.folded = '1'; c.classList.add('folded');
  const bar = el('button', 'show-more', ico('chev') + `<span>${t('showMore')} · ${fmtB(String(text).length)}</span>`);
  bar.onclick = () => { const open = c.classList.toggle('folded'); $('span', bar).textContent = (open ? t('showMore') : t('showLess')) + (open ? ' · ' + fmtB(String(text).length) : ''); if (!open) return; c.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  c.after(bar);
}
// plain text of an answer for copy/export: the markdown source when we have it, else the rendered text
const L_text = (lane) => { const m = S.chat && S.chat.messages.find((x) => x.id === lane.dataset.mid); return (m && m.content) || $('.content', lane).textContent; };
// "Response interrupted" → continue (same turn, no new prompt) or retry (regenerate from the user message)
function addInterruptedActions(lane, m) {
  if ($('.interrupted', lane)) return;
  const box = el('div', 'interrupted ' + (m.status === 'error' ? 'err' : 'stop'));
  const partial = !!String(m.content || '').trim();
  box.innerHTML = `${ico(m.status === 'error' ? 'x' : 'stop')}<span>${esc(m.status === 'error' ? (m.error || t('errGeneric')) : (partial ? t('stoppedPartial') : t('stopped')))}</span>${partial ? `<button class="btn btn-primary ct">${ico('play')}${t('continue')}</button>` : ''}<button class="btn rt">${ico('refresh')}${t('retry')}</button>`;
  $('.rt', box).onclick = () => { const um = [...S.chat.messages].reverse().find((x) => x.role === 'user' && !x.hidden && x.ts <= (m.ts || Infinity)); if (um) send(um.content, um.id); };
  if ($('.ct', box)) $('.ct', box).onclick = () => continueAnswer(m.id);
  $('.extra', lane).appendChild(box);
}
async function continueAnswer(msgId) {
  if (runningHere()) return toast(t('running'), 'err');
  setBusy(true); $('#status-text').textContent = '…';
  const body = { chatId: S.chat.id, continueFrom: msgId, mode: 'direct', model: $('#pick-single').value, autonomy: S.autonomy, lang, webMode: S.webMode };
  const r = await api('/api/send', { method: 'POST', body });
  if (r.error) { setBusy(false); return toast(r.error, 'err'); }
  S.chat = await api('/api/chats/' + S.chat.id); openChat(S.chat.id);
  const box = $('#messages');
  const wrap = el('div', 'msg assistant'); const lanes = el('div', 'lanes'); wrap.appendChild(lanes); box.appendChild(wrap);
  r.lanes.forEach((ln, i) => {
    const m = { id: ln.msgId, lane: '', model: modelOf(r.models[i])?.label || r.models[i], modelKey: r.models[i], runId: ln.runId.split(':')[0], events: [], status: 'running' };
    const l = laneEl(m, false, i); l.classList.add('streaming'); $('.content', l).classList.add('streaming'); lanes.appendChild(l);
    S.lanes.set(ln.runId, { el: l, m, content: '', reasoning: '', steps: {}, wrap, group: { ...r, chatId: S.chat.id }, anon: false, t0: Date.now(), runId: ln.runId });
    S.running.set(ln.runId, true);
  });
  $('#thread').scrollTop = 1e9;
}
function fillLane(lane, m) {
  if (m.reasoning) { const th = $('.thought', lane); th.classList.remove('hidden'); $('.th-body', th).textContent = m.reasoning; }
  const steps = $('.steps', lane); steps.innerHTML = '';
  const calls = {}; let lastTodos = null; const outs = [];
  for (const e of m.events || []) {
    if (e.event === 'tool_call') calls[e.data.id] = addStep(steps, e.data);
    else if (e.event === 'tool_result' && calls[e.data.id]) finishStep(calls[e.data.id], e.data);
    else if (e.event === 'question') showQuestion(lane, e.data);
    else if (e.event === 'todos') lastTodos = e.data.todos;
    else if (e.event === 'files') outs.push(...(e.data.files || []));
    else if (e.event === 'sub_event') addSubEvent(lane, e.data);
  }
  if (lastTodos) renderTodos(lane, lastTodos);
  if (outs.length) renderOutputs(lane, outs);
  collapseSteps(steps);
  const c = $('.content', lane); c.innerHTML = md(m.content); c.dir = detectDir(m.content); collapseLong(c, m.content);
  if (m.status === 'error' || m.status === 'stopped') { addInterruptedActions(lane, m); if (m.status === 'stopped') $('.meta', lane).textContent = t('stopped'); }
  if (m.usage) { const u = $('.usage', lane); u.textContent = `${fmtN(m.usage.prompt_tokens)}↑ ${fmtN(m.usage.completion_tokens)}↓${m.usage.estimated ? '~' : ''}${m.tookMs ? ' · ' + fmtDur(m.tookMs) : ''}`; u.title = `${(m.usage.prompt_tokens || 0).toLocaleString()} input · ${(m.usage.completion_tokens || 0).toLocaleString()} output tokens`; }
  if (m.status === 'done' && PLAN_RE.test(m.content || '')) addPlanActions(lane);
}
const fmtN = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0));
const TOOL_ICO = { start_process: 'play', process_output: 'terminal', stop_process: 'stop', list_processes: 'play', view_image: 'image', ocr_image: 'image', screenshot: 'image', social_download: 'download', social_trending: 'globe', generate_image: 'image', generate_video: 'play', glob: 'search', grep: 'search', todo_write: 'check', todo_read: 'check', diagnostics: 'shield', project_init: 'brain', task: 'sparkle', write_docx: 'file', read_docx: 'file', write_xlsx: 'file', read_xlsx: 'file', write_pptx: 'file', read_pdf: 'file', media_info: 'play', media_edit: 'play', media_concat: 'play', media_from_images: 'play', media_subtitles: 'play', run_shell: 'terminal', run_node: 'code', run_python: 'code', write_file: 'file', edit_file: 'edit', delete_file: 'trash', read_file: 'file', list_files: 'folder', search_files: 'search', web_search: 'globe', fetch_page: 'globe', http_request: 'globe', remember: 'brain', recall: 'brain', ask_user: 'question' };
const argOf = (d) => d.name === 'social_download' || d.name === 'view_image' || d.name === 'screenshot' ? (d.args.url || d.args.path || '') : d.name === 'social_trending' ? `${d.args.platform || 'tiktok'} ${d.args.query || d.args.region || ''}`.trim() : d.name === 'generate_image' || d.name === 'generate_video' ? String(d.args.prompt || '').slice(0, 90) : d.name === 'task' ? d.args.description : d.name === 'todo_write' ? `${(d.args.todos || []).length} items` : d.name === 'grep' || d.name === 'glob' ? d.args.pattern : d.args && (d.args.input || d.args.output) && /^media_/.test(d.name) ? `${d.args.operation || ''} ${d.args.input || ''}${d.args.output ? ' → ' + d.args.output : ''}`.trim() : d.args && d.args._truncated ? `${d.args.path || ''} ⚠ ${({ fa: 'خروجی مدل بریده شد — بخش سالم ذخیره و ادامه داده می‌شود', ru: 'вывод модели обрезан — сохранено, продолжаю', zh: '模型输出被截断 — 已保留可用部分，继续' })[lang] || 'model output cut — salvaged, continuing'}` : d.name === 'run_shell' ? d.args.command : d.name === 'web_search' ? d.args.query : d.name === 'fetch_page' || d.name === 'http_request' ? d.args.url : d.args.path || d.args.pattern || d.args.note || d.args.query || (d.args.code ? d.args.code.slice(0, 90) : JSON.stringify(d.args).slice(0, 90));
function diffCard(a) {
  const list = Array.isArray(a.edits) ? a.edits : [{ old: a.old, new: a.new, all: a.all }];
  const ln = (x) => String(x ?? '').split('\n').slice(0, 12).join('\n');
  return '<div class="diffcard">' + list.map((e, i) => `<div class="dc-h">${esc(a.path || '')} · edit ${i + 1}${e.all ? ' · all' : ''}</div><pre class="dc-del">- ${esc(ln(e.old).split('\n').join('\n- '))}</pre><pre class="dc-add">+ ${esc(ln(e.new).split('\n').join('\n+ '))}</pre>`).join('') + '</div>';
}
function addStep(steps, d) {
  const s = el('div', 'step run'); s.dataset.cid = d.id;
  s.innerHTML = `<span class="ico">${ico('refresh')}</span><span class="st-name">${esc(d.name)}</span><span class="st-arg">${esc(argOf(d) || '')}</span><span class="st-ms"></span><div class="st-out"></div>`;
  s.onclick = () => s.classList.toggle('open');
  if (d.name === 'edit_file' && d.args && (d.args.old || Array.isArray(d.args.edits))) $('.st-out', s).innerHTML = diffCard(d.args);
  else if (d.name === 'write_file' && d.args && typeof d.args.content === 'string') { const ls = d.args.content.split('\n'); $('.st-out', s).innerHTML = `<div class="diffcard"><div class="dc-h">${esc(d.args.path || '')} · ${ls.length} lines</div><pre class="dc-add">+ ${esc(ls.slice(0, 10).join('\n+ '))}${ls.length > 10 ? '\n+ …' : ''}</pre></div>`; }
  else $('.st-out', s).textContent = JSON.stringify(d.args, null, 2);
  steps.appendChild(s); return s;
}
function finishStep(s, d) {
  s.classList.remove('run'); s.classList.add(d.ok ? 'ok' : 'fail'); $('.ico', s).innerHTML = ico(d.ok ? 'check' : 'x'); $('.st-ms', s).textContent = d.ms != null ? d.ms + 'ms' : '';
  let pretty = d.result; let sum = '';
  try { const j = JSON.parse(d.result); pretty = j.error ? 'ERROR: ' + j.error : (j.output ?? j.content ?? j.text ?? (j.results ? j.results.map((r) => `• ${r.title}\n  ${r.url}\n  ${r.snippet || ''}`).join('\n') : JSON.stringify(j, null, 2))); if (j.replaced != null) sum = j.replaced + ' replaced' + (j.syntax ? ' · syntax ' + j.syntax : '') + (j.related_tests && j.related_tests.length ? ' · tests: ' + j.related_tests.join(', ') : ''); if (j.error) sum = j.error; } catch (_) {}
  if ($('.diffcard', s)) { $('.st-out', s).insertAdjacentHTML('afterbegin', `<div class="dc-sum ${d.ok ? 'good' : 'bad'}">${d.ok ? '✓' : '✗'} ${esc(sum || (d.ok ? 'ok' : 'failed'))}</div>`); if (!d.ok) $('.st-out', s).insertAdjacentHTML('beforeend', `<pre class="dc-err">${esc(String(pretty).slice(0, 600))}</pre>`); }
  else $('.st-out', s).textContent = pretty;
}
function collapseSteps(steps) {
  const n = steps.children.length; if (n <= 4 || $('.steps-more', steps.parentElement)) return;
  steps.classList.add('collapsed');
  const more = el('div', 'steps-more', t('moreSteps')(n - 3)); more.onclick = () => { const c = steps.classList.toggle('collapsed'); more.textContent = c ? t('moreSteps')(n - 3) : t('lessSteps'); };
  steps.after(more);
}
const MEDIA_RE = /\.(png|jpe?g|gif|webp|bmp)$/i, VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i, AUDIO_RE = /\.(mp3|m4a|wav|ogg|aac)$/i;
function renderOutputs(lane, files) {
  const box = $('.outputs', lane); if (!box) return;
  const uniq = [...new Set(files)].filter((p) => MEDIA_RE.test(p) || VIDEO_RE.test(p) || AUDIO_RE.test(p) || /\.(docx|xlsx|pptx|pdf|html?)$/i.test(p));
  if (!uniq.length) return;
  box.classList.remove('hidden'); box.innerHTML = `<div class="out-head">${ico('folder')}<span>${t('outputs')}</span><span class="pill">${uniq.length}</span></div><div class="out-grid"></div>`;
  const g = $('.out-grid', box);
  for (const p of uniq.slice(0, 24)) {
    const u = wsUrl(p); const name = p.split('/').pop();
    let card;
    if (MEDIA_RE.test(p)) { card = el('div', 'out img'); card.innerHTML = `<img src="${u}?t=${Date.now()}" alt="" loading="lazy"><span class="cap" dir="ltr">${esc(name)}</span>`; card.onclick = () => lightbox(u); }
    else if (VIDEO_RE.test(p)) { card = el('div', 'out vid'); card.innerHTML = `<video src="${u}" controls preload="metadata" playsinline></video><span class="cap" dir="ltr">${esc(name)}</span>`; }
    else if (AUDIO_RE.test(p)) { card = el('div', 'out aud'); card.innerHTML = `${ico('play')}<span class="cap" dir="ltr">${esc(name)}</span><audio src="${u}" controls preload="none"></audio>`; }
    else { card = el('div', 'out doc'); card.innerHTML = `${ico('file')}<span class="cap" dir="ltr">${esc(name)}</span>`; card.onclick = () => { openPanel(); showTab('preview'); previewFile(p); }; }
    const a = el('a', 'out-dl', ico('download')); a.href = u; a.download = name; a.title = t('download'); a.onclick = (e) => e.stopPropagation(); card.appendChild(a);
    g.appendChild(card);
  }
}
function renderTodos(lane, todos) {
  const box = $('.todos', lane); if (!box) return;
  if (!todos || !todos.length) { box.classList.add('hidden'); return; }
  const done = todos.filter((x) => x.status === 'done').length;
  box.classList.remove('hidden');
  box.innerHTML = `<div class="td-head">${ico('check')}<span>${t('tasks')}</span><span class="td-prog"><i style="width:${Math.round(done / todos.length * 100)}%"></i></span><span class="mono td-n">${done}/${todos.length}</span></div>` + todos.map((x) => `<div class="td ${x.status}"><span class="td-ico">${x.status === 'done' ? ico('check') : x.status === 'in_progress' ? '<span class="spinner"></span>' : x.status === 'cancelled' ? ico('x') : ''}</span><span dir="auto">${esc(x.text)}</span></div>`).join('');
}
function addSubEvent(lane, d) {
  const steps = $('.steps', lane); if (!steps) return;
  let card = $(`.subagent[data-sub="${d.runId}"]`, steps);
  if (!card) { card = el('div', 'subagent'); card.dataset.sub = d.runId; card.innerHTML = `<div class="subagent-head">${ico('sparkle')}<span class="pill acc">${t('subagent')}</span><b dir="auto">${esc(d.description || '')}</b><span class="subagent-n mono"></span></div><div class="subagent-body"></div>`; card.onclick = () => card.classList.toggle('open'); steps.appendChild(card); }
  if (d.event === 'tool_call') { const b = $('.subagent-body', card); b.appendChild(el('div', 'subagent-step', `${ico(TOOL_ICO[d.data.name] || 'terminal')}<span class="mono">${esc(d.data.name)}</span><span class="st-arg">${esc(argOf(d.data) || '')}</span>`)); $('.subagent-n', card).textContent = b.children.length; }
}
function lightbox(src) { const lb = el('div', 'lightbox'); lb.innerHTML = `<img src="${src}" alt=""><a class="btn sm" href="${src}" download target="_blank">${ico('download')}${t('download')}</a>`; lb.onclick = (e) => { if (e.target.tagName !== 'A' && !e.target.closest('a')) lb.remove(); }; document.body.appendChild(lb); }
function showQuestion(lane, d) {
  if ($(`.question[data-q="${d.id}"]`, lane)) return;
  const q = el('div', 'question'); q.dataset.q = d.id; q.innerHTML = `<div class="q-head">${ico('question')}<span dir="auto">${esc(d.question)}</span></div><div class="q-opts"></div>`;
  for (const o of d.options || []) { const b = el('button', 'btn sm', esc(o)); b.onclick = () => send(o); $('.q-opts', q).appendChild(b); }
  $('.extra', lane).appendChild(q);
}
function addPlanActions(lane) {
  if ($('.plan-actions', lane)) return;
  const p = el('div', 'plan-actions'); const go = el('button', 'btn primary', ico('check') + t('planGo')); const ed = el('button', 'btn', ico('edit') + t('planEdit'));
  go.onclick = () => { S.planMode = false; $('#plan-toggle').classList.remove('active'); send(({ fa: 'بله، نقشه را اجرا کن.', ru: 'Да, выполни план.', zh: '是的，执行计划。' })[lang] || 'Yes, execute the plan.'); };
  ed.onclick = () => $('#input').focus();
  p.append(go, ed); $('.extra', lane).appendChild(p);
}
function renderGroup(group, chat) {
  const wrap = el('div', 'msg assistant');
  const lanes = el('div', 'lanes' + (group.length === 2 ? ' two' : '')); wrap.appendChild(lanes);
  const vote = (chat.votes || []).find((v) => v.runId === group[0].runId);
  const anon = chat.mode === 'battle' && !vote;
  group.forEach((m, i) => { const l = laneEl(m, anon, i); fillLane(l, m); lanes.appendChild(l); });
  if (group.length === 2) wrap.appendChild(voteBar(group, vote));
  return wrap;
}
function voteBar(group, vote) {
  const wrap = el('div');
  const v = el('div', 'vote');
  const finished = group.every((m) => ['done', 'error', 'stopped', 'question'].includes(m.status));
  for (const [k, lbl] of [['a', '👈 ' + t('voteA')], ['b', t('voteB') + ' 👉'], ['tie', '🤝 ' + t('tie')], ['both', '👎 ' + t('both')]]) {
    const b = el('button', vote && vote.winner === k ? 'voted' : '', lbl); b.disabled = !!vote || !finished;
    b.onclick = async () => { await api('/api/chats/' + S.chat.id + '/vote', { method: 'POST', body: { runId: group[0].runId, a: group[0].modelKey || group[0].model, b: group[1].modelKey || group[1].model, winner: k } }); toast('🗳 ' + lbl, 'ok'); openChat(S.chat.id); };
    v.appendChild(b);
  }
  wrap.appendChild(v);
  if (vote || S.chat.mode !== 'battle') { const mk = (mm) => `${brandMark(modelOf(mm) || { key: mm, label: mm })}<b>${esc(mm)}</b>`; wrap.appendChild(el('div', 'reveal', `${t('revealed')} A = ${mk(group[0].model || group[0].modelKey)} · B = ${mk(group[1].model || group[1].modelKey)}`)); }
  return wrap;
}

// ───────────────────────── composer ─────────────────────────
function autosize() { const i = $('#input'); i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 260) + 'px'; }
const SLASH_D = { help: { en: 'help', fa: 'راهنما', ru: 'справка', zh: '帮助' }, init: { en: 'create ORCA.md project memory', fa: 'ساخت ORCA.md', ru: 'создать ORCA.md', zh: '创建 ORCA.md' }, compact: { en: 'compact conversation', fa: 'فشرده‌سازی', ru: 'сжать диалог', zh: '压缩对话' }, plan: { en: 'toggle plan mode', fa: 'نقشه', ru: 'режим плана', zh: '计划模式' }, model: { en: 'minimax | deepseek | glm | auto', fa: 'minimax | deepseek | glm | auto', ru: 'minimax | deepseek | glm | auto', zh: 'minimax | deepseek | glm | auto' }, export: { en: 'export Markdown', fa: 'خروجی Markdown', ru: 'экспорт Markdown', zh: '导出 Markdown' }, files: { en: 'files panel', fa: 'پنل فایل‌ها', ru: 'панель файлов', zh: '文件面板' }, clear: { en: 'new chat', fa: 'گفتگوی جدید', ru: 'новый чат', zh: '新对话' } };
const SLASH = Object.keys(SLASH_D).map((k) => ['/' + k, SLASH_D[k]]);
function slashMenu() { const v = $('#input').value; let m = $('#slash-menu'); if (!/^\/[a-z]*$/i.test(v)) { if (m) m.remove(); return; } const items = SLASH.filter(([c]) => c.startsWith(v.toLowerCase())); if (!items.length) { if (m) m.remove(); return; } if (!m) { m = el('div', 'slash-menu'); m.id = 'slash-menu'; $('#composer').prepend(m); } m.innerHTML = items.map(([c, d], i) => `<div class="sl ${i === 0 ? 'sel' : ''}" data-c="${c}"><code>${c}</code><span>${esc(typeof d === 'object' ? (d[lang] || d.en) : d)}</span></div>`).join(''); $$('.sl', m).forEach((d) => (d.onmousedown = (e) => { e.preventDefault(); $('#input').value = d.dataset.c + ' '; m.remove(); $('#input').focus(); })); }
$('#input').oninput = () => { autosize(); slashMenu(); };
$('#input').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('#input')) $('#slash-menu')?.remove(); }, 150));
$('#input').onkeydown = (e) => {
  const sm = $('#slash-menu');
  if (sm && (e.key === 'Tab' || (e.key === 'Enter' && $('.sl.sel', sm)))) { e.preventDefault(); const sel = $('.sl.sel', sm) || $('.sl', sm); $('#input').value = sel.dataset.c + ' '; sm.remove(); return; }
  if (sm && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const items = $$('.sl', sm); let i = items.findIndex((x) => x.classList.contains('sel')); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((x, k) => x.classList.toggle('sel', k === i)); return; }
  if (e.key !== 'Enter' || e.isComposing) return;
  const wantCtrl = P.sendKey === 'ctrlEnter';
  if ((wantCtrl && (e.ctrlKey || e.metaKey)) || (!wantCtrl && !e.shiftKey && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); send(); }
};
$('#send').onclick = () => (runningHere() ? stopAll() : send());
$('#stop-btn').onclick = stopAll;
$('#suggestions').onclick = (e) => { const s = e.target.closest('.sug'); if (s) { $('#input').value = s.dataset.p; autosize(); send(); } };
$('#plan-toggle').onclick = () => { S.planMode = !S.planMode; $('#plan-toggle').classList.toggle('active', S.planMode); };
$('#web-toggle').onclick = () => { S.webMode = !S.webMode; $('#web-toggle').classList.toggle('active', S.webMode); };
// ── pins & notes panel ──
function refreshPins() {
  const box = $('#pins-list'); if (!box) return;
  const pins = S.chat ? S.chat.messages.filter((m) => m.pinned) : [];
  $('#pin-badge').textContent = pins.length; $('#pin-badge').classList.toggle('hidden', !pins.length);
  box.innerHTML = '';
  if (!pins.length) { box.appendChild(el('div', 'empty', t('noPins'))); return; }
  for (const m of pins) {
    const it = el('div', 'pin-item ' + m.role); it.innerHTML = `<span class="who">${m.role === 'user' ? '👤' : '🐋'}</span><span class="txt" dir="auto">${esc(String(m.content || '').replace(/\s+/g, ' ').slice(0, 220))}</span><button class="ib sm x" data-tip="${t('unpin')}">${ico('x')}</button>`;
    it.onclick = (e) => { if (e.target.closest('.x')) return; const n = $(`[data-mid="${m.id}"]`); if (n) { n.scrollIntoView({ block: 'center', behavior: 'smooth' }); n.style.outline = '2px solid var(--acc)'; setTimeout(() => (n.style.outline = ''), 1400); } };
    $('.x', it).onclick = (e) => { e.stopPropagation(); togglePinMsg(m); };
    box.appendChild(it);
  }
}
let notesTimer = null;
function refreshNotes() { const ta = $('#chat-notes'); if (!ta) return; ta.value = (S.chat && S.chat.notes) || ''; ta.disabled = !S.chat; $('#notes-state').textContent = ''; }
$('#chat-notes').oninput = () => { if (!S.chat) return; const v = $('#chat-notes').value; S.chat.notes = v; $('#notes-state').textContent = '…'; clearTimeout(notesTimer); notesTimer = setTimeout(async () => { await api('/api/chats/' + S.chat.id, { method: 'POST', body: { notes: v } }); $('#notes-state').textContent = t('saved'); setTimeout(() => ($('#notes-state').textContent = ''), 1500); }, 600); };
$$('#autonomy button').forEach((b) => (b.onclick = () => { S.autonomy = b.dataset.a; $$('#autonomy button').forEach((x) => x.classList.toggle('active', x === b)); api('/api/config', { method: 'POST', body: { autonomy: S.autonomy } }); toast(b.dataset.tip); }));
$('#attach-btn').onclick = () => $('#file-input').click();
const isImg = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name || '');
// pending attachments belong to the conversation they were added in — switching chats swaps the list
S._atts = {};
const attKey = () => (S.chat ? S.chat.id : '__draft__');
function swapAtts() { const k = attKey(); if (!S._atts[k]) S._atts[k] = []; S.attach = S._atts[k]; renderAttach(); }
async function addFiles(files) {
  for (const f of files) {
    if (f.size > 40e6) { toast(f.name + ': >40MB', 'err'); continue; }
    const name = f.name || (isImg(f) ? 'pasted-' + Date.now() + '.png' : 'pasted.txt');
    if (isImg(f)) {
      const a = { name, kind: 'image', url: URL.createObjectURL(f), uploading: true }; S.attach.push(a); renderAttach();
      try { const r = await fetch(authQs('/api/upload?name=' + encodeURIComponent(name)), { method: 'POST', body: f }); const j = await r.json(); if (j.error) throw new Error(j.error); a.path = j.path; a.analysis = j.analysis; a.uploading = false; if (!S._imgHintShown) { S._imgHintShown = true; if (!S.cfg?.visionOn) toast(t('imgHint')); } }
      catch (e) { toast(name + ': ' + e.message, 'err'); S.attach.splice(S.attach.indexOf(a), 1); }
      renderAttach();
    } else if (f.size > 2e6 || /\.(zip|exe|dll|mp4|mp3|mov|pdf|docx|xlsx|pptx|bin)$/i.test(name)) {
      // binary/big files go to the workspace so the agent can open them with its tools
      const a = { name, kind: 'file', uploading: true }; S.attach.push(a); renderAttach();
      try { const r = await fetch(authQs('/api/upload?name=' + encodeURIComponent(name)), { method: 'POST', body: f }); const j = await r.json(); if (j.error) throw new Error(j.error); a.path = j.path; a.uploading = false; a.text = j.text || ''; }
      catch (e) { toast(name + ': ' + e.message, 'err'); S.attach.splice(S.attach.indexOf(a), 1); }
      renderAttach();
    } else S.attach.push({ name, kind: 'text', text: await f.text() });
  }
  renderAttach();
}
$('#file-input').onchange = async () => { await addFiles($('#file-input').files); $('#file-input').value = ''; };
function renderAttach() {
  const box = $('#attach-list'); box.classList.toggle('hidden', !S.attach.length);
  box.innerHTML = S.attach.map((a, i) => a.kind === 'image' ? `<span class="imgchip ${a.uploading ? 'up' : ''}"><img src="${a.url}" alt=""><button data-i="${i}">${ico('x')}</button>${a.uploading ? '<span class="spinner"></span>' : ''}</span>` : `<span class="filechip">${ico('file')}${esc(a.name)}${a.uploading ? ' <span class="spinner"></span>' : ''} <button data-i="${i}">${ico('x')}</button></span>`).join('');
  $$('button', box).forEach((b) => (b.onclick = () => { S.attach.splice(+b.dataset.i, 1); renderAttach(); }));
}
// paste works everywhere: images/files from ANY focused section attach to the composer; text pasted outside an editable field goes into the composer instead of vanishing
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); return; }
  const tgt = e.target;
  const editable = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
  if (!editable) { const txt = e.clipboardData?.getData('text'); if (txt) { e.preventDefault(); const i = $('#input'); i.value += txt; autosize(); i.focus(); toast(({ fa: 'پیست در composer قرار گرفت', ru: 'Вставлено в composer', zh: '已粘贴到输入框' })[lang] || 'Pasted into the composer', 'ok'); } }
});
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); addFiles(e.dataTransfer?.files || []); });

// While the agent is busy in this chat, new messages queue up (shown above the composer) and go out when it finishes.
S.queue = [];
function renderQueue() {
  let box = $('#queue-list'); if (!box) { box = el('div', 'queue-list'); box.id = 'queue-list'; $('#composer-wrap').insertBefore(box, $('#composer')); }
  box.innerHTML = ''; box.classList.toggle('hidden', !S.queue.length);
  S.queue.forEach((q, i) => { const it = el('div', 'queued', `${ico('clock')}<span dir="auto">${esc(q.text.slice(0, 140))}</span><button class="qx" data-tip="${t('remove')}">${ico('x')}</button>`); $('.qx', it).onclick = () => { S.queue.splice(i, 1); renderQueue(); }; box.appendChild(it); });
}
function flushQueue() { if (!S.queue.length || runningHere()) return; const q = S.queue.shift(); renderQueue(); send(q.text); }
async function send(textOverride, regenerateFrom) {
  let text = textOverride ?? $('#input').value.trim();
  if (!text && !S.attach.length) return;
  if (runningHere()) {
    if (textOverride != null || regenerateFrom || S.attach.length) return toast(t('running'), 'err');
    S.queue.push({ text }); renderQueue(); $('#input').value = ''; autosize(); toast(t('queued'), 'ok'); return;
  }
  if (S.attach.some((a) => a.uploading)) return toast(t('uploading'));
  // local slash commands
  const sc = text.match(/^\/(plan|model|export|clear|files|new|help)\b\s*(.*)$/i);
  if (sc && textOverride == null) { $('#input').value = ''; autosize(); const c = sc[1].toLowerCase(); if (c === 'help') showHelp(sc[2].trim() === 'commands' ? 'cmds' : undefined); else if (c === 'plan') $('#plan-toggle').click(); else if (c === 'model') { const k = sc[2].trim().toLowerCase(); const m = S.cfg.models.find((x) => x.key === k || x.label.toLowerCase().includes(k)); if (m) { buildPicker($('#pick-single'), m.key, (v) => api('/api/config', { method: 'POST', body: { defaultModel: v } })); api('/api/config', { method: 'POST', body: { defaultModel: m.key } }); toast(m.label, 'ok'); } else toast(S.cfg.models.map((x) => x.key).join(', ')); } else if (c === 'export') { if (S.chat) { const r = await fetch('/api/chats/' + S.chat.id + '/export', { headers: authHdr() }); dl('orca-chat.md', await r.text()); } } else if (c === 'clear' || c === 'new') newChat(); else if (c === 'files') { openPanel(); showTab('files'); } return; }
  const files = S.attach.filter((a) => a.kind !== 'image').map((a) => a.name);
  const images = S.attach.filter((a) => a.kind === 'image' && a.path).map((a) => ({ path: a.path, url: a.url }));
  if (S.attach.length) {
    const parts = S.attach.filter((a) => a.kind !== 'image').map((a) => a.kind === 'file' && a.path ? `<attached_file name="${a.name}" path="${a.path}">\n${a.text ? a.text.slice(0, 60000) : '(binary file saved in the workspace at ' + a.path + ' — open it with the right tool)'}\n</attached_file>` : `<attached_file name="${a.name}">\n${(a.text || '').slice(0, 60000)}\n</attached_file>`);
    if (parts.length) text += '\n\n' + parts.join('\n');
    S.attach = []; renderAttach();
  }
  regenerateFrom = regenerateFrom || S.regenFrom; S.regenFrom = null;
  if (S.planMode && text.length < 60 && /^(بله|آره|اره|باشه|اوکی|ok|okay|yes|y|go|do it|execute|run|proceed|اجرا)/i.test(text)) { S.planMode = false; $('#plan-toggle').classList.remove('active'); }
  if (!S.chat) S.chat = await api('/api/chats', { method: 'POST', body: { mode: S.mode } });
  if (textOverride == null) { $('#input').value = ''; autosize(); }
  $('#welcome').classList.add('hidden');
  const box = $('#messages');
  if (regenerateFrom) { let n = $(`[data-mid="${regenerateFrom}"]`); while (n) { const nx = n.nextElementSibling; n.remove(); n = nx; } }
  box.appendChild(renderUser({ id: 'tmp-' + Date.now(), content: text, files, images: images.map((i) => i.path) }));
  setBusy(true); $('#status-text').textContent = '…'; S.stepCount = 0; $('#status-steps').textContent = ''; $('#thread').scrollTop = 1e9;
  const body = { chatId: S.chat.id, text, mode: S.mode, model: $('#pick-single').value, models: [$('#pick-a').value, $('#pick-b').value], planMode: S.planMode, autonomy: S.autonomy, regenerateFrom, lang, images: images.map((i) => i.path), webMode: S.webMode };
  let r; try { r = await api('/api/send', { method: 'POST', body }); } catch (e) { r = { error: t('netErr') }; }
  if (r.error) { setBusy(false); const tmp = $('#messages').lastElementChild; if (tmp && tmp.dataset.mid?.startsWith('tmp-')) tmp.remove(); if (textOverride == null) { $('#input').value = text; autosize(); } return toast(r.error, 'err'); }
  if (r.local) { setBusy(false); S.chat = await api('/api/chats/' + S.chat.id); openChat(S.chat.id); loadChats(); return; }
  const wrap = el('div', 'msg assistant'); const lanes = el('div', 'lanes' + (r.lanes.length === 2 ? ' two' : '')); wrap.appendChild(lanes); box.appendChild(wrap);
  const anon = S.mode === 'battle';
  r.lanes.forEach((ln, i) => {
    const m = { id: ln.msgId, lane: r.lanes.length === 2 ? (i === 0 ? 'a' : 'b') : '', model: anon ? '' : (modelOf(r.models[i])?.label || r.models[i]), modelKey: anon ? '' : r.models[i], runId: ln.runId.split(':')[0], events: [], status: 'running' };
    const l = laneEl(m, anon, i); l.classList.add('streaming'); $('.content', l).classList.add('streaming'); lanes.appendChild(l);
    S.lanes.set(ln.runId, { el: l, m, content: '', reasoning: '', steps: {}, wrap, group: { ...r, chatId: S.chat.id }, anon, t0: Date.now(), runId: ln.runId });
    S.running.set(ln.runId, true);
  });
  $('#thread').scrollTop = 1e9;
  loadChats();
}
function setBusy(b) { $('#status-line').classList.toggle('hidden', !b); $('#tb-status').className = 'dot ' + (b ? 'busy' : 'on'); const sb = $('#send'); sb.classList.toggle('stop', b); sb.innerHTML = ico(b ? 'stop' : 'send'); sb.dataset.tip = b ? t('stop') : 'Send'; }
async function stopAll() { const ids = [...S.lanes.values()].filter((L) => L.group?.chatId === S.chat?.id).map((L) => L.runId).filter((id) => S.running.has(id)); if (!ids.length) return; await api('/api/stop', { method: 'POST', body: { runIds: ids } }); }

// ───────────────────────── SSE ─────────────────────────
function connect() {
  const es = new EventSource(authQs('/api/events'));
  es.onmessage = (e) => { let p; try { p = JSON.parse(e.data); } catch (_) { return; } handle(p); };
  es.onerror = () => { $('#tb-status').className = 'dot'; };
  es.onopen = () => { $('#tb-status').className = S.running.size ? 'dot busy' : 'dot on'; };
}
const thread = $('#thread');
const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 220;
thread.addEventListener('scroll', () => { $('#jump-bottom').classList.toggle('hidden', nearBottom()); }, { passive: true });
$('#jump-bottom').onclick = () => { thread.scrollTo({ top: 1e9, behavior: 'smooth' }); };
let renderTimer = null; const dirty = new Set();
function scheduleRender(L) { dirty.add(L); if (renderTimer) return; const longest = Math.max(...[...dirty].map((x) => x.content.length)); const every = longest > 40000 ? 400 : longest > 12000 ? 200 : longest > 4000 ? 120 : 70; renderTimer = setTimeout(() => { renderTimer = null; const stick = nearBottom(); for (const L of dirty) { const c = $('.content', L.el); c.innerHTML = md(L.content, true); c.dir = detectDir(L.content); if (L.reasoning) { const th = $('.thought', L.el); th.classList.remove('hidden'); th.classList.add('live'); if (P.showReasoning && !th.dataset.touched) th.open = true; const b = $('.th-body', th); b.textContent = L.reasoning; b.scrollTop = 1e9; $('.th-time', th).textContent = ((Date.now() - L.t0) / 1000).toFixed(0) + 's'; } } dirty.clear(); if (stick) thread.scrollTop = 1e9; }, every); }
document.addEventListener('toggle', (e) => { if (e.target.classList?.contains('thought')) e.target.dataset.touched = '1'; }, true);

const fmtMB = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(b >= 104857600 ? 0 : 1) + ' MB');
const fmtEta = (s) => (s == null ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
// One state object for the banner and Settings → Updates: { available, latest, version, notes, url, asset, kind, inApp, download:{…}, install:{…}, lastInstall, error }
const updActions = {
  download: () => { api('/api/update/download', { method: 'POST' }); updBanner({ install: {}, download: { active: true, pct: 0, bytes: 0, phase: 'download' } }); },
  cancel: () => api('/api/update/cancel', { method: 'POST' }),
  retry: () => { updBanner({ install: {}, download: { active: true, pct: 0, bytes: 0, error: '', phase: 'download' } }); api('/api/update/download', { method: 'POST' }); },
  apply: async () => {
    updBanner({ install: { active: true, phase: 'verify' } });
    const r = await api('/api/update/apply', { method: 'POST' });
    if (r.error) { updBanner({ install: { active: false, phase: 'error', error: r.error } }); toast(r.error, 'err'); }
    else if (r.manual) { updBanner({ install: { active: false, phase: 'manual', note: r.note } }); toast(r.note || tu('manualNote'), 'ok'); }
    else updBanner({ install: { active: false, phase: 'restarting' } });
  },
  later: () => { const bar = $('#upd-bar'); if (bar) bar.remove(); S.upd.dismissed = S.upd.latest; api('/api/update/dismiss', { method: 'POST', body: { version: S.upd.latest } }); },
};
function updPhaseText(u) { // shared by banner + settings: what is happening right now, one line
  const d = u.download || {}, i = u.install || {};
  if (i.phase === 'restarting') return { k: 'restarting', text: tu('restarting'), busy: true };
  if (i.active) return { k: 'installing', text: /^extract/.test(i.phase) ? `${tu('installing')} ${i.phase.replace('extract', '').trim()}` : tu('installing'), busy: true };
  if (i.phase === 'error') return { k: 'error', text: `${tu('installFailed')}: ${i.error || ''}` };
  if (i.phase === 'manual') return { k: 'manual', text: i.note || tu('manualNote') };
  if (d.ready) return { k: 'ready', text: tu('ready') + (d.verified ? ' · ' + tu('verified') : '') };
  if (d.active && d.phase === 'verify') return { k: 'verify', text: tu('verifying'), busy: true };
  if (d.active) return { k: 'downloading', text: `${tu('downloading')}${d.total ? ` ${fmtMB(d.bytes || 0)} / ${fmtMB(d.total)}` : ''}${d.speed ? ` · ${fmtMB(d.speed)}/s` : ''}${d.eta != null && d.eta > 0 ? ` · ${fmtEta(d.eta)}` : ''}${d.mirror ? ' · ' + tu('viaMirror') : ''}`, busy: true, pct: d.pct || 0 };
  if (d.error) return { k: 'dlError', text: `${tu('dlFailed')}: ${d.error}` };
  if (u.available) return { k: 'available', text: tu('available')(u.latest) };
  return { k: 'none', text: u.error ? `${tu('error')}: ${u.error}` : tu('upToDate') };
}
function updBanner(d) {
  if (d && d.download && !d.install && S.upd && S.upd.install && (d.download.active || d.download.error) && !S.upd.install.active) d = { ...d, install: {} };
  S.upd = { ...(S.upd || {}), ...d };
  const u = S.upd; let bar = $('#upd-bar');
  if (!u.available && !(u.download && (u.download.active || u.download.ready)) && !(u.install && u.install.active)) { if (bar) bar.remove(); paintUpdSettings(u); return; }
  if (u.dismissed === u.latest && !u.mustUpdate && !(u.install && u.install.active)) { paintUpdSettings(u); return; } // "Later" hides it for this session; a downloaded package is offered again on the next start
  if (!bar) { bar = el('div', 'upd-bar'); bar.id = 'upd-bar'; $('#main').prepend(bar); }
  bar.classList.toggle('must', !!u.mustUpdate);
  const ph = updPhaseText(u); const ver = u.latest ? `<span class="pill acc">${esc(u.latest)}</span>` : '';
  let mid = '';
  const inApp = u.inApp !== false && u.kind !== 'dev';
  const notesBtn = u.notes ? `<button class="btn" id="ub-notes">${tu('notes')}</button>` : (u.url ? `<a class="btn" href="${esc(u.url)}" target="_blank" rel="noopener">${tu('notes')}</a>` : '');
  if (ph.k === 'restarting') mid = `<b>${esc(ph.text)}</b><span class="sp"></span><span class="spin"></span>`;
  else if (ph.k === 'installing' || ph.k === 'verify') mid = `<b>${esc(ph.text)}</b><progress></progress><span class="sp"></span>`;
  else if (ph.k === 'ready') mid = `<b>${esc(ph.text)}</b>${ver}<span class="sp"></span><button class="btn btn-primary" id="ub-apply">${ico('rocket')}${inApp ? tu('restart') : tu('install')}</button>${notesBtn}${u.mustUpdate ? '' : `<button class="btn" id="ub-later">${tu('later')}</button>`}`;
  else if (ph.k === 'downloading') mid = `<span>${esc(ph.text)}</span><progress max="100" value="${ph.pct}"></progress><span class="mono small">${ph.pct}%</span><span class="sp"></span><button class="btn" id="ub-cancel">${tu('cancel')}</button>`;
  else if (ph.k === 'dlError' || ph.k === 'error') mid = `<b>${esc(ph.text)}</b><span class="sp"></span><button class="btn btn-primary" id="ub-retry">${tu('retry')}</button><a class="btn" href="${esc(u.url || '#')}" target="_blank" rel="noopener">${tu('manual')}</a><button class="btn" id="ub-later">${tu('later')}</button>`;
  else if (ph.k === 'manual') mid = `<b>${tu('ready')}</b><span class="small">${esc(ph.text)}</span><span class="sp"></span><button class="btn" id="ub-later">${tu('later')}</button>`;
  else mid = `<b>${tu('available')(u.latest)}</b>${u.mustUpdate ? `<span>${tu('must')}</span>` : `<span class="small">${esc(!u.asset ? tu('noAsset') : inApp ? tu('oneClick') : tu('devHint'))}</span>`}<span class="sp"></span>${u.asset ? `<button class="btn btn-primary" id="ub-dl">${ico('download')}${inApp ? tu('updateNow') : tu('download')}</button>` : `<a class="btn btn-primary" href="${esc(u.url || '#')}" target="_blank" rel="noopener">${tu('manual')}</a>`}${notesBtn}${u.mustUpdate ? '' : `<button class="btn" id="ub-later">${tu('later')}</button>`}`;
  bar.innerHTML = `<span class="upd-ico${ph.busy ? ' busy' : ''}">${ico('update')}</span>${mid}<button class="ib sm upd-x" id="ub-x" data-tip="${esc(tu('later'))}">${ico('x')}</button>`;
  if ($('#ub-x')) $('#ub-x').onclick = () => { bar.remove(); S.upd.dismissed = u.latest; if (!u.mustUpdate) api('/api/update/dismiss', { method: 'POST', body: { version: u.latest } }); };
  if ($('#ub-dl')) $('#ub-dl').onclick = updActions.download;
  if ($('#ub-cancel')) $('#ub-cancel').onclick = updActions.cancel;
  if ($('#ub-retry')) $('#ub-retry').onclick = updActions.retry;
  if ($('#ub-apply')) $('#ub-apply').onclick = updActions.apply;
  if ($('#ub-later')) $('#ub-later').onclick = updActions.later;
  if ($('#ub-notes')) $('#ub-notes').onclick = () => openSettings('updates');
  paintUpdSettings(u);
}
// Settings → Updates page (only when it is open): same state, more detail
function paintUpdSettings(u) {
  if (!u || !$('#upd-msg')) return;
  const ph = updPhaseText(u); const d = u.download || {};
  const latest = $('#upd-latest'); if (latest) { latest.innerHTML = `${tu('latest')}: <b>${esc(u.latest || '—')}</b>`; latest.className = 'pill ' + (u.available ? 'acc' : u.latest ? 'ok' : ''); }
  const ch = $('#upd-channel'); if (ch) ch.textContent = `${u.channel || 'stable'} · ${u.kind === 'dev' ? tu('devBuild') : u.kind === 'win-portable' ? 'Windows' : u.kind === 'mac-app' ? 'macOS' : u.kind === 'linux-appimage' ? 'Linux AppImage' : u.kind === 'linux-dir' ? 'Linux' : ''}${u.asset && u.asset.size ? ` · ${fmtMB(u.asset.size)}` : ''}`;
  const msg = $('#upd-msg'); if (msg) { msg.textContent = ph.text; msg.className = 'small' + (ph.k === 'error' || ph.k === 'dlError' ? ' err' : ph.k === 'ready' ? ' ok' : ''); }
  const prog = $('#upd-prog'); if (prog) { prog.classList.toggle('hidden', !(ph.k === 'downloading' || ph.busy)); if (ph.k === 'downloading') { prog.max = 100; prog.value = ph.pct; } else { prog.removeAttribute('value'); } }
  const show = (id, on) => { const b = $('#' + id); if (b) b.classList.toggle('hidden', !on); };
  show('upd-check', !ph.busy); show('upd-dl', ph.k === 'available'); show('upd-cancel', ph.k === 'downloading'); show('upd-retry', ph.k === 'dlError' || ph.k === 'error'); show('upd-apply', ph.k === 'ready');
  const ap = $('#upd-apply'); if (ap) ap.innerHTML = `${ico('rocket')}${u.inApp !== false && u.kind !== 'dev' ? tu('restart') : tu('install')}`;
  const notes = $('#upd-notes'); if (notes) { notes.classList.toggle('hidden', !(u.available && u.notes)); if (u.available && u.notes) notes.innerHTML = `<div class="upd-notes-h">${tu('notes')} · ${esc(u.latest || '')}</div>` + md(u.notes); }
  const li = $('#upd-last'); if (li) { const L = u.lastInstall; li.classList.toggle('hidden', !L); if (L) li.innerHTML = L.ok ? `${ico('check')} ${esc(tu('installedOk')(L.version))}` : `${ico('x')} ${esc(tu('installedFail')(L.version))}${L.note ? ` — ${esc(L.note)}` : ''}`; li.className = 'small ' + (L && L.ok ? 'ok' : 'err'); }
  { const de = $('#cloud-dot2'), se = $('#cloud-state2'); if (de && se) { const g = u.vault || {}; de.className = 'cloud-dot ' + (g.ok ? 'on' : g.enabled ? 'off' : ''); se.textContent = !g.enabled ? tu('cloudOff') : g.ok ? `${tu('cloudOk')} · ${(g.aliases || []).length} ${ts('modelsN')}` : `${tu('cloudDown')}${g.error ? ' (' + g.error + ')' : ''}`; } }
}
function handle(p) {
  if (p.event === 'update') { updBanner(p.data || {}); return; }
  if (p.event === 'proc') { onProc(p.data || {}); return; }
  if (p.event === 'title') { if (S.chat && S.chat.id === p.chatId) { S.chat.title = p.data.title; $('#tb-title').textContent = p.data.title; } loadChats(); return; }
  const L = S.lanes.get(p.runId);
  if (!L) return;
  const d = p.data;
  switch (p.event) {
    case 'status': $('#status-text').textContent = (L.m.lane ? L.m.lane.toUpperCase() + ' · ' : '') + d.text; if (d.step) $('#status-steps').textContent = `#${d.step}`; if (d.kind === 'fallback') toast(d.text); break;
    case 'delta':
      if (d.type === 'reset') { L.content = ''; L.reasoning = ''; }
      else if (d.type === 'content') L.content += d.text; else if (d.type === 'reasoning') L.reasoning += d.text;
      scheduleRender(L); break;
    case 'thought_done': { L.reasoning = d.text; const th = $('.thought', L.el); th.classList.remove('hidden', 'live'); th.open = false; $('.th-body', th).textContent = d.text; break; }
    case 'tool_call': { L.steps[d.id] = addStep($('.steps', L.el), d); L.content = ''; $('.content', L.el).innerHTML = ''; const th = $('.thought', L.el); th.classList.remove('live'); th.open = false; addTimeline(d, L); S.stepCount++; if (nearBottom()) thread.scrollTop = 1e9; break; }
    case 'tool_result': { if (L.steps[d.id]) finishStep(L.steps[d.id], d); markTimeline(d); maybeAutoPreview(d); if (!d.ok && /PLAN MODE/.test(d.result || '') && !S._planHint) { S._planHint = true; toast(({ fa: 'حالت نقشه فعال است: فقط برنامه ارائه می‌شود. برای ساختن، دکمهٔ «نقشه» را خاموش کنید یا «اجرا کن» بگویید.', ru: 'Режим плана включён: создаётся только план. Выключите «План» или скажите «выполни».', zh: '计划模式已开启：只生成计划。关闭“计划”或说“执行”。' })[lang] || 'Plan mode is on: only a plan is produced. Turn off “Plan” or say “execute”.'); } break; }
    case 'approval': showApproval(L, p.runId, d); break;
    case 'checkpoint': addChange(d); break;
    case 'question': showQuestion(L.el, d); break;
    case 'usage': { const u = $('.usage', L.el); u.textContent = `${fmtN(d.prompt_tokens)}↑ ${fmtN(d.completion_tokens)}↓${d.estimated ? '~' : ''}${L.t0 ? ' · ' + fmtDur(Date.now() - L.t0) : ''}`; u.title = `${(d.prompt_tokens || 0).toLocaleString()} input · ${(d.completion_tokens || 0).toLocaleString()} output tokens this turn`; break; }
    case 'todos': renderTodos(L.el, d.todos); if (nearBottom()) thread.scrollTop = 1e9; break;
    case 'files': L.outs = [...(L.outs || []), ...(d.files || [])]; renderOutputs(L.el, L.outs); break;
    case 'sub_event': addSubEvent(L.el, d); break;
    case 'compacted': toast(t('compacted'), 'ok'); break;
    case 'final': { L.content = d.text; const c = $('.content', L.el); c.innerHTML = md(d.text); c.dir = detectDir(d.text); c.classList.remove('streaming'); L.el.classList.remove('streaming'); collapseLong(c, d.text); const th = $('.thought', L.el); th.classList.remove('live'); th.open = false; if (!L.anon) $('.mname', L.el).innerHTML = `${brandMark(modelOf(d.model) || { label: d.model })}${esc(d.model)}`; L.m.status = d.question ? 'question' : 'done'; L.m.model = d.model; if (PLAN_RE.test(d.text)) addPlanActions(L.el); $('.meta', L.el).textContent = ((Date.now() - L.t0) / 1000).toFixed(1) + 's'; break; }
    case 'error': { L.el.classList.add('error'); L.m.status = 'error'; L.m.error = d.text; L.m.content = L.content; if (/429|503|busy|concurrency|rate/i.test(d.text)) toast(t('allBusy'), 'err'); addInterruptedActions(L.el, L.m); break; }
    case 'stopped': { $('.meta', L.el).textContent = t('stopped'); L.m.status = 'stopped'; L.m.content = L.content; addInterruptedActions(L.el, L.m); break; }
    case 'done': {
      $('.content', L.el).classList.remove('streaming'); L.el.classList.remove('streaming');
      S.running.delete(p.runId);
      const here = L.group?.chatId === S.chat?.id;
      if (!runningHere()) setBusy(false);
      if (here) { if (![...L.group.lanes].some((ln) => S.running.has(ln.runId))) finishGroup(L); }
      else { for (const ln of L.group.lanes) S.lanes.delete(ln.runId); loadChats(); if (P.notifications && window.Notification && Notification.permission === 'granted') new Notification('ORCA', { body: t('doneInOtherChat') }); else toast(t('doneInOtherChat'), 'ok'); }
      break;
    }
  }
}
async function finishGroup(L) {
  S.allowAll = false;
  S.chat = await api('/api/chats/' + S.chat.id);
  const g = L.group;
  const fresh = S.chat.messages.filter((m) => g.lanes.some((ln) => ln.msgId === m.id));
  if (fresh.length) { const stick = nearBottom(); L.wrap.replaceWith(renderGroup(fresh, S.chat)); if (stick) thread.scrollTop = 1e9; }
  for (const ln of g.lanes) S.lanes.delete(ln.runId);
  loadChats(); refreshChanges(); if ($('#tab-files').classList.contains('active')) loadFiles();
  if (P.sound) beep();
  setTimeout(flushQueue, 50);
  if (P.notifications && document.hidden && window.Notification && Notification.permission === 'granted') new Notification('ORCA', { body: (fresh[0]?.content || '').slice(0, 120), icon: '/assets/icon512.png' });
}
function beep() { try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(); const g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = 880; g.gain.setValueAtTime(.08, ac.currentTime); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + .25); o.start(); o.stop(ac.currentTime + .25); } catch (_) {} }
function showApproval(L, runId, d) {
  if (S.allowAll) { api('/api/approve', { method: 'POST', body: { runId, callId: d.id, decision: 'allow' } }); return; }
  const a = el('div', 'approval ' + d.risk);
  const cmd = (d.name === 'run_shell' ? d.args.command : JSON.stringify(d.args, null, 2)) + (d.judged ? `\n\n⚠ decision engine: ${Math.round(d.judged * 100)}% destructive` : '');
  const shellCmd = d.name === 'run_shell' || d.name === 'start_process';
  a.innerHTML = `<div class="ap-head">${ico('shield')}<span>${t('approveQ')}</span><span class="pill ${d.risk === 'high' ? 'bad' : 'warn'}">${t('risk')[d.risk] || d.risk}</span><code class="mono">${esc(d.name)}</code></div><div class="ap-cmd">${esc(cmd)}</div><div class="ap-btns"><button class="btn primary sm allow">${ico('check')}${t('allow')}</button>${shellCmd ? `<button class="btn sm session">${ico('check')}${t('allowSession')}</button>` : ''}<button class="btn sm all">${t('allowAll')}</button><button class="btn sm danger deny">${ico('x')}${t('deny')}</button></div>`;
  const decide = (dec) => { api('/api/approve', { method: 'POST', body: { runId, callId: d.id, decision: dec } }); a.remove(); };
  $('.allow', a).onclick = () => decide('allow'); const sb = $('.session', a); if (sb) sb.onclick = () => decide('allow-session'); $('.all', a).onclick = () => { S.allowAll = true; decide('allow'); }; $('.deny', a).onclick = () => decide('deny:user declined');
  $('.extra', L.el).appendChild(a); thread.scrollTop = 1e9;
  if (P.notifications && window.Notification && Notification.permission === 'granted' && document.hidden) new Notification('ORCA', { body: t('approveQ') + ' ' + d.name, icon: '/assets/icon512.png' });
}

// ───────────────────────── right panel ─────────────────────────
const openPanel = () => { $('#panel').classList.remove('collapsed'); $('#toggle-panel').classList.add('active'); localStorage.setItem('orca.panel', '1'); };
const togglePanel = () => { const c = $('#panel').classList.toggle('collapsed'); $('#toggle-panel').classList.toggle('active', !c); localStorage.setItem('orca.panel', c ? '0' : '1'); };
$('#toggle-panel').onclick = togglePanel;
if ($('#open-help')) $('#open-help').onclick = () => showHelp();
if (localStorage.getItem('orca.panel') === '1') openPanel();
function showTab(name) { $$('.panel-tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name)); $$('.panel-tabs button.active').forEach((x) => x.scrollIntoView({ inline: 'nearest', block: 'nearest' })); $$('.tab').forEach((x) => x.classList.toggle('active', x.id === 'tab-' + name)); if (name === 'files') loadFiles(); if (name === 'procs') loadProcs(); if (name === 'changes') { refreshChanges(); $('#chg-badge').classList.add('hidden'); } }
$$('.panel-tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
const fmtT = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function tlItem(d, ts, onClick) { const it = el('div', 'tl-item'); it.dataset.cid = d.id; it.innerHTML = `<span class="t">${fmtT(ts)}</span>${ico(TOOL_ICO[d.name] || 'terminal')}<span class="n">${esc(d.name)}</span><span class="a">${esc(argOf(d) || '')}</span>`; it.onclick = onClick; return it; }
function addTimeline(d, L) { const box = $('#tab-timeline'); if ($('.empty', box)) box.innerHTML = ''; box.appendChild(tlItem(d, Date.now(), () => { const s = L.steps[d.id]; if (s) { s.closest('.steps')?.classList.remove('collapsed'); s.classList.add('open'); s.scrollIntoView({ block: 'center' }); } })); box.scrollTop = 1e9; }
function markTimeline(d) { const it = $(`.tl-item[data-cid="${d.id}"]`); if (it) it.classList.add(d.ok ? 'ok' : 'fail'); }
function refreshTimeline() { const box = $('#tab-timeline'); box.innerHTML = ''; if (!S.chat) return; for (const m of S.chat.messages) for (const e of m.events || []) if (e.event === 'tool_call') { const it = tlItem(e.data, e.ts, () => { const s = $(`.step[data-cid="${e.data.id}"]`); if (s) { s.closest('.steps')?.classList.remove('collapsed'); s.classList.add('open'); s.scrollIntoView({ block: 'center' }); } }); const r = (m.events || []).find((x) => x.event === 'tool_result' && x.data.id === e.data.id); if (r) it.classList.add(r.data.ok ? 'ok' : 'fail'); box.appendChild(it); } if (!box.children.length) box.innerHTML = `<div class="empty">${t('emptyTimeline')}</div>`; }

async function loadFiles() {
  const r = await api('/api/workspace/files'); const box = $('#file-tree'); box.className = 'ft'; box.innerHTML = '';
  for (const e of r.entries || []) {
    const isDir = e.endsWith('/'); const name = e.replace(/ \(\d+B\)$/, ''); const size = (e.match(/\((\d+)B\)$/) || [])[1];
    const depth = (name.replace(/\/$/, '').match(/\//g) || []).length;
    const d = el('div', 'row' + (isDir ? ' dir' : '')); d.style.paddingLeft = 6 + depth * 14 + 'px';
    d.innerHTML = `${ico(isDir ? 'folder' : 'file')}<span>${esc(name.replace(/\/$/, '').split('/').pop())}</span>${size ? `<span class="sz">${fmtB(+size)}</span>` : ''}`;
    if (!isDir) d.onclick = () => previewFile(name);
    box.appendChild(d);
  }
  if (!(r.entries || []).length) box.innerHTML = `<div class="empty">${esc(t('emptyFiles'))}</div>`;
}
const fmtDur = (ms) => (ms < 1000 ? '<1s' : ms < 60000 ? Math.round(ms / 1000) + 's' : Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's');
const fmtB = (n) => (n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(1) + 'K' : (n / 1048576).toFixed(1) + 'M');
$('#refresh-files').onclick = loadFiles;
$('#open-ws').onclick = () => desktop ? desktop.openPath(S.cfg.workspaceDir) : toast(S.cfg.workspaceDir);
const wsUrl = (p) => '/ws/' + p.split('/').map(encodeURIComponent).join('/');
async function previewFile(p) {
  showTab('preview');
  const nameEl = $('#preview-name'); nameEl.textContent = p; const body = $('#preview-body'); body.innerHTML = ''; $('#preview-save').classList.add('hidden'); $('#preview-actions').innerHTML = '';
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(p)) { const im = el('img'); im.src = wsUrl(p) + '?t=' + Date.now(); body.appendChild(im); return; }
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(p)) { const v = el('video'); v.controls = true; v.src = wsUrl(p) + '?t=' + Date.now(); v.style.cssText = 'width:100%;max-height:100%;background:#000;border-radius:10px'; body.appendChild(v); return; }
  if (/\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i.test(p)) { const a = el('audio'); a.controls = true; a.src = wsUrl(p) + '?t=' + Date.now(); a.style.width = '100%'; body.appendChild(a); return; }
  if (/\.(docx|xlsx|pptx|pdf)$/i.test(p)) {
    const kind = p.split('.').pop().toLowerCase();
    body.innerHTML = `<div class="empty">…</div>`;
    const r = await api('/api/workspace/office?path=' + encodeURIComponent(p));
    body.innerHTML = '';
    if (r.error) { body.textContent = r.error; return; }
    const d = el('div', 'md content'); d.dir = detectDir(r.markdown || r.text || '');
    d.innerHTML = md(r.markdown || ('```\n' + (r.text || '') + '\n```'));
    body.appendChild(d);
    const o = el('button', 'ib sm', ico('external')); o.dataset.tip = desktop ? 'Open in ' + { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', pdf: 'PDF viewer' }[kind] : t('download'); o.onclick = () => desktop ? desktop.openPath(S.cfg.workspaceDir + '/' + p) : window.open(wsUrl(p), '_blank'); $('#preview-actions').append(o);
    return;
  }
  const r = await api('/api/workspace/file?path=' + encodeURIComponent(p));
  if (r.error) { body.textContent = r.error; return; }
  const acts = $('#preview-actions');
  if (/\.html?$/i.test(p)) { livePreview(p, r.content); return; }
  if (/\.md$/i.test(p)) { const d = el('div', 'md content'); d.innerHTML = md(r.content); d.dir = detectDir(r.content); body.appendChild(d); const b = el('button', 'ib sm', ico('edit')); b.onclick = () => editFile(p, r.content); acts.append(b); return; }
  editFile(p, r.content);
}
// ── Processes panel: bots / dev servers the agent started with start_process (live status, log, Stop) ──
const PROCS = { list: [], open: new Set() };
const procState = (p) => ({ running: t('procRunning'), exited: t('procExited'), failed: t('procFailed'), stopped: t('procStopped') })[p.status] || p.status;
function renderProcs() {
  const box = $('#procs-list'); if (!box) return;
  const live = PROCS.list.filter((p) => p.status === 'running').length;
  const badge = $('#proc-badge'); if (badge) { badge.textContent = live; badge.classList.toggle('hidden', !live); }
  if (!PROCS.list.length) { box.innerHTML = `<div class="empty">${t('noProcs')}</div>`; return; }
  box.innerHTML = PROCS.list.map((p) => `<div class="proc ${p.status} ${PROCS.open.has(p.id) ? 'open' : ''}" data-id="${esc(p.id)}">
    <div class="proc-head"><span class="proc-dot"></span><b dir="auto">${esc(p.name)}</b><span class="proc-st">${esc(procState(p))}${p.status !== 'running' && p.code != null ? ' · ' + p.code : ''}</span><span class="grow"></span>${p.status === 'running' ? `<span class="small mono">${fmtDur(p.uptimeMs || 0)}</span>` : ''}${(p.ports || []).map((x) => `<a class="btn sm proc-url" href="http://localhost:${x}" target="_blank" rel="noopener" dir="ltr">${ico('external')}:${x}</a>`).join('')}<button class="btn sm proc-log">${ico('terminal')}${t('procLog')}</button>${p.status === 'running' ? `<button class="btn sm danger proc-stop">${ico('stop')}${t('procStop')}</button>` : ''}</div>
    <div class="proc-cmd mono" dir="ltr">${esc(p.command)}</div>
    <pre class="proc-out mono" dir="ltr"></pre></div>`).join('');
  $$('#procs-list .proc-stop').forEach((b) => (b.onclick = async () => { b.disabled = true; await api('/api/procs/' + b.closest('.proc').dataset.id + '/stop', { method: 'POST' }); setTimeout(loadProcs, 600); }));
  $$('#procs-list .proc-log').forEach((b) => (b.onclick = async () => { const card = b.closest('.proc'); const id = card.dataset.id; if (PROCS.open.has(id)) { PROCS.open.delete(id); card.classList.remove('open'); return; } PROCS.open.add(id); card.classList.add('open'); await fillProcLog(card); }));
  $$('#procs-list .proc-url').forEach((a) => (a.onclick = (e) => { if (desktop) { e.preventDefault(); desktop.openExternal(a.href); } }));
  for (const id of PROCS.open) { const card = $(`#procs-list .proc[data-id="${id}"]`); if (card) fillProcLog(card); }
}
async function fillProcLog(card) { const r = await api('/api/procs/' + card.dataset.id); const pre = $('.proc-out', card); if (pre) { pre.textContent = (r.log || '').slice(-12000) || '—'; pre.scrollTop = 1e9; } }
async function loadProcs() { try { const r = await api('/api/procs'); PROCS.list = r.processes || []; } catch (_) {} renderProcs(); }
function onProc(p) {
  const i = PROCS.list.findIndex((x) => x.id === p.id); const prev = i >= 0 ? PROCS.list[i] : null;
  if (i >= 0) PROCS.list[i] = p; else PROCS.list.unshift(p);
  if (!prev && p.status === 'running') { toast(t('procStarted')(p.name), 'ok'); openPanel(); showTab('procs'); }
  else if (prev && prev.status === 'running' && p.status === 'failed') toast(t('procCrashed')(p.name), 'err');
  renderProcs();
}
if ($('#procs-refresh')) $('#procs-refresh').onclick = loadProcs;
setInterval(() => { if ($('#tab-procs')?.classList.contains('active') && PROCS.list.some((p) => p.status === 'running')) loadProcs(); }, 5000);
// ── Live site preview (runs the page inside the app; phone / tablet / desktop / full-window) ──
const DEVICES = { phone: { w: 390, h: 844, ico: 'phone' }, tablet: { w: 820, h: 1180, ico: 'tablet' }, desktop: { w: 0, h: 0, ico: 'desktop' } };
const PV = { device: localStorage.getItem('orca.pv.device') || 'desktop', full: false, path: '', src: '' };
function livePreview(p, content) {
  const body = $('#preview-body'); body.innerHTML = ''; const acts = $('#preview-actions'); acts.innerHTML = '';
  PV.path = p; PV.src = wsUrl(p);
  const stage = el('div', 'pv-stage'); const frameBox = el('div', 'pv-frame'); const f = el('iframe');
  // Security: previews load from the isolated preview origin (no API, no token). Only if that
  // origin is unavailable do we fall back to the app origin — and then with a locked-down sandbox
  // (no allow-same-origin), so the preview still cannot reach the UI or its token.
  if (PREV_BASE) { f.sandbox = 'allow-scripts allow-same-origin allow-forms allow-modals'; f.src = PREV_BASE + PV.src + '?t=' + Date.now(); }
  else { f.sandbox = 'allow-scripts allow-forms allow-modals'; f.src = PV.src + '?t=' + Date.now(); }
  f.title = p;
  const urlbar = el('div', 'pv-url'); urlbar.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span class="addr mono">${esc(p)}</span><span class="dim mono" id="pv-dim"></span>`;
  frameBox.append(urlbar, f); stage.appendChild(frameBox); body.appendChild(stage);
  const seg = el('div', 'seg pv-seg');
  for (const [k, d] of Object.entries(DEVICES)) { const b = el('button', 'ib sm' + (PV.device === k ? ' on' : ''), ico(d.ico)); b.dataset.tip = ({ phone: { en: 'Phone', fa: 'موبایل', ru: 'Телефон', zh: '手机' }, tablet: { en: 'Tablet', fa: 'تبلت', ru: 'Планшет', zh: '平板' }, desktop: { en: 'Desktop', fa: 'کامپیوتر', ru: 'Компьютер', zh: '电脑' } })[k][lang] || k; b.onclick = () => { PV.device = k; localStorage.setItem('orca.pv.device', k); $$('.pv-seg .ib').forEach((x) => x.classList.remove('on')); b.classList.add('on'); applyDevice(); }; seg.appendChild(b); }
  const rot = el('button', 'ib sm', ico('rotate')); rot.dataset.tip = ({ fa: 'چرخش', ru: 'Повернуть', zh: '旋转' })[lang] || 'Rotate'; rot.onclick = () => { PV.rot = !PV.rot; applyDevice(); };
  const full = el('button', 'ib sm', ico('maximize')); full.dataset.tip = ({ fa: 'تمام‌صفحه (Esc)', ru: 'Во весь экран (Esc)', zh: '全屏 (Esc)' })[lang] || 'Full window (Esc)'; full.onclick = () => setPreviewFull(!PV.full);
  const rf = el('button', 'ib sm', ico('refresh')); rf.dataset.tip = ({ fa: 'بارگذاری مجدد', ru: 'Обновить', zh: '刷新' })[lang] || 'Reload'; rf.onclick = () => (f.src = (PREV_BASE || '') + PV.src + '?t=' + Date.now());
  const b = el('button', 'ib sm', ico('edit')); b.dataset.tip = t('edit'); b.onclick = () => { setPreviewFull(false); editFile(p, content); };
  const o = el('button', 'ib sm', ico('external')); o.dataset.tip = ({ fa: 'باز کردن در مرورگر', ru: 'Открыть в браузере', zh: '在浏览器中打开' })[lang] || 'Open in browser'; o.onclick = () => (desktop ? desktop.openExternal((PREV_BASE || location.origin) + PV.src) : window.open((PREV_BASE || '') + PV.src, '_blank'));
  acts.append(seg, rot, rf, full, b, o);
  function applyDevice() {
    const d = DEVICES[PV.device] || DEVICES.desktop; const dim = $('#pv-dim');
    frameBox.classList.toggle('device', !!d.w);
    if (d.w) { const w = PV.rot ? d.h : d.w, h = PV.rot ? d.w : d.h; frameBox.style.setProperty('--dw', w + 'px'); frameBox.style.setProperty('--dh', h + 'px'); dim.textContent = `${w}×${h}`; }
    else { frameBox.style.removeProperty('--dw'); frameBox.style.removeProperty('--dh'); dim.textContent = ''; }
    fitStage();
  }
  function fitStage() {
    // scale the device frame down when the panel is narrower than the device — the page still renders at real device width
    const d = DEVICES[PV.device] || DEVICES.desktop; if (!d.w) { frameBox.style.transform = ''; stage.style.height = ''; return; }
    const w = (PV.rot ? d.h : d.w) + 24, h = (PV.rot ? d.w : d.h) + 60; const aw = stage.clientWidth - 8, ah = Math.max(240, stage.clientHeight - 8);
    const k = Math.min(1, aw / w, ah / h); frameBox.style.transform = k < 1 ? `scale(${k})` : '';
  }
  PV._fit = fitStage; applyDevice();
  if (!PV._ro && window.ResizeObserver) { PV._ro = new ResizeObserver(() => PV._fit && PV._fit()); PV._ro.observe(body); }
}
function setPreviewFull(on) {
  PV.full = on; document.body.classList.toggle('pv-full', on);
  if (on) openPanel();
  setTimeout(() => PV._fit && PV._fit(), 60);
}
// After the agent writes or scaffolds a page, show it right away — no need to leave the app.
let _autoPv = 0;
function maybeAutoPreview(d) {
  if (!d || !d.ok) return; let pth = '';
  try {
    if (d.name === 'scaffold_site') { const r = JSON.parse(d.result || '{}'); pth = (r.files || []).find((f) => /(^|\/)index\.html?$/i.test(f)) || (r.files || []).find((f) => /\.html?$/i.test(f)) || ''; }
    else if (d.name === 'write_file') { const r = JSON.parse(d.result || '{}'); if (/(^|\/)index\.html?$/i.test(r.path || '')) pth = r.path; }
  } catch (_) {}
  if (!pth || Date.now() - _autoPv < 4000) return; _autoPv = Date.now();
  openPanel(); previewFile(pth);
}
function previewText(name, content, langName) { $('#preview-name').textContent = name; $('#preview-actions').innerHTML = ''; const body = $('#preview-body'); body.innerHTML = ''; if (/^html?$/.test(langName)) { const f = el('iframe'); f.sandbox = 'allow-scripts'; f.srcdoc = content; body.appendChild(f); return; } const ta = el('textarea'); ta.value = content; ta.readOnly = true; body.appendChild(ta); $('#preview-save').classList.add('hidden'); }
function editFile(p, content) { const body = $('#preview-body'); body.innerHTML = ''; const ta = el('textarea'); ta.value = content; ta.spellcheck = false; body.appendChild(ta); const sv = $('#preview-save'); sv.classList.remove('hidden'); sv.onclick = async () => { await api('/api/workspace/file', { method: 'POST', body: { path: p, content: ta.value } }); toast(t('saved'), 'ok'); }; ta.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); sv.click(); } if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); } }; }

function diffLines(a, b) {
  const A = (a ?? '').split('\n'), B = (b ?? '').split('\n');
  if (A.length * B.length > 4e6) return { html: [`<div class="hunk">@@ large file: ${A.length} → ${B.length} lines @@</div>`], add: B.length, del: A.length };
  const n = A.length, m = B.length; const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0, add = 0, del = 0;
  while (i < n || j < m) { if (i < n && j < m && A[i] === B[j]) { out.push(['ctx', A[i]]); i++; j++; } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { out.push(['add', B[j]]); j++; add++; } else { out.push(['del', A[i]]); i++; del++; } }
  const res = []; let run = [];
  const flush = () => { if (run.length > 6) { res.push(...run.slice(0, 3)); res.push(['hunk', `… ${run.length - 6} unchanged lines …`]); res.push(...run.slice(-3)); } else res.push(...run); run = []; };
  for (const x of out) { if (x[0] === 'ctx') run.push(x); else { flush(); res.push(x); } } flush();
  return { html: res.map(([k, l]) => `<div class="${k}">${k === 'add' ? '+' : k === 'del' ? '-' : ' '} ${esc(l)}</div>`), add, del };
}
function addChange(d) { renderChange(d, true); if (!$('#tab-changes').classList.contains('active')) { const b = $('#chg-badge'); b.textContent = (+b.textContent || 0) + 1; b.classList.remove('hidden'); } }
function renderChange(d, prepend) {
  const box = $('#changes-list'); if ($(`.chg[data-ck="${d.id}"]`, box)) return;
  const c = el('div', 'chg'); c.dataset.ck = d.id;
  const tag = d.created ? 'ok' : d.deleted ? 'bad' : 'acc'; const tagT = d.created ? t('created') : d.deleted ? t('deleted') : t('modified');
  c.innerHTML = `<div class="chg-head"><span class="pill ${tag}">${tagT}</span><span class="p">${esc(d.path)}</span><span class="stat"></span><button class="btn sm undo">${ico('undo')}${t('restore')}</button></div><div class="diff"></div>`;
  const loadDiff = async () => { const df = $('.diff', c); if (df.innerHTML) return; let full = d; if (full.before === undefined) full = await api('/api/checkpoints/' + d.id + '/diff'); const r = diffLines(full.before, full.after); df.innerHTML = r.html.join(''); $('.stat', c).innerHTML = `<span class="a">+${r.add}</span> <span class="d">−${r.del}</span>`; };
  $('.chg-head', c).onclick = async (e) => { if (e.target.closest('.undo')) return; c.classList.toggle('open'); loadDiff(); };
  $('.undo', c).onclick = async () => { const r = await api('/api/checkpoints/' + d.id, { method: 'POST', body: { direction: 'before' } }); toast(r.ok ? t('restored') + ': ' + d.path : r.error, r.ok ? 'ok' : 'err'); };
  prepend ? box.prepend(c) : box.appendChild(c);
}
async function refreshChanges() { const box = $('#changes-list'); box.innerHTML = ''; if (!S.chat) { box.innerHTML = `<div class="empty">${esc(t('emptyChanges'))}</div>`; return; } const { checkpoints } = await api('/api/chats/' + S.chat.id + '/checkpoints'); for (const ck of checkpoints.reverse()) renderChange(ck, false); if (!checkpoints.length) box.innerHTML = `<div class="empty">${esc(t('emptyChanges'))}</div>`; }
$('#restore-all').onclick = async () => { if (!S.chat) return; const { checkpoints } = await api('/api/chats/' + S.chat.id + '/checkpoints'); if (!checkpoints.length || !confirm(t('restoreAll') + '?')) return; for (const ck of checkpoints.reverse()) await api('/api/checkpoints/' + ck.id, { method: 'POST', body: { direction: 'before' } }); toast(t('restored'), 'ok'); loadFiles(); };

// ───────────────────────── modals ─────────────────────────
const modal = (html) => { $('#modal-body').innerHTML = html; $('#modal-body').classList.remove('st-body'); $('#modal').classList.remove('hidden'); };
const closeModal = () => $('#modal').classList.add('hidden');
$('.modal-x').onclick = closeModal; $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
$('#rail-toggle').onclick = () => { S._railUser = true; $('#rail').classList.toggle('collapsed'); };
$('#tb-theme').onclick = () => { P.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; applyPrefs(); api('/api/config', { method: 'POST', body: { theme: P.theme } }); };

$('#open-leaderboard').onclick = async () => { const { rows } = await api('/api/leaderboard'); modal(`<h2>${ico('trophy')}${t('leaderboard')}</h2><p class="sub">${({ fa: 'بر اساس رأی‌های شما در حالت مقایسه و نبرد (Elo محلی)', ru: 'По вашим голосам в режимах сравнения/битвы (локальный Elo)', zh: '基于你在对比/对战模式中的投票（本地 Elo）' })[lang] || 'From your votes in compare/battle modes (local Elo)'}</p>${rows.length ? `<table class="lb"><tr><th>#</th><th>Model</th><th>Elo</th><th>W</th><th>L</th><th>T</th></tr>${rows.map((r, i) => `<tr><td>${i + 1}</td><td class="lb-m">${brandMark(modelOf(r.model) || { key: r.model, label: r.model })}${esc(modelOf(r.model)?.label || r.model)}</td><td class="elo">${r.elo}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.ties}</td></tr>`).join('')}</table>` : `<div class="empty">${esc(t('emptyLb'))}</div>`}`); };
$('#open-memory').onclick = async () => { const { text } = await api('/api/memory'); modal(`<h2>${ico('brain')}${t('memory')}</h2><p class="sub">${({ fa: 'یادداشت‌هایی که ORCA دربارهٔ شما و پروژه‌ها نگه می‌دارد و در هر گفتگو می‌بیند. قابل ویرایش.', ru: 'Долговременные заметки ORCA о вас и ваших проектах, видны в каждом чате. Можно редактировать.', zh: 'ORCA 保存的关于你和项目的长期笔记，在每个对话中可见。可编辑。' })[lang] || 'Durable notes ORCA keeps about you and your projects, visible in every chat. Editable.'}</p><textarea class="memory-ta" id="mem">${esc(text)}</textarea><div style="margin-top:12px;display:flex;gap:8px"><button class="btn primary" id="mem-save">${ico('check')}${t('save')}</button></div>`); $('#mem-save').onclick = async () => { await api('/api/memory', { method: 'POST', body: { text: $('#mem').value } }); toast(t('saved'), 'ok'); closeModal(); }; };
$('#open-settings').onclick = () => openSettings();

const SHORTCUTS = [['Ctrl N', 'newChat'], ['Ctrl K', 'actions'], ['Ctrl B', 'railT'], ['Ctrl .', 'panelT'], ['Ctrl ,', 'settings'], ['Esc', 'stop'], ['Ctrl Shift L', 'theme'], ['Ctrl Shift F', 'searchPh'], ['Ctrl /', 'shortcuts']];
// ---- Providers (bring your own key) ----
const MCP_PRESETS = [
  { id: 'filesystem', label: 'Filesystem', stdio: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] } },
  { id: 'fetch', label: 'Fetch', stdio: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] } },
  { id: 'memory', label: 'Memory', stdio: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } },
  { id: 'git', label: 'Git', stdio: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-git'] } },
  { id: 'playwright', label: 'Playwright', stdio: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } },
  { id: 'github', label: 'GitHub', stdio: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_…' } } },
  { id: 'huggingface', label: 'HuggingFace', stdio: { command: 'npx', args: ['-y', '@huggingface/mcp-server'], env: { HF_TOKEN: 'hf_…' } } },
  { id: 'hf-hub', label: 'HF Hub (http)', http: { url: 'https://huggingface.co/mcp', headers: { Authorization: 'Bearer hf_…' } } },
  { id: 'brave', label: 'Brave Search', stdio: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: 'BSA_…' } } },
  { id: 'everything', label: 'Everything (test)', stdio: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] } },
];
function applyMcpPreset(id) {
  const p = MCP_PRESETS.find((x) => x.id === id); if (!p) return;
  mcpShowForm(false);
  $('#mf-name').value = p.id;
  const want = p.http ? 'http' : 'stdio';
  const btn = $$('#mf-type button').find((b) => b.dataset.v === want); if (btn) btn.click();
  if (p.stdio) {
    $('#mf-cmd').value = p.stdio.command; $('#mf-args').value = (p.stdio.args || []).join(' ');
    $('#mf-env').value = Object.entries(p.stdio.env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
  } else {
    $('#mf-url').value = p.http.url; $('#mf-hdr').value = Object.entries(p.http.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  }
  toast(({ fa: 'پرسِت پر شد — ذخیره کنید', ru: 'Пресет заполнен — сохраните', zh: '预设已填充——请保存' })[lang] || 'Preset filled — save it', 'ok');
}
document.addEventListener('click', (e) => { const c = e.target.closest('.mcp-chips .chip'); if (c) applyMcpPreset(c.dataset.p); });

// Flow: pick a provider from the catalog (models.dev mirror, 200+) or "Custom" → paste key → models auto-discovered from the
// provider's /models endpoint (fallback: catalog) → tick the ones you want → Test → Save. Keys never leave this machine.
let CATALOG = null;
async function providerEditor(existingId) {
  const c = S.cfg; const box = $('#prov-editor'); box.classList.remove('hidden'); box.innerHTML = `<div class="empty">…</div>`;
  if (!CATALOG) { try { CATALOG = await api('/api/providers/catalog'); } catch (_) { CATALOG = { providers: [] }; } }
  const cur = existingId ? { id: existingId, ...(c.providers[existingId] || {}) } : { id: '', name: '', baseUrl: '', apiKey: '', models: [] };
  box.innerHTML = `
    <div class="pe-head"><b>${existingId ? ts('editProvider') : ts('addProvider')}</b><button class="ib sm" id="pe-close">${ico('x')}</button></div>
    <div class="form-row"><label>${ts('provider')}</label><div class="pe-pickwrap"><button class="pe-pick" id="pe-pick" type="button"${existingId ? ' disabled' : ''}></button></div><input type="hidden" id="pe-id" value="${esc(cur.id || '')}"></div>
    <div class="desc hidden" id="pe-judge-note"></div>
    <div class="form-row"><label>${ts('displayName')}</label><input class="text" id="pe-name" value="${esc(cur.name || '')}" placeholder="—"></div>
    <div class="form-row"><label>Base URL</label><input class="text mono" id="pe-url" value="${esc(cur.baseUrl || '')}" placeholder="https://api.example.com/v1" spellcheck="false"></div>
    <div class="form-row"><label>Logo URL (optional — brand mark for this provider)</label><input class="text mono" id="pe-logo" value="${esc(cur.logo || '')}" placeholder="https://…/logo.svg or data:image/png;base64,…" spellcheck="false"></div>
    <div class="form-row"><label>${ts('apiKey')}</label><input class="text mono" id="pe-key" type="password" placeholder="${cur.keySet ? cur.apiKey : ts('pasteKey')}" spellcheck="false" autocomplete="off"><button class="ib sm" id="pe-eye" data-tip="${ts('show')}">${ico('eye')}</button><a class="small" id="pe-doc" target="_blank" rel="noopener" href="#">${ts('getKey')}</a></div>
    <div class="form-row"><label>${ts('models')}</label><div class="pe-models-tools"><input class="text" id="pe-filter" placeholder="${ts('filterModels')}"><button class="btn sm" id="pe-discover">${ico('refresh')}${ts('discover')}</button><span class="small" id="pe-count"></span></div></div>
    <div class="pe-models" id="pe-models"></div>
    <div class="pe-foot"><span class="small" id="pe-msg"></span><span class="sp"></span><button class="btn sm" id="pe-test">${ts('test')}</button><button class="btn primary sm" id="pe-save">${ico('check')}${ts('save')}</button></div>`;
  let known = []; // catalog rows for the selected provider
  let chosen = new Map((cur.models || []).map((m) => [m.id, m]));
  const provInfo = () => ( $('#pe-id').value === '__judge' ? { id: '__judge', name: (ts('judge') || 'Judge') + ' — System One (TypeSafe)' } : CATALOG.providers.find((p) => p.id === $('#pe-id').value) || {});
  // custom themed provider picker (same component language as the model picker): logo + search + grouped list
  let provId = cur.id || '';
  const provById = (id) => (id === '__judge' ? { id: '__judge', name: (ts('judge') || 'Judge') + ' — System One (TypeSafe)', judge: true } : CATALOG.providers.find((p) => p.id === id));
  const renderPePick = () => { const p = provById(provId); $('#pe-id').value = provId; $('#pe-pick').innerHTML = p ? `${brandMark({ vendor: p.name, label: p.name })}<span class="pe-pick-label">${esc(p.name)}</span>${p.count ? `<span class="k">${p.count}</span>` : ''}<span class="pk-chev">${ico('chev')}</span>` : `<span class="pe-pick-label">${({ fa: 'انتخاب ارائه‌دهنده…', ru: 'Выбор провайдера…', zh: '选择提供商…' })[lang] || 'Choose provider…'}</span><span class="pk-chev">${ico('chev')}</span>`; };
  const closePeMenu = () => { const m = $('#pe-menu'); if (m) { if (m._key) document.removeEventListener('keydown', m._key); m.remove(); } };
  const openPeMenu = () => {
    closePeMenu();
    const menu = el('div', 'pk-menu pe-menu'); menu.id = 'pe-menu';
    menu.innerHTML = `<input class="text pe-search" id="pe-q" placeholder="${({ fa: 'جست‌وجوی ارائه‌دهنده…', ru: 'Поиск провайдера…', zh: '搜索提供商…' })[lang] || 'Search providers…'}" spellcheck="false"><div class="pe-list"></div>`;
    const draw = (q) => {
      const f = (q || '').toLowerCase();
      const feat = (CATALOG.featured || []).map(provById).filter(Boolean);
      const rest = CATALOG.providers.filter((p) => !(CATALOG.featured || []).includes(p.id));
      const all = [...feat, ...rest, provById('__judge')];
      const vis = all.filter((p) => p && (!f || p.name.toLowerCase().includes(f) || p.id.includes(f))).slice(0, 80);
      $('.pe-list', menu).innerHTML = vis.map((p) => `<button class="pk-item" data-id="${esc(p.id)}">${brandMark({ vendor: p.name, label: p.name })}<span class="pk-i-top"><span class="pk-i-label">${esc(p.name)}</span>${p.count ? `<em class="pk-i-tier">${p.count}</em>` : ''}</span><span class="pk-i-sub">${esc((p.api || '').replace(/^https?:\/\//, ''))}</span></button>`).join('') || `<div class="empty small">—</div>`;
      $$('.pk-item', menu).forEach((b) => (b.onclick = () => { provId = b.dataset.id; closePeMenu(); renderPePick(); applyProvider(); }));
    };
    draw('');
    $('#pe-q', menu).oninput = (e) => draw(e.target.value);
    $('.pe-pickwrap').appendChild(menu);
    menu._key = (e) => { if (!menu.isConnected) { document.removeEventListener('keydown', menu._key); return; } if (e.key === 'Escape') { closePeMenu(); $('#pe-pick').focus(); } };
    document.addEventListener('keydown', menu._key);
    $('#pe-q', menu).focus();
  };
  $('#pe-pick').onclick = () => ($('#pe-menu') ? closePeMenu() : openPeMenu());
  document.addEventListener('mousedown', (e) => { const m = $('#pe-menu'); if (m && !e.target.closest('#pe-menu') && !e.target.closest('#pe-pick')) closePeMenu(); });
  renderPePick();
  const renderModels = () => {
    const f = ($('#pe-filter').value || '').toLowerCase();
    const rows = [...known]; for (const m of chosen.values()) if (!rows.find((r) => r.id === m.id)) rows.unshift({ ...m, custom: true });
    const vis = rows.filter((m) => !f || m.id.toLowerCase().includes(f) || (m.name || '').toLowerCase().includes(f)).slice(0, 400);
    $('#pe-count').textContent = `${chosen.size} ${ts('selected')} · ${rows.length}`;
    $('#pe-models').innerHTML = vis.map((m) => `<label class="pe-m ${chosen.has(m.id) ? 'on' : ''}"><input type="checkbox" data-id="${esc(m.id)}" ${chosen.has(m.id) ? 'checked' : ''}><span class="pe-m-name">${esc(m.name || m.id)}</span><span class="k mono">${esc(m.id)}</span><span class="pe-m-tags">${m.toolCall ? `<i>${ts('tools')}</i>` : ''}${m.reasoning ? `<i>${ts('reasoning')}</i>` : ''}${m.attachment ? `<i>${ts('images')}</i>` : ''}${m.context ? `<i>${Math.round(m.context / 1000)}k</i>` : ''}${m.free ? `<i class="free">${ts('free')}</i>` : ''}</span></label>`).join('') + (rows.length ? '' : `<div class="empty small">${ts('noModelsYet')}</div>`) + `<div class="pe-m add"><input class="text mono" id="pe-manual" placeholder="${ts('manualModelId')}"><button class="btn sm" id="pe-manual-add">${ts('add')}</button></div>`;
    $$('#pe-models input[type=checkbox]').forEach((cb) => (cb.onchange = () => { const m = rows.find((r) => r.id === cb.dataset.id); if (cb.checked) chosen.set(m.id, { id: m.id, name: m.name, maxTokens: m.output || m.maxTokens || 8192, reasoning: !!m.reasoning, toolCall: m.toolCall !== false, attachment: !!m.attachment, context: m.context || 0 }); else chosen.delete(m.id); cb.closest('.pe-m').classList.toggle('on', cb.checked); $('#pe-count').textContent = `${chosen.size} ${ts('selected')} · ${rows.length}`; }));
    $('#pe-manual-add').onclick = () => { const id = $('#pe-manual').value.trim(); if (!id) { $('#pe-manual').focus(); $('#pe-msg').textContent = ts('manualModelId'); return; } chosen.set(id, { id, name: id, maxTokens: 8192, toolCall: true }); $('#pe-msg').textContent = `✓ ${id}`; renderModels(); };
    if ($('#pe-manual')) $('#pe-manual').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#pe-manual-add').click(); } };
  };
  const loadCatalogModels = async () => { const p = provInfo(); if (!p.id) return; const r = await api('/api/providers/models?id=' + encodeURIComponent(p.id)); known = r.models || []; renderModels(); };
  const judgeMode = () => $('#pe-id').value === '__judge';
  const applyJudgeMode = () => {
    const on = judgeMode(); const note = $('#pe-judge-note'); note.classList.toggle('hidden', !on);
    box.classList.toggle('pe-judge', on);
    if (!on) return;
    const J = S.cfg.judge || {};
    note.innerHTML = `${ts('judgeDesc')}<br><span class="small">${esc(({ en: 'Not a chat model: it is asked typed questions (yes/no, choice, score) and never writes answers. Only the key is needed — URL and model have safe defaults.', fa: 'مدل گفتگو نیست: از آن سوال‌های تایپ‌شده (بله/خیر، انتخاب، امتیاز) پرسیده می‌شود و هیچ‌وقت پاسخ نمی‌نویسد. فقط کلید لازم است — URL و مدل پیش‌فرض امن دارند.', ru: 'Это не чат-модель: ей задают типизированные вопросы (да/нет, выбор, оценка), ответы она не пишет. Нужен только ключ — URL и модель имеют безопасные значения по умолчанию.', zh: '不是聊天模型：只回答类型化问题（是/否、选择、评分），从不撰写回复。只需密钥 — URL 和模型有安全默认值。' })[lang] || '')}</span>`;
    note.innerHTML += `<ol class="pe-steps">${ts('judgeSteps').map((x) => `<li>${x}</li>`).join('')}</ol>`;
    $('#pe-name').value = ts('judge'); $('#pe-url').value = J.baseUrl || 'https://api.typesafe.ai/v1'; $('#pe-url').placeholder = 'https://api.typesafe.ai/v1';
    $('#pe-key').placeholder = J.keySet ? J.apiKey : ts('pasteKey'); $('#pe-doc').href = 'https://typesafe.ai'; $('#pe-doc').classList.remove('hidden');
    $('#pe-filter').value = ''; known = [{ id: J.model || 'jev-latest', name: 'System One', context: 64000, judge: true }]; chosen = new Map([[known[0].id, known[0]]]); renderModels();
    $('#pe-save').innerHTML = ico('check') + (J.keySet ? ts('save') : ts('judgeActivate'));
    $('#pe-msg').textContent = J.keySet ? (S.health?.judge?.enabled ? '● ' + ts('judgeActive') : ts('judgeKeySaved')) : ts('judgeNeedKey');
  };
  const applyProvider = async () => { if (judgeMode()) return applyJudgeMode(); box.classList.remove('pe-judge'); $('#pe-judge-note').classList.add('hidden'); $('#pe-save').innerHTML = ico('check') + ts('save'); const p = provInfo(); if (!existingId) { $('#pe-name').value = p.name || ''; $('#pe-url').value = p.api || ''; } $('#pe-url').placeholder = p.api || 'https://api.example.com/v1'; $('#pe-doc').href = ({ openai: 'https://platform.openai.com/api-keys', anthropic: 'https://console.anthropic.com/settings/keys', google: 'https://aistudio.google.com/apikey', openrouter: 'https://openrouter.ai/keys', groq: 'https://console.groq.com/keys', xai: 'https://console.x.ai', mistral: 'https://console.mistral.ai/api-keys', deepseek: 'https://platform.deepseek.com/api_keys', togetherai: 'https://api.together.ai/settings/api-keys', cerebras: 'https://cloud.cerebras.ai', zhipuai: 'https://open.bigmodel.cn/usercenter/apikeys', moonshotai: 'https://platform.moonshot.ai/console/api-keys', huggingface: 'https://huggingface.co/settings/tokens', nvidia: 'https://build.nvidia.com', 'fireworks-ai': 'https://fireworks.ai/account/api-keys', dahl: 'https://inference.dahl.global/account', routeway: 'https://routeway.ai/keys' })[p.id] || (p.doc || '#'); $('#pe-doc').classList.toggle('hidden', $('#pe-doc').getAttribute('href') === '#'); $('#pe-key').placeholder = p.local ? ts('noKeyNeeded') : (cur.keySet ? cur.apiKey : ts('pasteKey')); await loadCatalogModels(); };
  $('#pe-id').onchange = applyProvider;
  $('#pe-filter').oninput = renderModels;
  $('#pe-eye').onclick = () => { const k = $('#pe-key'); k.type = k.type === 'password' ? 'text' : 'password'; };
  $('#pe-close').onclick = () => box.classList.add('hidden');
  const creds = () => ({ baseUrl: $('#pe-url').value.trim(), apiKey: $('#pe-key').value.trim(), api: provInfo().anthropic || /anthropic\.com/.test($('#pe-url').value) ? 'anthropic' : 'openai' });
  $('#pe-discover').onclick = async () => { const b = $('#pe-discover'); b.disabled = true; $('#pe-msg').textContent = ts('discovering'); const body = creds(); if (!body.apiKey && cur.keySet) body.useStored = existingId; const r = await api('/api/providers/discover', { method: 'POST', body: { ...body, id: existingId || '' } }); b.disabled = false; if (r.error) { $('#pe-msg').textContent = '✗ ' + r.error.slice(0, 120); return; } const live = r.models || []; const byId = new Map(known.map((m) => [m.id, m])); known = live.map((m) => ({ ...(byId.get(m.id) || {}), ...m, toolCall: byId.get(m.id)?.toolCall ?? true })); $('#pe-msg').textContent = `✓ ${live.length} ${ts('modelsN')}`; renderModels(); };
  $('#pe-test').onclick = async () => { if (judgeMode()) { $('#pe-msg').textContent = ts('testing'); const body = { baseUrl: $('#pe-url').value.trim(), model: [...chosen.keys()][0] || 'jev-latest' }; if ($('#pe-key').value.trim()) body.apiKey = $('#pe-key').value.trim(); const r = await api('/api/judge/test', { method: 'POST', body }); $('#pe-msg').textContent = r.ok ? `✓ ${ts('judgeTested')} · ${r.ms} ms · ${r.model || ''}` : `✗ ${(r.error || '').slice(0, 140)}`; return; } const m = [...chosen.keys()][0]; if (!m) return ($('#pe-msg').textContent = ts('pickModelFirst')); $('#pe-msg').textContent = ts('testing'); const body = { ...creds(), model: m }; if (!body.apiKey && existingId) body.key = `${existingId}/${m}`; const r = await api('/api/models/test', { method: 'POST', body }); $('#pe-msg').textContent = r.ok ? `✓ ${m} · ${r.ms} ms` : `✗ ${(r.error || '').slice(0, 140)}`; };
  $('#pe-save').onclick = async () => { if (judgeMode()) {
      const judge = { enabled: true, baseUrl: $('#pe-url').value.trim() || 'https://api.typesafe.ai/v1', model: [...chosen.keys()][0] || 'jev-latest' }; const k = $('#pe-key').value.trim(); if (k) judge.apiKey = k;
      if (!k && !(S.cfg.judge || {}).keySet) { $('#pe-key').focus(); $('#pe-key').classList.add('shake'); setTimeout(() => $('#pe-key')?.classList.remove('shake'), 600); return ($('#pe-msg').textContent = '✗ ' + ts('judgeNeedKey')); }
      const b = $('#pe-save'); b.disabled = true; $('#pe-msg').textContent = ts('testing');
      const test = await api('/api/judge/test', { method: 'POST', body: { baseUrl: judge.baseUrl, model: judge.model, ...(k ? { apiKey: k } : {}) } }).catch((e) => ({ error: e.message }));
      b.disabled = false;
      if (!test.ok) { $('#pe-msg').textContent = `✗ ${(test.error || 'test failed').slice(0, 140)}`; return; }
      await api('/api/config', { method: 'POST', body: { judge } });
      S.cfg = await api('/api/config'); api('/api/health').then((h) => { S.health = h; }).catch(() => {});
      toast(ts('judgeAdded'), 'ok'); box.classList.add('hidden'); openSettings('agent');
      setTimeout(() => { const el = $('#jg-key'); if (el) { el.closest('.card, .st-section, .form-row')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 80);
      return; } const id = existingId || $('#pe-id').value; if (!id) return; const pv = { name: $('#pe-name').value.trim() || provInfo().name || id, baseUrl: $('#pe-url').value.trim() || provInfo().api || '', models: [...chosen.values()] }; const lg = ($('#pe-logo')?.value || '').trim(); if (/^(https?:\/\/|data:image\/)/i.test(lg)) pv.logo = lg; const k = $('#pe-key').value.trim(); if (k) pv.apiKey = k; if (!pv.baseUrl) return ($('#pe-msg').textContent = ts('needUrl')); if (!pv.models.length) return ($('#pe-msg').textContent = ts('pickModelFirst')); await api('/api/config', { method: 'POST', body: { providers: { [id]: pv } } }); await loadConfig(); toast(ts('saved'), 'ok'); openSettings('models'); };
  await applyProvider();
  if (existingId) { $('#pe-name').value = cur.name || ''; $('#pe-url').value = cur.baseUrl || ''; renderModels(); }
}
async function paintVault() {
  const d = $('#cloud-dot'), st = $('#cloud-state'); if (!d || !st) return;
  try { const v = await api('/api/vault'); d.className = 'cloud-dot ' + (v.ok ? 'on' : 'off'); st.textContent = !v.enabled ? tu('cloudOff') : v.ok ? `${tu('cloudOk')} · ${v.aliases.length} ${ts('modelsN')} · ${v.keys} ${ts('keysN')}` : `${tu('cloudDown')}${v.error ? ' (' + v.error + ')' : ''}`; } catch (_) { d.className = 'cloud-dot off'; st.textContent = tu('cloudDown'); }
}
async function mcpPatch(mut) { const cur = JSON.parse(JSON.stringify(S.cfg.mcpServers || {})); mut(cur); S.cfg = await api('/api/config', { method: 'POST', body: { mcpServers: cur } }); }
async function loadMcpSettings() {
  const box = $('#mcp-box'); if (!box) return;
  let snap = []; try { snap = (await api('/api/mcp')).servers; } catch (_) {}
  if (!snap.length) box.innerHTML = `<div class="empty">${esc(ts('mcpEmpty'))}</div>`;
  else box.innerHTML = snap.map((s) => `
    <div class="mcp-srv" data-n="${esc(s.name)}">
      <div class="mcp-head"><span class="mcp-dot ${esc(s.status)}" title="${esc(ts('mcpSt' + s.status[0].toUpperCase() + s.status.slice(1)) || s.status)}"></span><b>${esc(s.name)}</b><span class="pill">${s.type}</span><span class="pill">${s.mode}</span><span class="small" style="color:var(--fg-3)">${s.tools.filter((x) => x.enabled).length}/${s.tools.length} ${esc(ts('mcpToolsN'))} · ~${s.tokEst} tok</span><span style="flex:1"></span><button class="btn sm" data-a="restart" title="${esc(ts('mcpRestart'))}">${ico('refresh')}</button><button class="btn sm" data-a="logs" title="${esc(ts('mcpLogs'))}">${ico('eye')}</button><button class="btn sm danger" data-a="del" title="${esc(ts('mcpDel'))}">${ico('trash')}</button></div>
      ${s.error ? `<div class="mcp-err small">${esc(s.error)}</div>` : ''}
      ${s.changed ? `<div class="mcp-warn small">${ico('shield')}<span style="flex:1">${esc(ts('mcpChanged'))}</span><button class="btn sm" data-a="approve">${esc(ts('mcpApprove'))}</button></div>` : ''}
      ${s.pollution ? `<div class="mcp-warn small">${esc(ts('mcpPollution'))}</div>` : ''}
      <div class="mcp-ctrl"><span class="small">${esc(ts('mcpEnabled'))}</span><button class="switch ${s.enabled ? 'on' : ''}" data-a="enabled" role="switch" aria-checked="${s.enabled}"></button><span class="small">${esc(ts('mcpMode'))}</span><div class="seg sm"><button data-v="direct" class="${s.mode === 'direct' ? 'active' : ''}" title="${esc(ts('mcpDirectDesc'))}">${esc(ts('mcpDirect'))}</button><button data-v="compact" class="${s.mode === 'compact' ? 'active' : ''}" title="${esc(ts('mcpCompactDesc'))}">${esc(ts('mcpCompact'))}</button></div></div>
      <details class="mcp-tools"><summary>${esc(ts('mcpToolsN'))} (${s.tools.length})</summary>${s.tools.length ? s.tools.map((tl) => `<label class="mcp-tool"><input type="checkbox" data-t="${esc(tl.name)}" ${tl.enabled ? 'checked' : ''}><span class="mcp-tl-name mono">${esc(tl.name)}</span><span class="mcp-tl-desc">${esc(tl.description)}</span></label>`).join('') : `<div class="small" style="color:var(--fg-3);padding:6px 4px">…</div>`}</details>
      <pre class="mcp-log hidden" dir="ltr"></pre>
    </div>`).join('');
  $$('.mcp-srv', box).forEach((card) => {
    const name = card.dataset.n;
    card.querySelector('[data-a=restart]').onclick = async () => { await api('/api/mcp', { method: 'POST', body: { action: 'restart', name } }); loadMcpSettings(); };
    card.querySelector('[data-a=del]').onclick = async () => { if (!confirm(ts('mcpDelConfirm'))) return; await api('/api/mcp', { method: 'POST', body: { action: 'stop', name } }); await mcpPatch((cur) => { delete cur[name]; }); loadMcpSettings(); };
    const ap = card.querySelector('[data-a=approve]'); if (ap) ap.onclick = async () => { await api('/api/mcp', { method: 'POST', body: { action: 'approve', name } }); loadMcpSettings(); };
    card.querySelector('[data-a=logs]').onclick = async () => { const pre = $('.mcp-log', card); if (!pre.classList.contains('hidden')) return pre.classList.add('hidden'); const r = await api('/api/mcp/logs?name=' + encodeURIComponent(name)); pre.textContent = (r.lines || []).join('\n') || '—'; pre.classList.remove('hidden'); };
    card.querySelector('[data-a=enabled]').onclick = async (e) => { const on = e.currentTarget.classList.toggle('on'); await mcpPatch((cur) => { cur[name] = { ...(cur[name] || {}), enabled: on }; }); await api('/api/mcp', { method: 'POST', body: { action: on ? 'restart' : 'stop', name } }); loadMcpSettings(); };
    $$('.seg.sm button', card).forEach((b) => (b.onclick = async () => { await mcpPatch((cur) => { cur[name] = { ...(cur[name] || {}), mode: b.dataset.v }; }); loadMcpSettings(); }));
    $$('.mcp-tool input', card).forEach((cb) => (cb.onchange = async () => { await mcpPatch((cur) => { const sv = (cur[name] = cur[name] || {}); sv.tools = { ...(sv.tools || {}), [cb.dataset.t]: cb.checked }; }); loadMcpSettings(); }));
  });
}
const splitArgs = (str) => { const out = []; let cur = '', q = ''; for (const ch of str) { if (q) { if (ch === q) q = ''; else cur += ch; } else if (ch === '"' || ch === "'") q = ch; else if (ch === ' ') { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
function mcpShowForm(pasteMode) {
  const f = $('#mcp-form'); f.classList.remove('hidden');
  const fld = (label, inner) => `<div class="form-row"><label>${label}</label>${inner}</div>`;
  const cancel = ({ en: 'Cancel', fa: 'انصراف', ru: 'Отмена', zh: '取消' })[lang] || 'Cancel';
  if (pasteMode) {
    f.innerHTML = `<textarea class="text mono" id="mf-json" rows="6" dir="ltr" spellcheck="false" placeholder='${esc(ts('mcpPastePh'))}'></textarea><div class="form-row" style="gap:8px"><button class="btn primary" id="mf-save">${ico('check')}${ts('save')}</button><button class="btn" id="mf-x">${cancel}</button></div>`;
    $('#mf-x').onclick = () => f.classList.add('hidden');
    $('#mf-save').onclick = async () => {
      let j; try { j = JSON.parse($('#mf-json').value); } catch (e) { return toast('JSON: ' + e.message, 'err'); }
      let servers = j;
      if (j.mcpServers) servers = j.mcpServers;
      else if (j.command || j.url || j.type) { const n = prompt(ts('mcpName')); if (!n) return; servers = { [n]: j }; }
      if (!servers || typeof servers !== 'object') return toast('JSON?', 'err');
      await mcpPatch((cur) => { for (const [n, sv] of Object.entries(servers)) if (n && sv && typeof sv === 'object') cur[n] = { enabled: true, ...sv }; });
      toast(ts('saved'), 'ok'); f.classList.add('hidden'); loadMcpSettings();
    };
    return;
  }
  f.innerHTML = `<div class="mcp-grid">
    ${fld(ts('mcpName'), `<input class="text" id="mf-name" placeholder="filesystem" spellcheck="false">`)}
    ${fld(ts('mcpType'), `<div class="seg sm" id="mf-type"><button data-v="stdio" class="active">stdio</button><button data-v="http">http</button></div>`)}
    <div id="mf-stdio">${fld(ts('mcpCmd'), `<input class="text mono" id="mf-cmd" dir="ltr" placeholder="npx">`)}${fld(ts('mcpArgs'), `<input class="text mono" id="mf-args" dir="ltr" placeholder="-y @modelcontextprotocol/server-filesystem /path">`)}${fld(ts('mcpEnv'), `<textarea class="text mono" id="mf-env" rows="2" dir="ltr" placeholder="API_KEY=…"></textarea>`)}</div>
    <div id="mf-http" class="hidden">${fld(ts('mcpUrl'), `<input class="text mono" id="mf-url" dir="ltr" placeholder="https://…/mcp">`)}${fld(ts('mcpHeaders'), `<textarea class="text mono" id="mf-hdr" rows="2" dir="ltr" placeholder="Authorization: Bearer …"></textarea>`)}</div>
    ${fld(ts('mcpMode'), `<div class="seg sm" id="mf-mode"><button data-v="direct" class="active" title="${esc(ts('mcpDirectDesc'))}">${esc(ts('mcpDirect'))}</button><button data-v="compact" title="${esc(ts('mcpCompactDesc'))}">${esc(ts('mcpCompact'))}</button></div>`)}
    <div class="form-row" style="gap:8px"><button class="btn primary" id="mf-save">${ico('check')}${ts('save')}</button><button class="btn" id="mf-x">${cancel}</button></div>
  </div>`;
  const segv = (id) => { let v = $('#' + id + ' button.active') ? $('#' + id + ' button.active').dataset.v : ''; $$('#' + id + ' button').forEach((b) => (b.onclick = () => { $$('#' + id + ' button').forEach((x) => x.classList.toggle('active', x === b)); v = b.dataset.v; if (id === 'mf-type') { $('#mf-stdio').classList.toggle('hidden', v !== 'stdio'); $('#mf-http').classList.toggle('hidden', v !== 'http'); } })); return () => v; };
  const typeV = segv('mf-type'); const modeV = segv('mf-mode');
  $('#mf-x').onclick = () => f.classList.add('hidden');
  $('#mf-save').onclick = async () => {
    const name = $('#mf-name').value.trim(); if (!name) return toast(ts('mcpName') + '?', 'err');
    const sv = { enabled: true, mode: modeV() || 'direct' };
    if (typeV() === 'http') {
      sv.url = $('#mf-url').value.trim(); if (!sv.url) return toast(ts('mcpUrl') + '?', 'err');
      const h = {}; $('#mf-hdr').value.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => { const i = l.indexOf(':'); if (i > 0) h[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
      if (Object.keys(h).length) sv.headers = h;
    } else {
      sv.command = $('#mf-cmd').value.trim(); if (!sv.command) return toast(ts('mcpCmd') + '?', 'err');
      const av = $('#mf-args').value.trim(); if (av) sv.args = splitArgs(av); else sv.args = [];
      const e = {}; $('#mf-env').value.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => { const i = l.indexOf('='); if (i > 0) e[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
      if (Object.keys(e).length) sv.env = e;
    }
    await mcpPatch((cur) => { cur[name] = sv; });
    toast(ts('saved'), 'ok'); f.classList.add('hidden'); loadMcpSettings();
  };
}

async function openSettings(page = 'general') {
  const c = await api('/api/config');
  const fa = lang === 'fa';
  const T4 = (o) => o[lang] ?? o.en;
  const row = (label, inner, desc) => `<div class="form-row"><label>${label}</label>${inner}${desc ? `<div class="desc">${desc}</div>` : ''}</div>`;
  const sw = (id, on) => `<button class="switch ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${on}"></button>`;
  const segm = (id, opts, val) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === val ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  modal(`<h2>${ico('settings')}${t('settings')}</h2><p class="sub">ORCA ${c.version || ''}</p>
  <div class="tabs-h" id="st-tabs">${[['general', 'sparkle'], ['appearance', 'sun'], ['models', 'code'], ['mcp', 'plug'], ['agent', 'rocket'], ['data', 'folder'], ['updates', 'download']].map(([k, i]) => `<button data-p="${k}" class="${k === page ? 'active' : ''}">${ico(i)}${ts(k)}</button>`).join('')}</div>

  <div class="spages">
  <div class="spage ${page === 'general' ? 'active' : ''}" data-p="general">
    ${row(ts('lang'), segm('st-lang', LANGS, lang))}
    ${row(ts('sendKey'), segm('st-sendkey', [['enter', 'Enter'], ['ctrlEnter', 'Ctrl+Enter']], P.sendKey))}
    ${row(ts('showReasoning'), sw('st-reason', P.showReasoning))}
    ${row(ts('notifications'), sw('st-notif', P.notifications))}
    ${row(ts('sound'), sw('st-sound', P.sound))}
    <h3>${ts('shortcuts')}</h3>
    <div class="shortcut-grid">${SHORTCUTS.map(([k, l]) => `<div><span>${t(l)}</span><kbd>${k}</kbd></div>`).join('')}</div>
  </div>

  <div class="spage ${page === 'appearance' ? 'active' : ''}" data-p="appearance">
    ${row(ts('theme'), segm('st-theme', [['dark', ico('moon') + ts('dark')], ['light', ico('sun') + ts('light')], ['system', ts('system')]], P.theme))}
    ${row(ts('accent'), `<div class="swatches" id="st-accent">${['indigo', 'violet', 'cyan', 'emerald', 'amber', 'rose'].map((a) => `<span class="sw ${a === P.accent ? 'on' : ''}" data-a="${a}" style="background:${{ indigo: '#6e7cff', violet: '#a06bff', cyan: '#22b8d6', emerald: '#22c48a', amber: '#f0a531', rose: '#f0567c' }[a]}"></span>`).join('')}</div>`)}
    ${row(ts('fontSize'), `<input type="range" id="st-fs" min="12" max="18" step="1" value="${P.fontSize}" style="flex:1"><span class="small mono" id="st-fs-v">${P.fontSize}px</span>`)}
    ${row(ts('density'), segm('st-density', [['comfortable', ts('comfortable')], ['compact', ts('compact')]], P.density))}
  </div>

  <div class="spage ${page === 'models' ? 'active' : ''}" data-p="models">
    <div class="desc vault-box" id="vault-box"><span class="cloud-dot" id="cloud-dot"></span><b>${tu('cloud')}</b> · <span id="cloud-state">…</span><br><span class="small">${tu('gateway')}</span></div>
    <h3>${ts('modelsList')}</h3>
    ${row(ts('defaultModel'), `<select class="text" id="st-default">${c.models.map((m) => `<option value="${m.key}" ${m.key === c.defaultModel ? 'selected' : ''}>${esc(m.label)} — ${esc(m.note?.[lang] || m.vendor || m.provider)}</option>`).join('')}</select>`)}
    <div id="model-list">${c.models.filter((m) => m.key !== 'auto').map((m) => `<div class="model-row" data-key="${m.key}"><div class="mr-main">${brandMark(m)}<b>${esc(m.label)}</b> <span class="k">${esc(m.builtin ? ts('builtin') : m.vendor || m.provider)} · ${esc(I18N[lang]['tier_' + m.tier] ?? I18N.en['tier_' + m.tier] ?? m.tier ?? '')}</span></div><span class="pill test-res ${m.ready ? '' : 'off'}">${m.ready ? '' : ts('noKey')}</span><button class="btn sm test">${ts('test')}</button>${m.builtin ? '' : `<button class="ib sm del" data-tip="${ts('remove')}">${ico('trash')}</button>`}</div>`).join('')}</div>
    <h3>${ts('providers')}</h3><p class="sub" style="margin-top:-6px">${ts('providersDesc')}</p>
    <div id="prov-list">${Object.entries(c.providers).map(([id, p]) => `<div class="prov-row" data-id="${esc(id)}"><div class="prov-main">${brandMark({ provider: id, vendor: id, label: p.name || id })}<b>${esc(p.name || id)}</b><span class="k mono">${esc((p.baseUrl || '').replace(/^https?:\/\//, ''))}</span><span class="small">${(p.models || []).length} ${ts('modelsN')} · ${p.keySet ? ts('keySet') : ts('noKey')}</span></div><button class="btn sm edit">${ts('edit')}</button><button class="ib sm del" data-tip="${ts('remove')}">${ico('trash')}</button></div>`).join('') || `<div class="empty small">${ts('noProviders')}</div>`}</div>
    <button class="btn primary" id="prov-add" style="margin-top:8px">${ico('plus')}${ts('addProvider')}</button>
    <div id="prov-editor" class="prov-editor hidden"></div>
  </div>

  <div class="spage ${page === 'agent' ? 'active' : ''}" data-p="agent">
    ${row(ts('autonomy'), segm('st-auto', [['ask', ico('lock') + ts('autoAsk')], ['auto', ico('bolt') + ts('autoAuto')], ['yolo', ico('rocket') + ts('autoYolo')]], c.autonomy))}
    ${row(ts('effort'), segm('st-effort', [['low', ts('low')], ['medium', ts('medium')], ['high', ts('high')]], c.reasoningEffort || 'medium'))}
    ${row(ts('maxSteps'), `<input class="text" id="max-steps" type="number" min="4" max="120" value="${c.maxSteps}" style="max-width:110px">`)}
    ${row(ts('temperature'), `<input type="range" id="temp" min="0" max="1.2" step="0.1" value="${c.temperature}" style="flex:1"><span class="small mono" id="temp-v">${c.temperature}</span>`)}
    ${row(ts('shellTimeout'), `<input class="text" id="shell-to" type="number" min="10" max="900" value="${c.shellTimeout || 120}" style="max-width:110px">`)}
    <h3>${ts('judge')}</h3><p class="sub" style="margin-top:-6px">${ts('judgeDesc')}</p>
    ${row(ts('apiKey'), `<input class="text" id="jg-key" placeholder="${c.judge?.keySet ? c.judge.apiKey : ts('pasteKey')}" autocomplete="off" spellcheck="false"><button class="btn sm" id="jg-test">${ts('test')}</button><span class="small" id="jg-msg">${c.judge?.keySet ? (S.health?.judge?.enabled ? '● ' + ts('judgeTested') : '') : ''}</span>`)}
    ${row(ts('baseUrl'), `<input class="text" id="jg-url" placeholder="https://api.typesafe.ai/v1" value="${esc(c.judge?.baseUrl || '')}" spellcheck="false"><input class="text" id="jg-model" placeholder="jev-latest" value="${esc(c.judge?.model || '')}" spellcheck="false" style="max-width:180px"><label class="small" style="display:flex;align-items:center;gap:6px;white-space:nowrap"><input type="checkbox" id="jg-on" ${c.judge?.enabled !== false ? 'checked' : ''}>${ts('judgeOn')}</label>`)}
    <h3>${ts('vision')}</h3><p class="sub" style="margin-top:-6px">${ts('visionDesc')}</p>
    ${(() => { const provs = Object.entries(c.providers || {}).filter(([, p]) => p.keySet || p.apiKey); const opt = (v, label, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(label)}</option>`; const provOpts = (cur) => provs.map(([id, p]) => opt(id, p.name || id, cur)).join('');
      const vcur = c.vision.provider || ''; const icur = c.imageGen.provider || ''; const vgcur = c.videoGen.provider || '';
      return `
    ${row(ts('provider'), `<select class="text" id="vs-prov" style="max-width:220px">${opt('', ts('visAuto'), vcur)}${provOpts(vcur)}${opt('custom', ts('customEndpoint'), vcur)}</select><input class="text" id="vs-model" placeholder="${ts('modelId')}" value="${esc(c.vision.model || '')}" spellcheck="false">`)}
    ${row(ts('apiKey'), `<input class="text" id="vs-key" placeholder="${c.vision.keySet ? c.vision.apiKey : ts('keyOptionalProv')}" autocomplete="off" spellcheck="false"><input class="text" id="vs-url" placeholder="${ts('baseUrl')}" value="${esc(c.vision.baseUrl || '')}" spellcheck="false">`)}
    <h3>${ts('imageGen')}</h3><p class="sub" style="margin-top:-6px">${ts('imageGenDesc')}</p>
    ${row(ts('provider'), `<select class="text" id="ig-prov" style="max-width:220px">${opt('', ts('igAuto'), icur)}${opt('builtin', ts('builtinFree'), icur)}${opt('openai', ts('imagesApi'), icur)}${provOpts(icur)}</select><input class="text" id="ig-model" list="ig-models" placeholder="${ts('modelId')} — flux-2-flash, gpt-image-1, seedream-v4 …" value="${esc(c.imageGen.model || '')}" spellcheck="false"><datalist id="ig-models">${['gpt-image-1', 'gpt-image-1-mini', 'flux-2-flash', 'flux-2-pro', 'flux-1-schnell', 'seedream-v4', 'imagen-4', 'nano-banana-pro', 'ideogram-v3-turbo', 'recraft-v4', 'grok-2-image', 'z-image-turbo'].map((m) => `<option value="${m}">`).join('')}</datalist>`)}
    ${row(ts('apiKey'), `<input class="text" id="ig-key" placeholder="${c.imageGen.keySet ? c.imageGen.apiKey : ts('keyOptionalProv')}" autocomplete="off" spellcheck="false"><input class="text" id="ig-url" placeholder="${ts('baseUrl')} — https://api.routeway.ai/v1" value="${esc(c.imageGen.baseUrl || '')}" spellcheck="false"><button class="btn sm" id="ig-test">${ts('test')}</button>`)}
    <div class="small gen-msg" id="ig-msg"></div>
    <h3>${ts('videoGen')}</h3><p class="sub" style="margin-top:-6px">${ts('videoGenDesc')}</p>
    ${row(ts('provider'), `<select class="text" id="vg-prov" style="max-width:220px">${opt('', ts('vgAuto'), vgcur)}${opt('openai', ts('vgVideosApi'), vgcur)}${opt('replicate', ts('vgPred'), vgcur)}${opt('fal', ts('vgQueue'), vgcur)}${provOpts(vgcur)}</select><input class="text" id="vg-model" list="vg-models" placeholder="${ts('modelId')} — sora-2, sora-2-pro …" value="${esc(c.videoGen.model || '')}" spellcheck="false"><datalist id="vg-models">${['sora-2', 'sora-2-pro', 'wan-video/wan-2.2-t2v-fast', 'fal-ai/minimax/hailuo-02/standard/text-to-video', 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video'].map((m) => `<option value="${m}">`).join('')}</datalist>`)}
    ${row(ts('apiKey'), `<input class="text" id="vg-key" placeholder="${c.videoGen.keySet ? c.videoGen.apiKey : ts('keyOptionalProv')}" autocomplete="off" spellcheck="false"><input class="text" id="vg-url" placeholder="${ts('baseUrl')} — https://api.openai.com/v1" value="${esc(c.videoGen.baseUrl || '')}" spellcheck="false"><button class="btn sm" id="vg-test">${ts('test')}</button>`)}
    <div class="small gen-msg" id="vg-msg"></div>`; })()}
    <h3>${ts('social')}</h3><p class="sub" style="margin-top:-6px">${ts('socialDesc')}</p>
    ${row('cookies', `<select class="text" id="ck-browser" style="max-width:160px"><option value="">—</option>${['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium'].map((b) => `<option value="${b}" ${c.cookiesBrowser === b ? 'selected' : ''}>${b}</option>`).join('')}</select><input class="text" id="ck-file" placeholder="C:\\Users\\you\\cookies.txt" value="${esc(c.cookiesFile || '')}" spellcheck="false">`)}
    <h3>${ts('persona')}</h3><p class="sub" style="margin-top:-6px">${ts('personaDesc')}</p>
    <textarea class="text" id="st-persona" rows="3" placeholder="${T4({ en: 'e.g. Alex, front-end dev, prefers React + Tailwind, short answers', fa: 'مثلاً: رضا، توسعه‌دهندهٔ فرانت‌اند، ترجیح: React + Tailwind، پاسخ کوتاه', ru: 'например: Алексей, фронтенд-разработчик, предпочитает React + Tailwind, короткие ответы', zh: '例如：小明，前端开发，偏好 React + Tailwind，回答简短' })}">${esc(c.persona || '')}</textarea>
    <h3>${ts('rules')}</h3><p class="sub" style="margin-top:-6px">${ts('rulesDesc')}</p>
    <textarea class="text" id="st-rules" rows="6" style="font-family:var(--mono);font-size:12.5px" placeholder="- ...">${esc(c.rules || '')}</textarea>
  </div>

  <div class="spage ${page === 'data' ? 'active' : ''}" data-p="data">
    ${row(ts('workspace'), `<input class="text" id="ws-dir" value="${esc(c.workspace || '')}" placeholder="${esc(c.workspaceDir)}" spellcheck="false">${desktop ? `<button class="btn sm" id="ws-pick">…</button><button class="btn sm" id="ws-open">${ico('external')}</button>` : ''}`)}
    ${row(ts('dataDir'), `<span class="small mono" style="flex:1;direction:ltr">${esc(c.dataDir)}</span>${desktop ? `<button class="btn sm" id="data-open">${ico('external')}</button>` : ''}`)}
    <h3>${ts('stats')}</h3>
    <div class="form-row" id="st-stats"><span class="pill">…</span></div>
    <h3>Backup</h3>
    <div class="form-row" style="gap:8px"><button class="btn" id="st-export">${ico('download')}${ts('exportChat')}</button><button class="btn" id="st-export-all">${ico('download')}${ts('exportAll')}</button><button class="btn" id="st-import">${ico('undo')}${ts('importAll')}</button><input type="file" id="st-import-file" accept=".json" hidden></div>
    <div class="form-row"><button class="btn danger" id="st-clear">${ico('trash')}${ts('clearAll')}</button></div>
  </div>

  <div class="spage ${page === 'updates' ? 'active' : ''}" data-p="updates">
    ${row(ts('version'), `<span class="pill">${tu('installed')}: <b>${esc(c.version || '')}</b></span> <span class="pill" id="upd-latest">${tu('latest')}: …</span>`)}
    ${row(tu('channel'), `<span class="small mono" id="upd-channel">…</span>`)}
    ${row(ts('autoUpdate'), sw('st-autoupd', c.autoUpdate !== false), tu('autoDesc'))}
    ${row(tu('autoDownload'), sw('st-autodl', c.autoDownload !== false), tu('autoDlDesc'))}
    <div class="form-row upd-actions"><button class="btn" id="upd-check">${ico('refresh')}${tu('check')}</button><button class="btn btn-primary hidden" id="upd-dl">${ico('download')}${tu('updateNow')}</button><button class="btn hidden" id="upd-cancel">${tu('cancel')}</button><button class="btn btn-primary hidden" id="upd-retry">${tu('retry')}</button><button class="btn btn-primary hidden" id="upd-apply">${ico('rocket')}${tu('restart')}</button></div>
    <div class="form-row upd-status"><span class="small" id="upd-msg"></span><progress id="upd-prog" class="hidden" max="100" value="0"></progress></div>
    <div class="form-row"><span id="upd-last" class="small hidden"></span></div>
    <div id="upd-notes" class="upd-notes hidden"></div>
    <p class="small" style="color:var(--fg-3);margin:4px 0 10px;line-height:1.55">${esc(tu('howItWorks'))}</p>
    ${row(tu('cloud'), `<span class="cloud-dot" id="cloud-dot2"></span><span id="cloud-state2">…</span>`)}
    ${c.app && c.app.repo ? row('GitHub', `<a href="https://github.com/${esc(c.app.repo)}" target="_blank" rel="noopener" class="small mono">github.com/${esc(c.app.repo)}</a> <span class="small">— ${ts('github')}</span>`) : ''}
  </div>

  <div class="spage ${page === 'mcp' ? 'active' : ''}" data-p="mcp">
    <p class="sub" style="margin-top:-4px">${ts('mcpDesc')}</p>
    <div id="mcp-presets"><span class="small">${({ fa: 'پرسِت‌های آماده — یک کلیک، فرم پر شده:', en: 'Ready presets — one click fills the form:', ru: 'Готовые пресеты — один клик заполняет форму:', zh: '现成预设——一键填充表单：' })[lang] || 'Ready presets — one click fills the form:'}</span><div class="mcp-chips">${MCP_PRESETS.map((x) => `<button class="chip" data-p="${x.id}">${esc(x.label)}</button>`).join('')}</div></div>
    <div id="mcp-box"><span class="small">…</span></div>
    <div class="form-row" style="gap:8px"><button class="btn" id="mcp-add">${ico('plus')}${ts('mcpAdd')}</button><button class="btn" id="mcp-add-json">${ico('code')}${ts('mcpPaste')}</button></div>
    <div id="mcp-form" class="hidden"></div>
  </div>
  </div>

  <div class="st-foot"><button class="btn" id="st-cancel">${T4({ en: 'Close', fa: 'بستن', ru: 'Закрыть', zh: '关闭' })}</button><button class="btn primary" id="st-save">${ico('check')}${t('save')}</button></div>`);
  $('#modal-body').classList.add('st-body');

  // tabs
  $$('#st-tabs button').forEach((b) => (b.onclick = () => { $$('#st-tabs button').forEach((x) => x.classList.toggle('active', x === b)); $$('.spage').forEach((x) => x.classList.toggle('active', x.dataset.p === b.dataset.p)); }));
  $('#mcp-add').onclick = () => mcpShowForm(false);
  $('#mcp-add-json').onclick = () => mcpShowForm(true);
  if (page === 'mcp') loadMcpSettings();
  const segClick = (id, fn) => $$('#' + id + ' button').forEach((b) => (b.onclick = () => { $$('#' + id + ' button').forEach((x) => x.classList.toggle('active', x === b)); fn(b.dataset.v); }));
  const swClick = (id, fn) => { const s = $('#' + id); s.onclick = () => { const on = s.classList.toggle('on'); s.setAttribute('aria-checked', on); fn(on); }; };
  // updates + cloud status — state shared with the banner (see updBanner / paintUpdSettings)
  api('/api/update').then((u) => updBanner(u)).catch(() => {});
  if ($('#upd-check')) $('#upd-check').onclick = async () => { $('#upd-msg').textContent = tu('checking'); const u = await api('/api/update?force=1'); updBanner(u); if (!u.available && !u.error) toast(tu('upToDate'), 'ok'); };
  if ($('#upd-dl')) $('#upd-dl').onclick = updActions.download;
  if ($('#upd-cancel')) $('#upd-cancel').onclick = updActions.cancel;
  if ($('#upd-retry')) $('#upd-retry').onclick = updActions.retry;
  if ($('#upd-apply')) $('#upd-apply').onclick = updActions.apply;
  if ($('#st-autodl')) swClick('st-autodl', (on) => api('/api/config', { method: 'POST', body: { autoDownload: on } }));
  if ($('#st-autoupd')) swClick('st-autoupd', (on) => api('/api/config', { method: 'POST', body: { autoUpdate: on } }));
  // general
  segClick('st-lang', async (v) => { await setLang(v); openSettings('general'); });
  segClick('st-sendkey', (v) => { P.sendKey = v; applyPrefs(); });
  swClick('st-reason', (v) => { P.showReasoning = v; applyPrefs(); });
  swClick('st-notif', (v) => { P.notifications = v; applyPrefs(); if (v && Notification.permission === 'default') Notification.requestPermission(); });
  swClick('st-sound', (v) => { P.sound = v; applyPrefs(); if (v) beep(); });
  // appearance
  segClick('st-theme', (v) => { P.theme = v; applyPrefs(); });
  $$('#st-accent .sw').forEach((s) => (s.onclick = () => { $$('#st-accent .sw').forEach((x) => x.classList.toggle('on', x === s)); P.accent = s.dataset.a; applyPrefs(); }));
  $('#st-fs').oninput = (e) => { P.fontSize = +e.target.value; $('#st-fs-v').textContent = P.fontSize + 'px'; applyPrefs(); };
  segClick('st-density', (v) => { P.density = v; applyPrefs(); });
  // models & providers
  $$('#model-list .test').forEach((b) => (b.onclick = async () => { const rowEl = b.closest('.model-row'); const res = $('.test-res', rowEl); res.textContent = '…'; res.className = 'pill test-res'; const r = await api('/api/models/test', { method: 'POST', body: { key: rowEl.dataset.key } }); res.textContent = r.ok ? `✓ ${r.ms} ms` : `✗ ${(r.error || '').slice(0, 60)}`; res.classList.add(r.ok ? 'ok' : 'err'); }));
  $$('#model-list .del').forEach((b) => (b.onclick = async () => { const key = b.closest('.model-row').dataset.key; const [pid, ...rest] = key.split('/'); const mid = rest.join('/'); const pv = c.providers[pid]; if (pv) { await api('/api/config', { method: 'POST', body: { providers: { [pid]: { models: (pv.models || []).filter((m) => m.id !== mid) } } } }); } else await api('/api/config', { method: 'POST', body: { customModels: c.customModels.filter((m) => m.key !== key) } }); await loadConfig(); openSettings('models'); }));
  $$('#prov-list .del').forEach((b) => (b.onclick = async () => { const id = b.closest('.prov-row').dataset.id; if (!confirm(ts('removeProviderConfirm'))) return; await api('/api/config', { method: 'POST', body: { providers: { [id]: null } } }); await loadConfig(); openSettings('models'); }));
  $$('#prov-list .edit').forEach((b) => (b.onclick = () => providerEditor(b.closest('.prov-row').dataset.id)));
  $('#prov-add').onclick = () => providerEditor(null);
  paintVault();
  // agent
  let autoV = c.autonomy, effortV = c.reasoningEffort || 'medium';
  segClick('st-auto', (v) => (autoV = v)); segClick('st-effort', (v) => (effortV = v));
  $('#temp').oninput = (e) => ($('#temp-v').textContent = e.target.value);
  // data
  if ($('#ws-pick')) $('#ws-pick').onclick = async () => { const p = await desktop.chooseFolder(); if (p) $('#ws-dir').value = p; };
  if ($('#ws-open')) $('#ws-open').onclick = () => desktop.openPath($('#ws-dir').value || c.workspaceDir);
  if ($('#data-open')) $('#data-open').onclick = () => desktop.openPath(c.dataDir);
  api('/api/stats').then((s) => { $('#st-stats').innerHTML = `<span class="pill">${s.chats} ${ts('statChats')}</span><span class="pill">${s.messages} ${ts('statMsgs')}</span><span class="pill">${s.checkpoints} ${ts('statCk')}</span><span class="pill">${fmtB(s.bytes || 0)}</span>`; }).catch(() => {});
  $('#st-export').onclick = async () => { if (!S.chat) return toast('—'); const r = await fetch('/api/chats/' + S.chat.id + '/export', { headers: authHdr() }); dl((S.chat.title || 'orca-chat').replace(/[\\/:*?"<>|]/g, '_') + '.md', await r.text()); toast(t('exported'), 'ok'); };
  $('#st-export-all').onclick = async () => { const r = await fetch('/api/backup', { headers: authHdr() }); dl('orca-backup-' + new Date().toISOString().slice(0, 10) + '.json', await r.text()); toast(t('exported'), 'ok'); };
  $('#st-import').onclick = () => $('#st-import-file').click();
  $('#st-import-file').onchange = async () => { const f = $('#st-import-file').files[0]; if (!f) return; try { const data = JSON.parse(await f.text()); const r = await api('/api/backup', { method: 'POST', body: data }); toast(`+${r.imported}`, 'ok'); loadChats(); } catch (e) { toast(e.message, 'err'); } };
  $('#st-clear').onclick = async () => { if (!confirm(ts('clearConfirm'))) return; await api('/api/chats/all', { method: 'DELETE' }); newChat(); loadChats(); closeModal(); };
  $('#st-cancel').onclick = closeModal;
  const genTest = (kind) => async () => {
    const P = kind === 'image' ? 'ig' : 'vg'; const b = $(`#${P}-test`), m = $(`#${P}-msg`); if (!b || !m) return;
    b.disabled = true; m.textContent = ts('testing') + (kind === 'video' ? ' — ' + ts('genVideoWait') : '');
    const body = { kind, provider: $(`#${P}-prov`).value, model: $(`#${P}-model`).value.trim(), baseUrl: $(`#${P}-url`).value.trim() }; if ($(`#${P}-key`).value.trim()) body.apiKey = $(`#${P}-key`).value.trim();
    let r; try { r = await api('/api/gen/test', { method: 'POST', body }); } catch (e) { r = { error: e.message }; }
    b.disabled = false;
    if (r.ok) { m.innerHTML = `✓ ${esc(r.provider)}${r.model ? ' · ' + esc(r.model) : ''} · ${r.ms} ms · <a href="#" data-open="${esc(r.file)}">${esc(r.file)}</a>${r.note ? `<br><span class="small">${esc(r.note)}</span>` : ''}`; const a = $('a[data-open]', m); if (a) a.onclick = (e) => { e.preventDefault(); previewFile(a.dataset.open); }; }
    else m.textContent = `✗ ${(r.error || 'failed').slice(0, 220)}${r.hint ? ' — ' + r.hint : ''}`;
  };
  if ($('#ig-test')) $('#ig-test').onclick = genTest('image');
  if ($('#vg-test')) $('#vg-test').onclick = genTest('video');
  $('#jg-test').onclick = async () => { const b = $('#jg-test'), m = $('#jg-msg'); b.disabled = true; m.textContent = ts('testing'); const body = { baseUrl: $('#jg-url').value.trim(), model: $('#jg-model').value.trim() }; if ($('#jg-key').value.trim()) body.apiKey = $('#jg-key').value.trim(); const r = await api('/api/judge/test', { method: 'POST', body }); b.disabled = false; m.textContent = r.ok ? `✓ ${ts('judgeTested')} · ${r.ms} ms · ${r.model} · ${r.sample}` : `✗ ${ts('judgeTestFail')}: ${(r.error || '').slice(0, 120)}`; };
  $('#st-save').onclick = async () => {
    const keys = {}; $$('input[data-key]').forEach((i) => { if (i.value.trim()) keys[i.dataset.key] = i.value.trim(); });
    const vision = { provider: $('#vs-prov').value, model: $('#vs-model').value.trim(), baseUrl: $('#vs-url').value.trim() }; if ($('#vs-key').value.trim()) vision.apiKey = $('#vs-key').value.trim();
    const imageGen = { provider: $('#ig-prov').value, model: $('#ig-model').value.trim(), baseUrl: $('#ig-url').value.trim() }; if ($('#ig-key').value.trim()) imageGen.apiKey = $('#ig-key').value.trim();
    const videoGen = { provider: $('#vg-prov').value, model: $('#vg-model').value.trim(), baseUrl: $('#vg-url').value.trim() }; if ($('#vg-key').value.trim()) videoGen.apiKey = $('#vg-key').value.trim();
    const judge = { enabled: $('#jg-on').checked, baseUrl: $('#jg-url').value.trim(), model: $('#jg-model').value.trim() }; if ($('#jg-key').value.trim()) judge.apiKey = $('#jg-key').value.trim();
    await api('/api/config', { method: 'POST', body: { keys, defaultModel: $('#st-default').value, workspace: $('#ws-dir').value.trim(), maxSteps: +$('#max-steps').value || 40, temperature: +$('#temp').value, shellTimeout: +$('#shell-to').value || 120, autonomy: autoV, reasoningEffort: effortV, persona: $('#st-persona').value, rules: $('#st-rules').value, theme: P.theme, accent: P.accent, fontSize: P.fontSize, density: P.density, lang, vision, imageGen, videoGen, judge, cookiesBrowser: $('#ck-browser').value, cookiesFile: $('#ck-file').value.trim() } });
    await loadConfig(); toast(t('saved'), 'ok'); closeModal();
  };
}

// ───────────────────────── command palette ─────────────────────────
const cmdk = $('#cmdk'), cmdkIn = $('#cmdk-input'), cmdkList = $('#cmdk-list');
let ckSel = 0, ckItems = [];
function cmdActions() {
  return [
    { ico: 'plus', label: t('newChat'), sub: 'Ctrl N', run: newChat },
    { ico: 'settings', label: t('settings'), sub: 'Ctrl ,', run: () => openSettings() },
    { ico: 'sun', label: ts('appearance'), run: () => openSettings('appearance') },
    { ico: 'code', label: ts('models'), run: () => openSettings('models') },
    { ico: 'brain', label: t('memory'), run: () => $('#open-memory').click() },
    { ico: 'trophy', label: t('leaderboard'), run: () => $('#open-leaderboard').click() },
    { ico: 'moon', label: t('theme') + ' ↔', sub: 'Ctrl Shift L', run: () => $('#tb-theme').click() },
    { ico: 'panel-r', label: t('tabFiles'), sub: 'Ctrl .', run: () => { openPanel(); showTab('files'); } },
    { ico: 'code', label: t('tabChanges'), run: () => { openPanel(); showTab('changes'); } },
    { ico: 'plan', label: t('plan') + (S.planMode ? ' ✓' : ''), run: () => $('#plan-toggle').click() },
    { ico: 'chat', label: t('modeDirect'), run: () => $('[data-mode="direct"]').click() },
    { ico: 'compare', label: t('modeSide'), run: () => $('[data-mode="side"]').click() },
    { ico: 'swords', label: t('modeBattle'), run: () => $('[data-mode="battle"]').click() },
    { ico: 'download', label: ts('exportChat'), run: async () => { if (!S.chat) return; const r = await fetch('/api/chats/' + S.chat.id + '/export', { headers: authHdr() }); dl('orca-chat.md', await r.text()); } },
    { ico: 'question', label: t('help'), sub: 'F1', run: () => showHelp() },
    { ico: 'keyboard', label: t('shortcuts'), sub: 'Ctrl /', run: showShortcuts },
    { ico: 'brain', label: '/init — ORCA.md', run: () => { $('#input').value = '/init'; send(); } },
    { ico: 'refresh', label: '/compact', run: () => { $('#input').value = '/compact'; send(); } },
    { ico: 'download', label: ({ fa: 'دانلود از اینستاگرام/تیک‌تاک/X', ru: 'Скачать из Instagram/TikTok/X', zh: '从 Instagram/TikTok/X 下载' })[lang] || 'Download from Instagram/TikTok/X', run: () => { $('#input').value = ({ fa: 'این لینک رو دانلود کن: ', ru: 'Скачай эту ссылку: ', zh: '下载这个链接：' })[lang] || 'Download this link: '; $('#input').focus(); } },
  ];
}
function showHelp(section) {
  const L = lang; const T = (o) => o[L] || o.en;
  const slash = Object.entries(SLASH_D).map(([k, d]) => `<div><kbd>/${k}</kbd><span>${esc(d[L] || d.en)}</span></div>`).join('');
  const modes = [
    ['chat', { en: 'Chat — one model answers; the agent may read files, search the web and run tools when it helps.', fa: 'گفتگو — یک مدل پاسخ می‌دهد؛ در صورت نیاز فایل می‌خواند، وب را جست‌وجو می‌کند و ابزار اجرا می‌کند.', ru: 'Чат — отвечает одна модель; при необходимости читает файлы, ищет в вебе и запускает инструменты.', zh: '聊天 — 一个模型回答；需要时读取文件、搜索网络并运行工具。' }],
    ['compare', { en: 'Compare — two models answer side by side; pick the winner and the leaderboard learns your taste.', fa: 'مقایسه — دو مدل هم‌زمان پاسخ می‌دهند؛ برنده را انتخاب کنید تا رتبه‌بندی سلیقهٔ شما را یاد بگیرد.', ru: 'Сравнение — две модели отвечают рядом; выберите победителя, и рейтинг подстроится под вас.', zh: '对比 — 两个模型并排回答；选出优胜者，排行榜会学习你的偏好。' }],
    ['plan', { en: 'Plan — the agent only plans (no files are touched) until you say “execute”.', fa: 'نقشه — فقط برنامه می‌دهد و به فایل‌ها دست نمی‌زند تا بگویید «اجرا کن».', ru: 'План — агент только планирует, ничего не меняя, пока вы не скажете «выполни».', zh: '计划 — 只做计划、不动文件，直到你说“执行”。' }],
    ['web', { en: 'Web — research mode: multi-source search, page reading and citations. Turns itself on for questions that need live information.', fa: 'وب — حالت پژوهش: جست‌وجوی چندمنبعی، خواندن صفحه‌ها و ارجاع. برای سوال‌هایی که اطلاعات زنده می‌خواهند خودکار روشن می‌شود.', ru: 'Веб — режим исследования: поиск по нескольким источникам, чтение страниц, ссылки. Включается сам для вопросов о текущих событиях.', zh: '网页 — 研究模式：多源搜索、读取页面并给出引用。需要实时信息的问题会自动开启。' }],
  ].map(([k, d]) => `<li><b>${k}</b> ${esc(T(d))}</li>`).join('');
  const auton = T({
    en: '<b>Autonomy</b> (toolbar): <i>Ask</i> confirms every risky action · <i>Auto</i> runs safe steps and asks before deleting, installing, or spending money · <i>Full</i> never asks. The decision engine (Settings → Agent) adds a calibrated second opinion on risk and routing when enabled.',
    fa: '<b>خودمختاری</b> (نوار بالا): <i>Ask</i> برای هر کار پرریسک اجازه می‌گیرد · <i>Auto</i> کارهای امن را خودش انجام می‌دهد و پیش از حذف، نصب یا هزینه می‌پرسد · <i>Full</i> هیچ‌وقت نمی‌پرسد. موتور تصمیم (تنظیمات → عامل) در صورت فعال‌بودن، نظر دومِ کالیبره‌شده دربارهٔ ریسک و مسیریابی می‌دهد.',
    ru: '<b>Автономность</b> (панель): <i>Ask</i> подтверждает каждое рискованное действие · <i>Auto</i> выполняет безопасные шаги и спрашивает перед удалением, установкой или тратами · <i>Full</i> не спрашивает никогда. Движок решений (Настройки → Агент) добавляет калиброванное второе мнение о риске и маршрутизации.',
    zh: '<b>自主级别</b>（工具栏）：<i>Ask</i> 每个高风险操作都确认 · <i>Auto</i> 自动执行安全步骤，删除、安装或花钱前询问 · <i>Full</i> 从不询问。决策引擎（设置 → 代理）开启后会对风险和路由提供校准的第二意见。',
  });
  const sites = T({
    en: '<b>Building sites & apps</b>: describe what you want (“a landing page for a café with menu and booking form”). The agent scaffolds the project, writes the files and opens a <b>live preview</b> in the right panel — switch between phone, tablet, desktop and full-window, rotate, reload, or open it in your browser. Every file change is a checkpoint you can restore from the Changes tab.',
    fa: '<b>ساخت سایت و اپ</b>: بگویید چه می‌خواهید («لندینگ کافه با منو و فرم رزرو»). عامل پروژه را می‌سازد، فایل‌ها را می‌نویسد و <b>پیش‌نمایش زنده</b> را در پنل راست باز می‌کند — بین موبایل، تبلت، کامپیوتر و تمام‌صفحه جابه‌جا شوید، بچرخانید، رفرش کنید یا در مرورگر باز کنید. هر تغییر فایل یک نقطهٔ بازگشت است (تب تغییرات).',
    ru: '<b>Сайты и приложения</b>: опишите, что нужно («лендинг кафе с меню и формой брони»). Агент создаст проект, напишет файлы и откроет <b>живой предпросмотр</b> в правой панели — телефон, планшет, компьютер, во весь экран, поворот, обновление или открытие в браузере. Каждое изменение файла — контрольная точка во вкладке «Изменения».',
    zh: '<b>构建网站与应用</b>：描述需求（“带菜单和预订表单的咖啡馆落地页”）。代理会搭建项目、写入文件，并在右侧面板打开<b>实时预览</b> — 可切换手机/平板/电脑/全屏、旋转、刷新或在浏览器中打开。每次文件改动都是可从“更改”标签恢复的检查点。',
  });
  const procsHelp = T({
    en: '<b>Bots & servers</b>: “build a Telegram bot” is built first — a complete project with defaults — and only then are you asked for the one thing that is really needed (the token). Once you paste it, the bot starts as a <b>background process</b>: it keeps running while ORCA is open, its log and detected ports are in the <b>Processes</b> tab of the right panel, and a Stop button ends it. Dev servers and workers work the same way.',
    fa: '<b>ربات‌ها و سرورها</b>: «ربات تلگرام بساز» اول ساخته می‌شود — یک پروژهٔ کامل با پیش‌فرض‌های منطقی — و فقط بعد از آن، تنها چیزی که واقعاً لازم است (توکن) پرسیده می‌شود. توکن را که بچسبانید، ربات به‌صورت <b>پردازش پس‌زمینه</b> اجرا می‌شود: تا وقتی ORCA باز است زنده می‌ماند، لاگ و پورت‌هایش در تب <b>پردازش‌ها</b>ی پنل راست است و دکمهٔ توقف دارد. سرورهای توسعه و worker ها هم همین‌طور.',
    ru: '<b>Боты и серверы</b>: «сделай телеграм-бота» сначала строится — полный проект с разумными значениями по умолчанию — и только потом спрашивается единственное необходимое (токен). После вставки бот запускается как <b>фоновый процесс</b>: работает, пока открыта ORCA, лог и порты — во вкладке <b>Процессы</b> правой панели, есть кнопка Стоп. Dev-серверы и воркеры — так же.',
    zh: '<b>机器人与服务器</b>：“做一个 Telegram 机器人”会先被构建 — 带默认配置的完整项目 — 然后才会询问真正需要的那一件事（令牌）。粘贴后机器人作为<b>后台进程</b>运行：ORCA 打开期间保持运行，日志和端口在右侧面板的<b>进程</b>标签中，并有停止按钮。开发服务器和 worker 同理。',
  });
  const models = T({
    en: '<b>Models</b>: built-in models work out of the box and rotate automatically when one is busy. Add your own provider in Settings → Models (any OpenAI-compatible or Anthropic endpoint; the catalog knows 200+ providers) — your keys stay on this machine.',
    fa: '<b>مدل‌ها</b>: مدل‌های داخلی بدون تنظیم کار می‌کنند و وقتی یکی شلوغ است خودکار جابه‌جا می‌شوند. ارائه‌دهندهٔ خودتان را در تنظیمات → مدل‌ها اضافه کنید (هر endpoint سازگار با OpenAI یا Anthropic؛ کاتالوگ ۲۰۰+ ارائه‌دهنده را می‌شناسد) — کلیدها فقط روی همین دستگاه می‌مانند.',
    ru: '<b>Модели</b>: встроенные модели работают сразу и переключаются, когда одна занята. Свой провайдер — в Настройки → Модели (любой OpenAI-совместимый или Anthropic endpoint; каталог знает 200+ провайдеров) — ключи остаются на этом компьютере.',
    zh: '<b>模型</b>：内置模型开箱即用，繁忙时自动轮换。在 设置 → 模型 添加自己的提供商（任何 OpenAI 兼容或 Anthropic 端点；目录收录 200+ 提供商）— 密钥只保存在本机。',
  });
  const upd = T({ en: '<b>Updates</b>: ORCA checks the release channel on start and every few hours. A new version is downloaded in the background (resumable; mirrors when GitHub is blocked), verified against its SHA-256, and installed when you press <b>Restart & install</b> — Windows and Linux swap the app folder, macOS replaces the app bundle, AppImages replace themselves. Nothing to download by hand, no GitHub visit; your chats, files and keys are untouched. Settings → Updates shows the state, the release notes and the switches.', fa: '<b>به‌روزرسانی</b>: ORCA هنگام شروع و هر چند ساعت کانال انتشار را بررسی می‌کند. نسخهٔ جدید در پس‌زمینه دانلود می‌شود (قابل ادامه؛ اگر GitHub مسدود باشد از آینه‌ها)، با SHA-256 تأیید می‌شود و با زدن <b>راه‌اندازی مجدد و نصب</b> نصب می‌شود — در ویندوز و لینوکس پوشهٔ برنامه جایگزین می‌شود، در مک بستهٔ برنامه، و AppImage خودش را جایگزین می‌کند. نه دانلود دستی، نه رفتن به GitHub؛ گفتگوها، فایل‌ها و کلیدها دست نمی‌خورند. تنظیمات → به‌روزرسانی وضعیت، تازه‌ها و کلیدها را نشان می‌دهد.', ru: '<b>Обновления</b>: ORCA проверяет канал релизов при запуске и каждые несколько часов. Новая версия скачивается в фоне (с докачкой; через зеркала, если GitHub заблокирован), проверяется по SHA-256 и устанавливается по нажатию <b>Перезапустить и установить</b> — Windows и Linux заменяют папку приложения, macOS — бандл, AppImage заменяет сам себя. Ничего не нужно скачивать вручную и заходить на GitHub; чаты, файлы и ключи не затрагиваются. Настройки → Обновления показывают состояние, список изменений и переключатели.', zh: '<b>更新</b>：ORCA 在启动时和每隔几小时检查发布渠道。新版本在后台下载（支持断点续传；GitHub 被屏蔽时走镜像），用 SHA-256 校验，按下<b>重启并安装</b>后安装 — Windows 和 Linux 替换应用文件夹，macOS 替换应用包，AppImage 自我替换。无需手动下载，无需访问 GitHub；对话、文件和密钥不受影响。设置 → 更新显示状态、更新内容和开关。' });
  const links = `<a class="btn" href="https://github.com/Nethyric/orca#readme" target="_blank" rel="noopener">${ico('external')} README</a> <a class="btn" href="https://github.com/Nethyric/orca/blob/main/docs/setup.md" target="_blank" rel="noopener">${ico('external')} ${T({ en: 'Setup guide', fa: 'راهنمای نصب', ru: 'Установка', zh: '安装指南' })}</a> <a class="btn" href="https://github.com/Nethyric/orca/blob/main/docs/api.md" target="_blank" rel="noopener">${ico('external')} API</a> <a class="btn" href="https://github.com/Nethyric/orca/issues" target="_blank" rel="noopener">${ico('external')} ${T({ en: 'Report a problem', fa: 'گزارش مشکل', ru: 'Сообщить о проблеме', zh: '报告问题' })}</a>`;
  const tabs = [['start', T({ en: 'Getting started', fa: 'شروع', ru: 'Начало', zh: '入门' })], ['modes', T({ en: 'Modes & autonomy', fa: 'حالت‌ها و خودمختاری', ru: 'Режимы', zh: '模式' })], ['cmds', T({ en: 'Commands & shortcuts', fa: 'دستورها و میان‌برها', ru: 'Команды', zh: '命令' })], ['about', T({ en: 'About', fa: 'درباره', ru: 'О программе', zh: '关于' })]];
  const cur = section || 'start';
  const pages = {
    start: `<p>${esc(T({ en: 'ORCA is an autonomous agent: it reads and writes files in your workspace, runs commands, searches the web, understands images and builds whole projects — while you watch every step in the timeline.', fa: 'ORCA یک عامل خودمختار است: در فضای کاری شما فایل می‌خواند و می‌نویسد، دستور اجرا می‌کند، وب را جست‌وجو می‌کند، تصویر می‌فهمد و پروژه‌های کامل می‌سازد — و شما هر قدم را در تایم‌لاین می‌بینید.', ru: 'ORCA — автономный агент: читает и пишет файлы в рабочей папке, выполняет команды, ищет в вебе, понимает изображения и собирает целые проекты — а вы видите каждый шаг в таймлайне.', zh: 'ORCA 是自主代理：在工作区读写文件、运行命令、搜索网络、理解图片并构建完整项目 — 每一步都显示在时间线中。' }))}</p><ol class="help-steps"><li>${esc(T({ en: 'Pick a workspace folder (top bar) — everything the agent creates lands there.', fa: 'پوشهٔ فضای کاری را انتخاب کنید (نوار بالا) — هر چیزی که عامل می‌سازد آن‌جا می‌رود.', ru: 'Выберите рабочую папку (верхняя панель) — всё созданное агентом попадает туда.', zh: '选择工作区文件夹（顶栏）— 代理创建的一切都放在那里。' }))}</li><li>${esc(T({ en: 'Type what you want in plain language; attach files or images with the clip. Shift+Enter makes a new line.', fa: 'خواسته‌تان را به زبان ساده بنویسید؛ با گیره فایل یا عکس پیوست کنید. Shift+Enter خط جدید می‌سازد.', ru: 'Опишите задачу своими словами; файлы и картинки — через скрепку. Shift+Enter — новая строка.', zh: '用自然语言描述需求；用回形针附加文件或图片。Shift+Enter 换行。' }))}</li><li>${esc(T({ en: 'Watch the right panel: Timeline (tools), Files, Changes (restore any edit), Preview (live site) and Notes.', fa: 'پنل راست را ببینید: تایم‌لاین (ابزارها)، فایل‌ها، تغییرات (بازگردانی هر ویرایش)، پیش‌نمایش (سایت زنده) و یادداشت‌ها.', ru: 'Следите за правой панелью: Таймлайн, Файлы, Изменения (откат любой правки), Предпросмотр и Заметки.', zh: '关注右侧面板：时间线（工具）、文件、更改（可恢复任何编辑）、预览（实时站点）和笔记。' }))}</li></ol><p>${sites}</p><p>${procsHelp}</p><p>${models}</p>`,
    modes: `<ul class="help-list">${modes}</ul><p>${auton}</p><p>${esc(T({ en: 'Tip: ask “what can you do?” — the answer reflects the real capabilities of this installation (connected models, vision, tools, platform binaries).', fa: 'نکته: بپرسید «چه کارهایی می‌توانی بکنی؟» — پاسخ بر اساس قابلیت‌های واقعی همین نصب است (مدل‌های وصل‌شده، بینایی، ابزارها، باینری‌ها).', ru: 'Совет: спросите «что ты умеешь?» — ответ отражает реальные возможности этой установки.', zh: '提示：问“你能做什么？”— 回答反映的是当前安装的真实能力（已连接模型、视觉、工具、平台程序）。' }))}</p>`,
    cmds: `<h3>${T({ en: 'Slash commands', fa: 'دستورهای اسلش', ru: 'Slash-команды', zh: '斜杠命令' })}</h3><div class="shortcut-grid">${slash}</div><h3>${t('shortcuts')}</h3><div class="shortcut-grid">${SHORTCUTS.map(([k, l]) => `<div><span>${t(l)}</span><kbd>${k}</kbd></div>`).join('')}<div><span>${t('inputPh').split('(')[0]}</span><kbd>Shift ↵</kbd></div><div><span>${T({ en: 'Leave full-window preview', fa: 'خروج از پیش‌نمایش تمام‌صفحه', ru: 'Выйти из полноэкранного предпросмотра', zh: '退出全屏预览' })}</span><kbd>Esc</kbd></div></div>`,
    about: `<p><b>ORCA</b> · ${esc(T({ en: 'version', fa: 'نسخه', ru: 'версия', zh: '版本' }))} ${esc(S.health?.version || '')} · ${esc(T({ en: 'made by', fa: 'ساختهٔ', ru: 'сделано', zh: '开发者' }))} <b>Nethyric</b></p><p>${upd}</p><p>${esc(T({ en: 'Privacy: chats, files and keys stay on this computer. Built-in model traffic goes directly from your machine to the provider; nothing is relayed through a middle server.', fa: 'حریم خصوصی: گفتگوها، فایل‌ها و کلیدها روی همین کامپیوتر می‌مانند. ترافیک مدل‌های داخلی مستقیم از دستگاه شما به ارائه‌دهنده می‌رود؛ هیچ سرور واسطی در کار نیست.', ru: 'Приватность: чаты, файлы и ключи остаются на этом компьютере. Трафик встроенных моделей идёт напрямую к провайдеру, без промежуточного сервера.', zh: '隐私：对话、文件和密钥保存在本机。内置模型流量直接从你的设备发往提供商，不经过中间服务器。' }))}</p><p class="help-links">${links}</p>`,
  };
  modal(`<div class="help"><h2>${ico('question')}${t('help')}</h2><div class="help-tabs">${tabs.map(([k, l]) => `<button class="${k === cur ? 'active' : ''}" data-h="${k}">${l}</button>`).join('')}</div><div class="help-page">${pages[cur]}</div></div>`);
  $$('.help-tabs button').forEach((b) => (b.onclick = () => showHelp(b.dataset.h)));
}
function showShortcuts() { modal(`<h2>${ico('keyboard')}${t('shortcuts')}</h2><div class="shortcut-grid">${SHORTCUTS.map(([k, l]) => `<div><span>${t(l)}</span><kbd>${k}</kbd></div>`).join('')}<div><span>${t('inputPh').split('(')[0]}</span><kbd>Shift ↵</kbd></div></div>`); }
function openCmdk() { cmdk.classList.remove('hidden'); cmdkIn.value = ''; renderCmdk(''); cmdkIn.focus(); }
const closeCmdk = () => cmdk.classList.add('hidden');
async function renderCmdk(q) {
  const ql = q.toLowerCase();
  const acts = cmdActions().filter((a) => !ql || a.label.toLowerCase().includes(ql));
  let chats = S.chats.filter((c) => !ql || c.title.toLowerCase().includes(ql)).slice(0, 8).map((c) => ({ ico: c.mode === 'battle' ? 'swords' : c.mode === 'side' ? 'compare' : 'chat', label: c.title, sub: groupLabel(c.updatedAt), run: () => openChat(c.id) }));
  if (ql.length > 2 && chats.length < 4) { try { const { hits } = await api('/api/search?q=' + encodeURIComponent(q)); for (const h of hits.slice(0, 6)) if (!chats.some((c) => c.label === h.title)) chats.push({ ico: 'search', label: h.title, sub: h.snippet.slice(0, 40), run: () => openChat(h.chatId, h.msgId) }); } catch (_) {} }
  ckItems = [...acts, ...chats]; ckSel = 0;
  cmdkList.innerHTML = (acts.length ? `<div class="ck-group">${t('actions')}</div>` : '') + acts.map((a, i) => `<div class="ck ${i === 0 ? 'sel' : ''}" data-i="${i}">${ico(a.ico)}<span dir="auto">${esc(a.label)}</span>${a.sub ? `<span class="ck-sub">${esc(a.sub)}</span>` : ''}</div>`).join('') + (chats.length ? `<div class="ck-group">${t('chats')}</div>` : '') + chats.map((a, i) => `<div class="ck" data-i="${acts.length + i}">${ico(a.ico)}<span dir="auto">${esc(a.label)}</span><span class="ck-sub">${esc(a.sub || '')}</span></div>`).join('');
  $$('.ck', cmdkList).forEach((d) => (d.onclick = () => { closeCmdk(); ckItems[+d.dataset.i].run(); }));
}
cmdkIn.oninput = () => renderCmdk(cmdkIn.value.trim());
cmdkIn.onkeydown = (e) => { const items = $$('.ck', cmdkList); if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ckSel = (ckSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((d, i) => d.classList.toggle('sel', i === ckSel)); items[ckSel]?.scrollIntoView({ block: 'nearest' }); } if (e.key === 'Enter') { const d = items[ckSel]; if (d) { closeCmdk(); ckItems[+d.dataset.i].run(); } } };
cmdk.onclick = (e) => { if (e.target.id === 'cmdk') closeCmdk(); };

document.onkeydown = (e) => {
  const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
  if (e.key === 'Escape') { if (!cmdk.classList.contains('hidden')) closeCmdk(); else if (!$('#modal').classList.contains('hidden')) closeModal(); else if (PV.full) setPreviewFull(false); else stopAll(); return; }
  if (mod && k === 'k') { e.preventDefault(); openCmdk(); }
  else if (mod && k === 'n') { e.preventDefault(); newChat(); }
  else if (mod && k === 'b') { e.preventDefault(); S._railUser = true; $('#rail').classList.toggle('collapsed'); }
  else if (mod && e.key === '.') { e.preventDefault(); togglePanel(); }
  else if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
  else if (mod && e.key === '/') { e.preventDefault(); showShortcuts(); }
  else if (e.key === 'F1') { e.preventDefault(); showHelp(); }
  else if (mod && e.shiftKey && k === 'l') { e.preventDefault(); $('#tb-theme').click(); }
  else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); $('#rail').classList.remove('collapsed'); $('#search').focus(); }
};

// ───────────────────────── titlebar / responsive ─────────────────────────
$$('[data-win]').forEach((b) => (b.onclick = () => desktop && desktop.win(b.dataset.win)));
async function setLang(v) { if (!I18N[v]) return; lang = v; applyLang(); await loadConfig(); api('/api/config', { method: 'POST', body: { lang } }); if (S.chat) openChat(S.chat.id); else renderChatList(S.chats); }
function fitLayout() {
  const w = window.innerWidth;
  if (w <= 1240) $('#rail').classList.add('collapsed'); else if (!S._railUser) $('#rail').classList.remove('collapsed');
  if (w <= 1060) { $('#panel').classList.add('collapsed'); $('#toggle-panel').classList.remove('active'); }
}
window.addEventListener('resize', () => { clearTimeout(S._rt); S._rt = setTimeout(fitLayout, 120); });
document.addEventListener('click', (e) => { if (window.innerWidth > 1240) return; if (!$('#rail').classList.contains('collapsed') && !e.target.closest('#rail') && !e.target.closest('#rail-toggle')) $('#rail').classList.add('collapsed'); }, true);

// ───────────────────────── boot ─────────────────────────
(async () => {
  applyLang(); fitLayout();
  await loadConfig();
  // server-side prefs win if present (synced across devices/data dir)
  const c = S.cfg; if (c.theme) { P.theme = c.theme; P.accent = c.accent || P.accent; P.fontSize = c.fontSize || P.fontSize; P.density = c.density || P.density; applyPrefs(); }
  // language: server config wins on first run of a fresh browser profile (desktop app = one profile)
  if (!localStorage.getItem('orca.lang') && c.lang && I18N[c.lang] && c.lang !== lang) { lang = c.lang; applyLang(); }
  await loadChats();
  connect();
  $('#input').focus();
  // update check (non-blocking): banner appears only when a newer release exists
  S.upd = { dismissed: S.cfg.dismissedUpdate || '' };
  setTimeout(async () => { try { const u = await api('/api/update'); if (u.lastInstall) { if (u.lastInstall.ok) toast(tu('installedOk')(u.lastInstall.version), 'ok'); else toast(tu('installedFail')(u.lastInstall.version) + (u.lastInstall.note ? ' — ' + u.lastInstall.note : ''), 'err'); } if (u.available && S.cfg.autoUpdate !== false && (S.cfg.dismissedUpdate !== u.latest || (u.download && u.download.ready))) { if (u.download && u.download.ready) S.upd.dismissed = ''; updBanner(u); } else S.upd = { ...(S.upd || {}), ...u }; } catch (_) {} }, 2500);
})();
// ───────────────────────── selection copy bar ─────────────────────────
// A floating Copy button over any selection in the thread: gives a reliable copy path even
// where the embed/iframe blocks the keyboard shortcut or the Clipboard API.
const selbar = el('div', 'selbar hidden'); selbar.id = 'selbar';
selbar.innerHTML = `<button id="selbar-copy">${ico('copy')}<span></span></button>`;
selbar.onmousedown = (e) => e.preventDefault(); // keep the selection alive while clicking the bar
document.body.appendChild(selbar);
$('#selbar-copy').onclick = () => copyFeedback(selbar._txt || getSelection().toString());
let _selT;
function updateSelbar() {
  const s = getSelection(); const txt = s && !s.isCollapsed ? s.toString() : '';
  const inThread = s && s.anchorNode && ($('#thread')?.contains(s.anchorNode) || $('#modal-body')?.contains(s.anchorNode));
  if (!txt || !inThread) { selbar.classList.add('hidden'); return; }
  const r = s.getRangeAt(0).getBoundingClientRect();
  if (!r || (!r.width && !r.height)) { selbar.classList.add('hidden'); return; }
  $('span', selbar).textContent = t('copy');
  selbar.classList.remove('hidden');
  const w = selbar.offsetWidth; const h = selbar.offsetHeight;
  selbar.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8) + 'px';
  selbar.style.top = (r.top - h - 8 < 46 ? r.bottom + 8 : r.top - h - 8) + 'px';
  selbar._txt = txt;
}
document.addEventListener('selectionchange', () => { clearTimeout(_selT); _selT = setTimeout(updateSelbar, 100); });
$('#thread').addEventListener('scroll', () => { if (!selbar.classList.contains('hidden')) updateSelbar(); });

window.ORCA = Object.assign(window.ORCA || {}, { previewFile, setPreviewFull, showHelp, openSettings, PV });
})();
