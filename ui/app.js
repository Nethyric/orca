/* ORCA UI v3 */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (name, cls = '') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const api = async (p, o = {}) => { const r = await fetch(p, { headers: { 'content-type': 'application/json' }, ...o, body: o.body ? JSON.stringify(o.body) : undefined }); return r.json(); };
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
  $('#tb-lang').textContent = LANGS.find(([k]) => k === lang)?.[1] || lang.toUpperCase();
  $('#tb-lang').dataset.tip = ts('lang');
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
    $('.ph-copy', head).onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(code.textContent); const s = $('span', e.currentTarget); s.textContent = t('copied'); setTimeout(() => (s.textContent = t('copy')), 1200); };
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
const modelOf = (key) => S.cfg?.models.find((x) => x.key === key);

// tooltips
const tip = $('#tip');
document.addEventListener('mouseover', (e) => { const b = e.target.closest('[data-tip]'); if (!b) { tip.classList.remove('show'); return; } tip.textContent = b.dataset.tip; const r = b.getBoundingClientRect(); tip.style.left = r.left + r.width / 2 + 'px'; tip.style.top = (r.bottom + 6) + 'px'; tip.classList.add('show'); });
document.addEventListener('mousedown', () => tip.classList.remove('show'));

// ───────────────────────── model pickers ─────────────────────────
function buildPicker(container, value, onChange) {
  container.innerHTML = '';
  const m = modelOf(value) || S.cfg.models[0];
  container.append(el('span', 'pk-dot'), el('span', 'pk-label', esc(m?.label || value)), el('span', 'pk-tier', m ? esc(t('tier')[m.tier] || '') : ''), el('span', 'pk-chev', ico('chev')));
  const sel = el('select');
  sel.innerHTML = S.cfg.models.map((x) => `<option value="${x.key}">${esc(x.label)} — ${esc(x.note?.[lang] || x.vendor || x.provider)}</option>`).join('');
  sel.value = m?.key || value;
  sel.onchange = () => { buildPicker(container, sel.value, onChange); onChange(sel.value); };
  container.appendChild(sel);
  container.value = sel.value;
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
function newChat() { S.chat = null; S.regenFrom = null; S.queue = []; renderQueue(); setBusy(false); refreshPins(); refreshNotes(); $('#messages').innerHTML = ''; $('#welcome').classList.remove('hidden'); $('#tb-title').textContent = ''; $('#tab-timeline').innerHTML = `<div class="empty">${t('emptyTimeline')}</div>`; $('#changes-list').innerHTML = ''; $('#chg-badge').classList.add('hidden'); renderChatList(S.chats); $('#input').focus(); }
$('#new-chat').onclick = newChat;

async function openChat(id, focusMsg) {
  const c = await api('/api/chats/' + id); if (c.error) return;
  S.chat = c; setMode(c.mode || 'direct');
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
  const cp = el('button', '', ico('copy') + t('copy')); cp.onclick = () => { navigator.clipboard.writeText(shown); toast(t('copied'), 'ok'); };
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
  const name = anon ? `${t(idx === 0 ? 'modelA' : 'modelB')} <span class="anon">?</span>` : `<img class="avatar" src="/assets/logo.png" alt="">${esc(m.model || info?.label || '')}`;
  lane.innerHTML = `<div class="lane-head"><span class="mname">${name}</span>${!anon && info?.vendor ? `<span class="vendor">${esc(info.vendor)}</span>` : ''}<span class="usage"></span></div>
    <details class="thought hidden"><summary>${ico('brain')}<span>${t('thoughts')}</span><span class="th-time"></span></summary><div class="th-body"></div></details>
    <div class="todos hidden"></div><div class="steps"></div><div class="content" dir="auto"></div><div class="outputs hidden"></div><div class="extra"></div>
    <div class="lane-foot"><button class="cp">${ico('copy')}${t('copy')}</button><button class="rg">${ico('refresh')}${t('regen')}</button><button class="pn${m.pinned ? ' on' : ''}">${ico('pin')}${m.pinned ? t('unpin') : t('pin')}</button><button class="fk">${ico('branch')}${t('fork')}</button><button class="ex">${ico('download')}.md</button><span class="meta"></span></div>`;
  if (m.pinned) lane.classList.add('pinned');
  $('.cp', lane).onclick = () => { navigator.clipboard.writeText(L_text(lane)); toast(t('copied'), 'ok'); };
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
const TOOL_ICO = { view_image: 'image', ocr_image: 'image', screenshot: 'image', social_download: 'download', social_trending: 'globe', generate_image: 'image', generate_video: 'play', glob: 'search', grep: 'search', todo_write: 'check', todo_read: 'check', diagnostics: 'shield', project_init: 'brain', task: 'sparkle', write_docx: 'file', read_docx: 'file', write_xlsx: 'file', read_xlsx: 'file', write_pptx: 'file', read_pdf: 'file', media_info: 'play', media_edit: 'play', media_concat: 'play', media_from_images: 'play', media_subtitles: 'play', run_shell: 'terminal', run_node: 'code', run_python: 'code', write_file: 'file', edit_file: 'edit', delete_file: 'trash', read_file: 'file', list_files: 'folder', search_files: 'search', web_search: 'globe', fetch_page: 'globe', http_request: 'globe', remember: 'brain', recall: 'brain', ask_user: 'question' };
const argOf = (d) => d.name === 'social_download' || d.name === 'view_image' || d.name === 'screenshot' ? (d.args.url || d.args.path || '') : d.name === 'social_trending' ? `${d.args.platform || 'tiktok'} ${d.args.query || d.args.region || ''}`.trim() : d.name === 'generate_image' || d.name === 'generate_video' ? String(d.args.prompt || '').slice(0, 90) : d.name === 'task' ? d.args.description : d.name === 'todo_write' ? `${(d.args.todos || []).length} items` : d.name === 'grep' || d.name === 'glob' ? d.args.pattern : d.args && (d.args.input || d.args.output) && /^media_/.test(d.name) ? `${d.args.operation || ''} ${d.args.input || ''}${d.args.output ? ' → ' + d.args.output : ''}`.trim() : d.args && d.args._truncated ? `${d.args.path || ''} ⚠ ${({ fa: 'خروجی مدل بریده شد — بخش سالم ذخیره و ادامه داده می‌شود', ru: 'вывод модели обрезан — сохранено, продолжаю', zh: '模型输出被截断 — 已保留可用部分，继续' })[lang] || 'model output cut — salvaged, continuing'}` : d.name === 'run_shell' ? d.args.command : d.name === 'web_search' ? d.args.query : d.name === 'fetch_page' || d.name === 'http_request' ? d.args.url : d.args.path || d.args.pattern || d.args.note || d.args.query || (d.args.code ? d.args.code.slice(0, 90) : JSON.stringify(d.args).slice(0, 90));
function addStep(steps, d) {
  const s = el('div', 'step run'); s.dataset.cid = d.id;
  s.innerHTML = `<span class="ico">${ico('refresh')}</span><span class="st-name">${esc(d.name)}</span><span class="st-arg">${esc(argOf(d) || '')}</span><span class="st-ms"></span><div class="st-out"></div>`;
  s.onclick = () => s.classList.toggle('open');
  $('.st-out', s).textContent = JSON.stringify(d.args, null, 2);
  steps.appendChild(s); return s;
}
function finishStep(s, d) {
  s.classList.remove('run'); s.classList.add(d.ok ? 'ok' : 'fail'); $('.ico', s).innerHTML = ico(d.ok ? 'check' : 'x'); $('.st-ms', s).textContent = d.ms != null ? d.ms + 'ms' : '';
  let pretty = d.result; try { const j = JSON.parse(d.result); pretty = j.error ? 'ERROR: ' + j.error : (j.output ?? j.content ?? j.text ?? (j.results ? j.results.map((r) => `• ${r.title}\n  ${r.url}\n  ${r.snippet || ''}`).join('\n') : JSON.stringify(j, null, 2))); } catch (_) {}
  $('.st-out', s).textContent = pretty;
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
  let card = $(`.sub[data-sub="${d.runId}"]`, steps);
  if (!card) { card = el('div', 'sub'); card.dataset.sub = d.runId; card.innerHTML = `<div class="sub-head">${ico('sparkle')}<span class="pill acc">${t('subagent')}</span><b dir="auto">${esc(d.description || '')}</b><span class="sub-n mono"></span></div><div class="sub-body"></div>`; card.onclick = () => card.classList.toggle('open'); steps.appendChild(card); }
  if (d.event === 'tool_call') { const b = $('.sub-body', card); b.appendChild(el('div', 'sub-step', `${ico(TOOL_ICO[d.data.name] || 'terminal')}<span class="mono">${esc(d.data.name)}</span><span class="st-arg">${esc(argOf(d.data) || '')}</span>`)); $('.sub-n', card).textContent = b.children.length; }
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
  for (const [k, lbl] of [['a', '👈 ' + t('voteA')], ['tie', '🤝 ' + t('tie')], ['both', '👎 ' + t('both')], ['b', t('voteB') + ' 👉']]) {
    const b = el('button', vote && vote.winner === k ? 'voted' : '', lbl); b.disabled = !!vote || !finished;
    b.onclick = async () => { await api('/api/chats/' + S.chat.id + '/vote', { method: 'POST', body: { runId: group[0].runId, a: group[0].model, b: group[1].model, winner: k } }); toast('🗳 ' + lbl, 'ok'); openChat(S.chat.id); };
    v.appendChild(b);
  }
  wrap.appendChild(v);
  if (vote || S.chat.mode !== 'battle') wrap.appendChild(el('div', 'reveal', `${t('revealed')} A = <b>${esc(group[0].model)}</b> · B = <b>${esc(group[1].model)}</b>`));
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
async function addFiles(files) {
  for (const f of files) {
    if (f.size > 40e6) { toast(f.name + ': >40MB', 'err'); continue; }
    const name = f.name || (isImg(f) ? 'pasted-' + Date.now() + '.png' : 'pasted.txt');
    if (isImg(f)) {
      const a = { name, kind: 'image', url: URL.createObjectURL(f), uploading: true }; S.attach.push(a); renderAttach();
      try { const r = await fetch('/api/upload?name=' + encodeURIComponent(name), { method: 'POST', body: f }); const j = await r.json(); if (j.error) throw new Error(j.error); a.path = j.path; a.analysis = j.analysis; a.uploading = false; if (!S._imgHintShown) { S._imgHintShown = true; if (!S.cfg?.visionOn) toast(t('imgHint')); } }
      catch (e) { toast(name + ': ' + e.message, 'err'); S.attach.splice(S.attach.indexOf(a), 1); }
      renderAttach();
    } else if (f.size > 2e6 || /\.(zip|exe|dll|mp4|mp3|mov|pdf|docx|xlsx|pptx|bin)$/i.test(name)) {
      // binary/big files go to the workspace so the agent can open them with its tools
      const a = { name, kind: 'file', uploading: true }; S.attach.push(a); renderAttach();
      try { const r = await fetch('/api/upload?name=' + encodeURIComponent(name), { method: 'POST', body: f }); const j = await r.json(); if (j.error) throw new Error(j.error); a.path = j.path; a.uploading = false; a.text = j.text || ''; }
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
$('#input').addEventListener('paste', async (e) => { const files = [...(e.clipboardData?.files || [])]; if (!files.length) return; e.preventDefault(); addFiles(files); });
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
  const sc = text.match(/^\/(plan|model|export|clear|files|new)\b\s*(.*)$/i);
  if (sc && textOverride == null) { $('#input').value = ''; autosize(); const c = sc[1].toLowerCase(); if (c === 'plan') $('#plan-toggle').click(); else if (c === 'model') { const k = sc[2].trim().toLowerCase(); const m = S.cfg.models.find((x) => x.key === k || x.label.toLowerCase().includes(k)); if (m) { buildPicker($('#pick-single'), m.key, (v) => api('/api/config', { method: 'POST', body: { defaultModel: v } })); api('/api/config', { method: 'POST', body: { defaultModel: m.key } }); toast(m.label, 'ok'); } else toast(S.cfg.models.map((x) => x.key).join(', ')); } else if (c === 'export') { if (S.chat) { const r = await fetch('/api/chats/' + S.chat.id + '/export'); dl('orca-chat.md', await r.text()); } } else if (c === 'clear' || c === 'new') newChat(); else if (c === 'files') { openPanel(); showTab('files'); } return; }
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
  const es = new EventSource('/api/events');
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

function updBanner(d) {
  S.upd = { ...(S.upd || {}), ...d };
  const u = S.upd; let bar = $('#upd-bar');
  if (u.dismissed === u.latest && !u.mustUpdate) return;
  if (!bar) { bar = el('div', 'upd-bar'); bar.id = 'upd-bar'; $('#main').prepend(bar); }
  bar.classList.toggle('must', !!u.mustUpdate);
  const dlst = u.download || {};
  let mid = '';
  if (dlst.ready) mid = `<b>${tu('ready')}</b><span class="sp"></span><button class="btn btn-primary" id="ub-apply">${tu('restart')}</button>`;
  else if (dlst.active) mid = `<span>${tu('downloading')}</span><progress max="100" value="${dlst.pct || 0}"></progress><span class="mono small">${dlst.pct || 0}%</span><span class="sp"></span>`;
  else if (dlst.error) mid = `<b>${tu('error')}</b><span class="small">${esc(dlst.error)}</span><span class="sp"></span><a class="btn" href="${esc(u.url || '#')}" target="_blank" rel="noopener">${tu('manual')}</a><button class="btn" id="ub-later">${tu('later')}</button>`;
  else mid = `<b>${tu('available')(u.latest)}</b>${u.mustUpdate ? `<span>${tu('must')}</span>` : ''}<span class="sp"></span>${u.asset !== false ? `<button class="btn btn-primary" id="ub-dl">${tu('download')}</button>` : ''}<a class="btn" href="${esc(u.url || '#')}" target="_blank" rel="noopener">${tu('notes')}</a>${u.mustUpdate ? '' : `<button class="btn" id="ub-later">${tu('later')}</button>`}`;
  bar.innerHTML = `${ico('download')}${mid}`;
  if ($('#ub-dl')) $('#ub-dl').onclick = () => { api('/api/update/download', { method: 'POST' }); updBanner({ download: { active: true, pct: 0 } }); };
  if ($('#ub-apply')) $('#ub-apply').onclick = () => api('/api/update/apply', { method: 'POST' });
  if ($('#ub-later')) $('#ub-later').onclick = () => { bar.remove(); S.upd.dismissed = u.latest; api('/api/update/dismiss', { method: 'POST', body: { version: u.latest } }); };
}
function handle(p) {
  if (p.event === 'update') { updBanner(p.data || {}); return; }
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
    case 'tool_result': { if (L.steps[d.id]) finishStep(L.steps[d.id], d); markTimeline(d); if (!d.ok && /PLAN MODE/.test(d.result || '') && !S._planHint) { S._planHint = true; toast(({ fa: 'حالت نقشه فعال است: فقط برنامه ارائه می‌شود. برای ساختن، دکمهٔ «نقشه» را خاموش کنید یا «اجرا کن» بگویید.', ru: 'Режим плана включён: создаётся только план. Выключите «План» или скажите «выполни».', zh: '计划模式已开启：只生成计划。关闭“计划”或说“执行”。' })[lang] || 'Plan mode is on: only a plan is produced. Turn off “Plan” or say “execute”.'); } break; }
    case 'approval': showApproval(L, p.runId, d); break;
    case 'checkpoint': addChange(d); break;
    case 'question': showQuestion(L.el, d); break;
    case 'usage': { const u = $('.usage', L.el); u.textContent = `${fmtN(d.prompt_tokens)}↑ ${fmtN(d.completion_tokens)}↓${d.estimated ? '~' : ''}${L.t0 ? ' · ' + fmtDur(Date.now() - L.t0) : ''}`; u.title = `${(d.prompt_tokens || 0).toLocaleString()} input · ${(d.completion_tokens || 0).toLocaleString()} output tokens this turn`; break; }
    case 'todos': renderTodos(L.el, d.todos); if (nearBottom()) thread.scrollTop = 1e9; break;
    case 'files': L.outs = [...(L.outs || []), ...(d.files || [])]; renderOutputs(L.el, L.outs); break;
    case 'sub_event': addSubEvent(L.el, d); break;
    case 'compacted': toast(t('compacted'), 'ok'); break;
    case 'final': { L.content = d.text; const c = $('.content', L.el); c.innerHTML = md(d.text); c.dir = detectDir(d.text); c.classList.remove('streaming'); L.el.classList.remove('streaming'); collapseLong(c, d.text); const th = $('.thought', L.el); th.classList.remove('live'); th.open = false; if (!L.anon) $('.mname', L.el).innerHTML = `<img class="avatar" src="/assets/logo.png" alt="">${esc(d.model)}`; L.m.status = d.question ? 'question' : 'done'; L.m.model = d.model; if (PLAN_RE.test(d.text)) addPlanActions(L.el); $('.meta', L.el).textContent = ((Date.now() - L.t0) / 1000).toFixed(1) + 's'; break; }
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
  a.innerHTML = `<div class="ap-head">${ico('shield')}<span>${t('approveQ')}</span><span class="pill ${d.risk === 'high' ? 'bad' : 'warn'}">${t('risk')[d.risk] || d.risk}</span><code class="mono">${esc(d.name)}</code></div><div class="ap-cmd">${esc(cmd)}</div><div class="ap-btns"><button class="btn primary sm allow">${ico('check')}${t('allow')}</button><button class="btn sm all">${t('allowAll')}</button><button class="btn sm danger deny">${ico('x')}${t('deny')}</button></div>`;
  const decide = (dec) => { api('/api/approve', { method: 'POST', body: { runId, callId: d.id, decision: dec } }); a.remove(); };
  $('.allow', a).onclick = () => decide('allow'); $('.all', a).onclick = () => { S.allowAll = true; decide('allow'); }; $('.deny', a).onclick = () => decide('deny:user declined');
  $('.extra', L.el).appendChild(a); thread.scrollTop = 1e9;
  if (P.notifications && window.Notification && Notification.permission === 'granted' && document.hidden) new Notification('ORCA', { body: t('approveQ') + ' ' + d.name, icon: '/assets/icon512.png' });
}

// ───────────────────────── right panel ─────────────────────────
const openPanel = () => { $('#panel').classList.remove('collapsed'); $('#toggle-panel').classList.add('active'); localStorage.setItem('orca.panel', '1'); };
const togglePanel = () => { const c = $('#panel').classList.toggle('collapsed'); $('#toggle-panel').classList.toggle('active', !c); localStorage.setItem('orca.panel', c ? '0' : '1'); };
$('#toggle-panel').onclick = togglePanel;
if (localStorage.getItem('orca.panel') === '1') openPanel();
function showTab(name) { $$('.panel-tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name)); $$('.tab').forEach((x) => x.classList.toggle('active', x.id === 'tab-' + name)); if (name === 'files') loadFiles(); if (name === 'changes') { refreshChanges(); $('#chg-badge').classList.add('hidden'); } }
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
  if (!(r.entries || []).length) box.innerHTML = '<div class="empty">—</div>';
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
  if (/\.html?$/i.test(p)) {
    const f = el('iframe'); f.sandbox = 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups'; f.src = wsUrl(p) + '?t=' + Date.now(); body.appendChild(f);
    const b = el('button', 'ib sm', ico('edit')); b.dataset.tip = t('edit'); b.onclick = () => editFile(p, r.content);
    const o = el('button', 'ib sm', ico('external')); o.dataset.tip = 'Open'; o.onclick = () => window.open(f.src, '_blank');
    const rf = el('button', 'ib sm', ico('refresh')); rf.onclick = () => (f.src = wsUrl(p) + '?t=' + Date.now());
    acts.append(rf, b, o); return;
  }
  if (/\.md$/i.test(p)) { const d = el('div', 'md content'); d.innerHTML = md(r.content); d.dir = detectDir(r.content); body.appendChild(d); const b = el('button', 'ib sm', ico('edit')); b.onclick = () => editFile(p, r.content); acts.append(b); return; }
  editFile(p, r.content);
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
async function refreshChanges() { const box = $('#changes-list'); box.innerHTML = ''; if (!S.chat) return; const { checkpoints } = await api('/api/chats/' + S.chat.id + '/checkpoints'); for (const ck of checkpoints.reverse()) renderChange(ck, false); if (!checkpoints.length) box.innerHTML = '<div class="empty">—</div>'; }
$('#restore-all').onclick = async () => { if (!S.chat) return; const { checkpoints } = await api('/api/chats/' + S.chat.id + '/checkpoints'); if (!checkpoints.length || !confirm(t('restoreAll') + '?')) return; for (const ck of checkpoints.reverse()) await api('/api/checkpoints/' + ck.id, { method: 'POST', body: { direction: 'before' } }); toast(t('restored'), 'ok'); loadFiles(); };

// ───────────────────────── modals ─────────────────────────
const modal = (html) => { $('#modal-body').innerHTML = html; $('#modal').classList.remove('hidden'); };
const closeModal = () => $('#modal').classList.add('hidden');
$('.modal-x').onclick = closeModal; $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
$('#rail-toggle').onclick = () => { S._railUser = true; $('#rail').classList.toggle('collapsed'); };
$('#tb-theme').onclick = () => { P.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; applyPrefs(); api('/api/config', { method: 'POST', body: { theme: P.theme } }); };

$('#open-leaderboard').onclick = async () => { const { rows } = await api('/api/leaderboard'); modal(`<h2>${ico('trophy')}${t('leaderboard')}</h2><p class="sub">${({ fa: 'بر اساس رأی‌های شما در حالت مقایسه و نبرد (Elo محلی)', ru: 'По вашим голосам в режимах сравнения/битвы (локальный Elo)', zh: '基于你在对比/对战模式中的投票（本地 Elo）' })[lang] || 'From your votes in compare/battle modes (local Elo)'}</p>${rows.length ? `<table class="lb"><tr><th>#</th><th>Model</th><th>Elo</th><th>W</th><th>L</th><th>T</th></tr>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.model)}</td><td class="elo">${r.elo}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.ties}</td></tr>`).join('')}</table>` : '<div class="empty">—</div>'}`); };
$('#open-memory').onclick = async () => { const { text } = await api('/api/memory'); modal(`<h2>${ico('brain')}${t('memory')}</h2><p class="sub">${({ fa: 'یادداشت‌هایی که ORCA دربارهٔ شما و پروژه‌ها نگه می‌دارد و در هر گفتگو می‌بیند. قابل ویرایش.', ru: 'Долговременные заметки ORCA о вас и ваших проектах, видны в каждом чате. Можно редактировать.', zh: 'ORCA 保存的关于你和项目的长期笔记，在每个对话中可见。可编辑。' })[lang] || 'Durable notes ORCA keeps about you and your projects, visible in every chat. Editable.'}</p><textarea class="memory-ta" id="mem">${esc(text)}</textarea><div style="margin-top:12px;display:flex;gap:8px"><button class="btn primary" id="mem-save">${ico('check')}${t('save')}</button></div>`); $('#mem-save').onclick = async () => { await api('/api/memory', { method: 'POST', body: { text: $('#mem').value } }); toast(t('saved'), 'ok'); closeModal(); }; };
$('#open-settings').onclick = () => openSettings();

const SHORTCUTS = [['Ctrl N', 'newChat'], ['Ctrl K', 'actions'], ['Ctrl B', 'railT'], ['Ctrl .', 'panelT'], ['Ctrl ,', 'settings'], ['Esc', 'stop'], ['Ctrl Shift L', 'theme'], ['Ctrl Shift F', 'searchPh'], ['Ctrl /', 'shortcuts']];
// ---- Providers (bring your own key) ----
// Flow: pick a provider from the catalog (models.dev mirror, 200+) or "Custom" → paste key → models auto-discovered from the
// provider's /models endpoint (fallback: catalog) → tick the ones you want → Test → Save. Keys never leave this machine.
let CATALOG = null;
async function providerEditor(existingId) {
  const c = S.cfg; const box = $('#prov-editor'); box.classList.remove('hidden'); box.innerHTML = `<div class="empty">…</div>`;
  if (!CATALOG) { try { CATALOG = await api('/api/providers/catalog'); } catch (_) { CATALOG = { providers: [] }; } }
  const cur = existingId ? { id: existingId, ...(c.providers[existingId] || {}) } : { id: '', name: '', baseUrl: '', apiKey: '', models: [] };
  const featured = CATALOG.providers.filter((p) => (CATALOG.featured || []).includes(p.id));
  const others = CATALOG.providers.filter((p) => !(CATALOG.featured || []).includes(p.id));
  const opt = (p) => `<option value="${esc(p.id)}" ${p.id === cur.id ? 'selected' : ''}>${esc(p.name)}${p.count ? ` (${p.count})` : ''}</option>`;
  box.innerHTML = `
    <div class="pe-head"><b>${existingId ? ts('editProvider') : ts('addProvider')}</b><button class="ib sm" id="pe-close">${ico('x')}</button></div>
    <div class="form-row"><label>${ts('provider')}</label><select class="text" id="pe-id" ${existingId ? 'disabled' : ''}><optgroup label="${ts('popular')}">${featured.map(opt).join('')}</optgroup><optgroup label="${ts('allProviders')}">${others.map(opt).join('')}</optgroup></select></div>
    <div class="form-row"><label>${ts('displayName')}</label><input class="text" id="pe-name" value="${esc(cur.name || '')}" placeholder="—"></div>
    <div class="form-row"><label>Base URL</label><input class="text mono" id="pe-url" value="${esc(cur.baseUrl || '')}" placeholder="https://api.example.com/v1" spellcheck="false"></div>
    <div class="form-row"><label>${ts('apiKey')}</label><input class="text mono" id="pe-key" type="password" placeholder="${cur.keySet ? cur.apiKey : ts('pasteKey')}" spellcheck="false" autocomplete="off"><button class="ib sm" id="pe-eye" data-tip="${ts('show')}">${ico('eye')}</button><a class="small" id="pe-doc" target="_blank" rel="noopener" href="#">${ts('getKey')}</a></div>
    <div class="form-row"><label>${ts('models')}</label><div class="pe-models-tools"><input class="text" id="pe-filter" placeholder="${ts('filterModels')}"><button class="btn sm" id="pe-discover">${ico('refresh')}${ts('discover')}</button><span class="small" id="pe-count"></span></div></div>
    <div class="pe-models" id="pe-models"></div>
    <div class="pe-foot"><span class="small" id="pe-msg"></span><span class="sp"></span><button class="btn sm" id="pe-test">${ts('test')}</button><button class="btn primary sm" id="pe-save">${ico('check')}${ts('save')}</button></div>`;
  let known = []; // catalog rows for the selected provider
  let chosen = new Map((cur.models || []).map((m) => [m.id, m]));
  const provInfo = () => CATALOG.providers.find((p) => p.id === $('#pe-id').value) || {};
  const renderModels = () => {
    const f = ($('#pe-filter').value || '').toLowerCase();
    const rows = [...known]; for (const m of chosen.values()) if (!rows.find((r) => r.id === m.id)) rows.unshift({ ...m, custom: true });
    const vis = rows.filter((m) => !f || m.id.toLowerCase().includes(f) || (m.name || '').toLowerCase().includes(f)).slice(0, 400);
    $('#pe-count').textContent = `${chosen.size} ${ts('selected')} · ${rows.length}`;
    $('#pe-models').innerHTML = vis.map((m) => `<label class="pe-m ${chosen.has(m.id) ? 'on' : ''}"><input type="checkbox" data-id="${esc(m.id)}" ${chosen.has(m.id) ? 'checked' : ''}><span class="pe-m-name">${esc(m.name || m.id)}</span><span class="k mono">${esc(m.id)}</span><span class="pe-m-tags">${m.toolCall ? `<i>${ts('tools')}</i>` : ''}${m.reasoning ? `<i>${ts('reasoning')}</i>` : ''}${m.attachment ? `<i>${ts('images')}</i>` : ''}${m.context ? `<i>${Math.round(m.context / 1000)}k</i>` : ''}${m.free ? `<i class="free">${ts('free')}</i>` : ''}</span></label>`).join('') + (rows.length ? '' : `<div class="empty small">${ts('noModelsYet')}</div>`) + `<div class="pe-m add"><input class="text mono" id="pe-manual" placeholder="${ts('manualModelId')}"><button class="btn sm" id="pe-manual-add">${ts('add')}</button></div>`;
    $$('#pe-models input[type=checkbox]').forEach((cb) => (cb.onchange = () => { const m = rows.find((r) => r.id === cb.dataset.id); if (cb.checked) chosen.set(m.id, { id: m.id, name: m.name, maxTokens: m.output || m.maxTokens || 8192, reasoning: !!m.reasoning, toolCall: m.toolCall !== false, attachment: !!m.attachment, context: m.context || 0 }); else chosen.delete(m.id); cb.closest('.pe-m').classList.toggle('on', cb.checked); $('#pe-count').textContent = `${chosen.size} ${ts('selected')} · ${rows.length}`; }));
    $('#pe-manual-add').onclick = () => { const id = $('#pe-manual').value.trim(); if (!id) return; chosen.set(id, { id, name: id, maxTokens: 8192, toolCall: true }); renderModels(); };
  };
  const loadCatalogModels = async () => { const p = provInfo(); if (!p.id) return; const r = await api('/api/providers/models?id=' + encodeURIComponent(p.id)); known = r.models || []; renderModels(); };
  const applyProvider = async () => { const p = provInfo(); if (!existingId) { $('#pe-name').value = p.name || ''; $('#pe-url').value = p.api || ''; } $('#pe-url').placeholder = p.api || 'https://api.example.com/v1'; $('#pe-doc').href = ({ openai: 'https://platform.openai.com/api-keys', anthropic: 'https://console.anthropic.com/settings/keys', google: 'https://aistudio.google.com/apikey', openrouter: 'https://openrouter.ai/keys', groq: 'https://console.groq.com/keys', xai: 'https://console.x.ai', mistral: 'https://console.mistral.ai/api-keys', deepseek: 'https://platform.deepseek.com/api_keys', togetherai: 'https://api.together.ai/settings/api-keys', cerebras: 'https://cloud.cerebras.ai', zhipuai: 'https://open.bigmodel.cn/usercenter/apikeys', moonshotai: 'https://platform.moonshot.ai/console/api-keys', huggingface: 'https://huggingface.co/settings/tokens', nvidia: 'https://build.nvidia.com', 'fireworks-ai': 'https://fireworks.ai/account/api-keys', dahl: 'https://inference.dahl.global/account' })[p.id] || (p.doc || '#'); $('#pe-doc').classList.toggle('hidden', $('#pe-doc').getAttribute('href') === '#'); $('#pe-key').placeholder = p.local ? ts('noKeyNeeded') : (cur.keySet ? cur.apiKey : ts('pasteKey')); await loadCatalogModels(); };
  $('#pe-id').onchange = applyProvider;
  $('#pe-filter').oninput = renderModels;
  $('#pe-eye').onclick = () => { const k = $('#pe-key'); k.type = k.type === 'password' ? 'text' : 'password'; };
  $('#pe-close').onclick = () => box.classList.add('hidden');
  const creds = () => ({ baseUrl: $('#pe-url').value.trim(), apiKey: $('#pe-key').value.trim(), api: provInfo().anthropic || /anthropic\.com/.test($('#pe-url').value) ? 'anthropic' : 'openai' });
  $('#pe-discover').onclick = async () => { const b = $('#pe-discover'); b.disabled = true; $('#pe-msg').textContent = ts('discovering'); const body = creds(); if (!body.apiKey && cur.keySet) body.useStored = existingId; const r = await api('/api/providers/discover', { method: 'POST', body: { ...body, id: existingId || '' } }); b.disabled = false; if (r.error) { $('#pe-msg').textContent = '✗ ' + r.error.slice(0, 120); return; } const live = r.models || []; const byId = new Map(known.map((m) => [m.id, m])); known = live.map((m) => ({ ...(byId.get(m.id) || {}), ...m, toolCall: byId.get(m.id)?.toolCall ?? true })); $('#pe-msg').textContent = `✓ ${live.length} ${ts('modelsN')}`; renderModels(); };
  $('#pe-test').onclick = async () => { const m = [...chosen.keys()][0]; if (!m) return ($('#pe-msg').textContent = ts('pickModelFirst')); $('#pe-msg').textContent = ts('testing'); const body = { ...creds(), model: m }; if (!body.apiKey && existingId) body.key = `${existingId}/${m}`; const r = await api('/api/models/test', { method: 'POST', body }); $('#pe-msg').textContent = r.ok ? `✓ ${m} · ${r.ms} ms` : `✗ ${(r.error || '').slice(0, 140)}`; };
  $('#pe-save').onclick = async () => { const id = existingId || $('#pe-id').value; if (!id) return; const pv = { name: $('#pe-name').value.trim() || provInfo().name || id, baseUrl: $('#pe-url').value.trim() || provInfo().api || '', models: [...chosen.values()] }; const k = $('#pe-key').value.trim(); if (k) pv.apiKey = k; if (!pv.baseUrl) return ($('#pe-msg').textContent = ts('needUrl')); if (!pv.models.length) return ($('#pe-msg').textContent = ts('pickModelFirst')); await api('/api/config', { method: 'POST', body: { providers: { [id]: pv } } }); await loadConfig(); toast(ts('saved'), 'ok'); openSettings('models'); };
  await applyProvider();
  if (existingId) { $('#pe-name').value = cur.name || ''; $('#pe-url').value = cur.baseUrl || ''; renderModels(); }
}
async function paintVault() {
  const d = $('#cloud-dot'), st = $('#cloud-state'); if (!d || !st) return;
  try { const v = await api('/api/vault'); d.className = 'cloud-dot ' + (v.ok ? 'on' : 'off'); st.textContent = !v.enabled ? tu('cloudOff') : v.ok ? `${tu('cloudOk')} · ${v.aliases.length} ${ts('modelsN')} · ${v.keys} ${ts('keysN')}` : `${tu('cloudDown')}${v.error ? ' (' + v.error + ')' : ''}`; } catch (_) { d.className = 'cloud-dot off'; st.textContent = tu('cloudDown'); }
}
async function openSettings(page = 'general') {
  const c = await api('/api/config');
  const fa = lang === 'fa';
  const T4 = (o) => o[lang] ?? o.en;
  const row = (label, inner, desc) => `<div class="form-row"><label>${label}</label>${inner}${desc ? `<div class="desc">${desc}</div>` : ''}</div>`;
  const sw = (id, on) => `<button class="switch ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${on}"></button>`;
  const segm = (id, opts, val) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === val ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  modal(`<h2>${ico('settings')}${t('settings')}</h2><p class="sub">ORCA ${c.version || ''}</p>
  <div class="tabs-h" id="st-tabs">${[['general', 'sparkle'], ['appearance', 'sun'], ['models', 'code'], ['agent', 'rocket'], ['data', 'folder'], ['updates', 'download']].map(([k, i]) => `<button data-p="${k}" class="${k === page ? 'active' : ''}">${ico(i)}${ts(k)}</button>`).join('')}</div>

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
    <div id="model-list">${c.models.filter((m) => m.key !== 'auto').map((m) => `<div class="model-row" data-key="${m.key}"><div><b>${esc(m.label)}</b> <span class="k">${esc(m.builtin ? ts('builtin') : m.vendor || m.provider)} · ${esc(t('tier_' + m.tier) || m.tier)}</span></div><span class="pill test-res ${m.ready ? '' : 'off'}">${m.ready ? '' : ts('noKey')}</span><button class="btn sm test">${ts('test')}</button>${m.builtin ? '' : `<button class="ib sm del" data-tip="${ts('remove')}">${ico('trash')}</button>`}</div>`).join('')}</div>
    <h3>${ts('providers')}</h3><p class="sub" style="margin-top:-6px">${ts('providersDesc')}</p>
    <div id="prov-list">${Object.entries(c.providers).map(([id, p]) => `<div class="prov-row" data-id="${esc(id)}"><div class="prov-main"><b>${esc(p.name || id)}</b><span class="k mono">${esc((p.baseUrl || '').replace(/^https?:\/\//, ''))}</span><span class="small">${(p.models || []).length} ${ts('modelsN')} · ${p.keySet ? ts('keySet') : ts('noKey')}</span></div><button class="btn sm edit">${ts('edit')}</button><button class="ib sm del" data-tip="${ts('remove')}">${ico('trash')}</button></div>`).join('') || `<div class="empty small">${ts('noProviders')}</div>`}</div>
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
    ${row(ts('provider'), `<select class="text" id="ig-prov" style="max-width:220px">${opt('', ts('builtinFree'), icur)}${opt('openai', ts('imagesApi'), icur)}${provOpts(icur)}</select><input class="text" id="ig-model" placeholder="${ts('modelId')}" value="${esc(c.imageGen.model || '')}" spellcheck="false">`)}
    ${row(ts('apiKey'), `<input class="text" id="ig-key" placeholder="${c.imageGen.keySet ? c.imageGen.apiKey : ts('keyOptionalProv')}" autocomplete="off" spellcheck="false"><input class="text" id="ig-url" placeholder="${ts('baseUrl')}" value="${esc(c.imageGen.baseUrl || '')}" spellcheck="false">`)}
    <h3>${ts('videoGen')}</h3><p class="sub" style="margin-top:-6px">${ts('videoGenDesc')}</p>
    ${row(ts('provider'), `<select class="text" id="vg-prov" style="max-width:220px">${opt('', ts('builtinFree'), vgcur)}${opt('replicate', ts('vgPred'), vgcur)}${opt('fal', ts('vgQueue'), vgcur)}</select><input class="text" id="vg-model" placeholder="${ts('modelId')}" value="${esc(c.videoGen.model || '')}" spellcheck="false">`)}
    ${row(ts('apiKey'), `<input class="text" id="vg-key" placeholder="${c.videoGen.keySet ? c.videoGen.apiKey : ts('keyOptional')}" autocomplete="off" spellcheck="false">`)}`; })()}
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
    ${row(ts('autoUpdate'), sw('st-autoupd', c.autoUpdate !== false))}
    <div class="form-row" style="gap:8px"><button class="btn" id="upd-check">${ico('undo')}${tu('check')}</button><button class="btn btn-primary hidden" id="upd-dl">${ico('download')}${tu('download')}</button><button class="btn btn-primary hidden" id="upd-apply">${ico('rocket')}${tu('restart')}</button><span class="small" id="upd-msg"></span></div>
    <div id="upd-notes" class="upd-notes hidden"></div>
    ${row(tu('cloud'), `<span class="cloud-dot" id="cloud-dot2"></span><span id="cloud-state2">…</span>`)}
    ${c.app && c.app.repo ? row('GitHub', `<a href="https://github.com/${esc(c.app.repo)}" target="_blank" rel="noopener" class="small mono">github.com/${esc(c.app.repo)}</a> <span class="small">— ${ts('github')}</span>`) : ''}
  </div>

  <div style="display:flex;gap:8px;margin-top:22px;justify-content:flex-end;border-top:1px solid var(--line);padding-top:16px"><button class="btn" id="st-cancel">${T4({ en: 'Close', fa: 'بستن', ru: 'Закрыть', zh: '关闭' })}</button><button class="btn primary" id="st-save">${ico('check')}${t('save')}</button></div>`);

  // tabs
  $$('#st-tabs button').forEach((b) => (b.onclick = () => { $$('#st-tabs button').forEach((x) => x.classList.toggle('active', x === b)); $$('.spage').forEach((x) => x.classList.toggle('active', x.dataset.p === b.dataset.p)); }));
  const segClick = (id, fn) => $$('#' + id + ' button').forEach((b) => (b.onclick = () => { $$('#' + id + ' button').forEach((x) => x.classList.toggle('active', x === b)); fn(b.dataset.v); }));
  const swClick = (id, fn) => { const s = $('#' + id); s.onclick = () => { const on = s.classList.toggle('on'); s.setAttribute('aria-checked', on); fn(on); }; };
  // updates + cloud status
  const paintUpd = (u) => {
    if (!u) return;
    const latest = $('#upd-latest'); if (latest) latest.innerHTML = `${tu('latest')}: <b>${esc(u.latest || '—')}</b>`;
    const ch = $('#upd-channel'); if (ch) ch.textContent = `${u.channel || 'stable'} · ${u.repo || ''}`;
    const msg = $('#upd-msg'); const dl = $('#upd-dl'); const ap = $('#upd-apply'); const notes = $('#upd-notes');
    if (msg) msg.textContent = u.error ? `${tu('error')}: ${u.error}` : u.available ? tu('available')(u.latest) : tu('upToDate');
    if (dl) dl.classList.toggle('hidden', !(u.available && u.asset && !u.download?.ready));
    if (ap) ap.classList.toggle('hidden', !(u.download && u.download.ready));
    if (notes) { notes.classList.toggle('hidden', !(u.available && u.notes)); if (u.available && u.notes) notes.innerHTML = md(u.notes); }
    { const de = $('#cloud-dot2'), se = $('#cloud-state2'); if (de && se) { const g = u.vault || {}; de.className = 'cloud-dot ' + (g.ok ? 'on' : g.enabled ? 'off' : ''); se.textContent = !g.enabled ? tu('cloudOff') : g.ok ? `${tu('cloudOk')} · ${(g.aliases || []).length} ${ts('modelsN')}` : `${tu('cloudDown')}${g.error ? ' (' + g.error + ')' : ''}`; } }
  };
  api('/api/update').then(paintUpd).catch(() => {});
  if ($('#upd-check')) $('#upd-check').onclick = async () => { $('#upd-msg').textContent = tu('checking'); paintUpd(await api('/api/update?force=1')); };
  if ($('#upd-dl')) $('#upd-dl').onclick = async () => { $('#upd-msg').textContent = tu('downloading'); await api('/api/update/download', { method: 'POST' }); };
  if ($('#upd-apply')) $('#upd-apply').onclick = async () => { const r = await api('/api/update/apply', { method: 'POST' }); if (r.error) toast(r.error, 'err'); else if (r.manual) window.open(S.upd?.url || 'https://github.com/' + (S.cfg.app?.repo || '') + '/releases/latest', '_blank'); };
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
  $('#st-export').onclick = async () => { if (!S.chat) return toast('—'); const r = await fetch('/api/chats/' + S.chat.id + '/export'); dl((S.chat.title || 'orca-chat').replace(/[\\/:*?"<>|]/g, '_') + '.md', await r.text()); toast(t('exported'), 'ok'); };
  $('#st-export-all').onclick = async () => { const r = await fetch('/api/backup'); dl('orca-backup-' + new Date().toISOString().slice(0, 10) + '.json', await r.text()); toast(t('exported'), 'ok'); };
  $('#st-import').onclick = () => $('#st-import-file').click();
  $('#st-import-file').onchange = async () => { const f = $('#st-import-file').files[0]; if (!f) return; try { const data = JSON.parse(await f.text()); const r = await api('/api/backup', { method: 'POST', body: data }); toast(`+${r.imported}`, 'ok'); loadChats(); } catch (e) { toast(e.message, 'err'); } };
  $('#st-clear').onclick = async () => { if (!confirm(ts('clearConfirm'))) return; await api('/api/chats/all', { method: 'DELETE' }); newChat(); loadChats(); closeModal(); };
  $('#st-cancel').onclick = closeModal;
  $('#jg-test').onclick = async () => { const b = $('#jg-test'), m = $('#jg-msg'); b.disabled = true; m.textContent = ts('testing'); const body = { baseUrl: $('#jg-url').value.trim(), model: $('#jg-model').value.trim() }; if ($('#jg-key').value.trim()) body.apiKey = $('#jg-key').value.trim(); const r = await api('/api/judge/test', { method: 'POST', body }); b.disabled = false; m.textContent = r.ok ? `✓ ${ts('judgeTested')} · ${r.ms} ms · ${r.model} · ${r.sample}` : `✗ ${ts('judgeTestFail')}: ${(r.error || '').slice(0, 120)}`; };
  $('#st-save').onclick = async () => {
    const keys = {}; $$('input[data-key]').forEach((i) => { if (i.value.trim()) keys[i.dataset.key] = i.value.trim(); });
    const vision = { provider: $('#vs-prov').value, model: $('#vs-model').value.trim(), baseUrl: $('#vs-url').value.trim() }; if ($('#vs-key').value.trim()) vision.apiKey = $('#vs-key').value.trim();
    const imageGen = { provider: $('#ig-prov').value, model: $('#ig-model').value.trim(), baseUrl: $('#ig-url').value.trim() }; if ($('#ig-key').value.trim()) imageGen.apiKey = $('#ig-key').value.trim();
    const videoGen = { provider: $('#vg-prov').value, model: $('#vg-model').value.trim() }; if ($('#vg-key').value.trim()) videoGen.apiKey = $('#vg-key').value.trim();
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
    { ico: 'download', label: ts('exportChat'), run: async () => { if (!S.chat) return; const r = await fetch('/api/chats/' + S.chat.id + '/export'); dl('orca-chat.md', await r.text()); } },
    { ico: 'keyboard', label: t('shortcuts'), sub: 'Ctrl /', run: showShortcuts },
    { ico: 'brain', label: '/init — ORCA.md', run: () => { $('#input').value = '/init'; send(); } },
    { ico: 'refresh', label: '/compact', run: () => { $('#input').value = '/compact'; send(); } },
    { ico: 'download', label: ({ fa: 'دانلود از اینستاگرام/تیک‌تاک/X', ru: 'Скачать из Instagram/TikTok/X', zh: '从 Instagram/TikTok/X 下载' })[lang] || 'Download from Instagram/TikTok/X', run: () => { $('#input').value = ({ fa: 'این لینک رو دانلود کن: ', ru: 'Скачай эту ссылку: ', zh: '下载这个链接：' })[lang] || 'Download this link: '; $('#input').focus(); } },
  ];
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
  if (e.key === 'Escape') { if (!cmdk.classList.contains('hidden')) closeCmdk(); else if (!$('#modal').classList.contains('hidden')) closeModal(); else stopAll(); return; }
  if (mod && k === 'k') { e.preventDefault(); openCmdk(); }
  else if (mod && k === 'n') { e.preventDefault(); newChat(); }
  else if (mod && k === 'b') { e.preventDefault(); S._railUser = true; $('#rail').classList.toggle('collapsed'); }
  else if (mod && e.key === '.') { e.preventDefault(); togglePanel(); }
  else if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
  else if (mod && e.key === '/') { e.preventDefault(); showShortcuts(); }
  else if (mod && e.shiftKey && k === 'l') { e.preventDefault(); $('#tb-theme').click(); }
  else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); $('#rail').classList.remove('collapsed'); $('#search').focus(); }
};

// ───────────────────────── titlebar / responsive ─────────────────────────
$$('[data-win]').forEach((b) => (b.onclick = () => desktop && desktop.win(b.dataset.win)));
async function setLang(v) { if (!I18N[v]) return; lang = v; applyLang(); await loadConfig(); api('/api/config', { method: 'POST', body: { lang } }); if (S.chat) openChat(S.chat.id); else renderChatList(S.chats); }
$('#tb-lang').onclick = (e) => { e.stopPropagation(); const old = $('#lang-menu'); if (old) return old.remove(); const m = el('div', 'lang-menu'); m.id = 'lang-menu'; m.innerHTML = LANGS.map(([k, n]) => `<button data-l="${k}" class="${k === lang ? 'sel' : ''}"><span class="lm-name">${n}</span><span class="lm-code">${k.toUpperCase()}</span></button>`).join(''); $$('button', m).forEach((b) => (b.onclick = () => { m.remove(); setLang(b.dataset.l); })); document.body.appendChild(m); const r = $('#tb-lang').getBoundingClientRect(); m.style.top = r.bottom + 6 + 'px'; if (root.dir === 'rtl') m.style.left = r.left + 'px'; else m.style.right = (innerWidth - r.right) + 'px'; setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0); };
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
  setTimeout(async () => { try { const u = await api('/api/update'); if (u.available && S.cfg.autoUpdate !== false && S.cfg.dismissedUpdate !== u.latest) updBanner(u); } catch (_) {} }, 2500);
})();
})();
