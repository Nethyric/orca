'use strict';
// Local HTTP + SSE server. Used by Electron (loopback) and as standalone web mode.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const config = require('./core/config');
const store = require('./core/store');
const tools = require('./core/tools');
const { runAgent, stopRun, approve, quick, routeAuto, compact } = require('./core/agent');
const remote = require('./core/remote');
const vault = require('./core/vault');
const catalog = require('./core/catalog');
const zlib = require('zlib');

const UI = path.join(__dirname, '..', 'ui');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (_) { resolve({}); } }); });
const readRaw = (req, max = 60 * 1024 * 1024) => new Promise((resolve, reject) => { const chunks = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > max) { reject(new Error('file too large')); req.destroy(); } else chunks.push(d); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); });
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const analysisCache = new Map(); // rel path -> analysis

// ---- SSE hub: each browser tab subscribes once; all run events broadcast with runId ----
const clients = new Set();
process.on('uncaughtException', (e) => console.error('[uncaught]', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('[unhandled]', e && e.stack || e));
function broadcast(payload) { const s = `data: ${JSON.stringify(payload)}\n\n`; for (const c of clients) { try { c.write(s); } catch (_) {} } }


function startLane({ chatId, runId, lane, modelKey, history, planMode, autonomy, webMode, notes, pinned }) {
  const msg = store.addMessage(chatId, { role: 'assistant', content: '', model: config.resolve(modelKey)?.label || modelKey, modelKey, lane, events: [], status: 'running', runId });
  const laneRun = runId + (lane ? ':' + lane : '');
  let buffer = { content: '', reasoning: '' };
  let lastFlush = 0;
  const persist = (force) => {
    const now = Date.now();
    if (!force && now - lastFlush < 1500) return;
    lastFlush = now;
    store.updateMessage(chatId, msg.id, { content: buffer.content, reasoning: buffer.reasoning });
  };
  const emit = (event, data) => {
    if (event === 'delta') {
      if (data.type === 'reset') { buffer.content = ''; buffer.reasoning = ''; }
      else if (data.type === 'content') buffer.content += data.text;
      else if (data.type === 'reasoning') buffer.reasoning += data.text;
      persist(false);
    } else {
      const m = store.getChat(chatId)?.messages.find((x) => x.id === msg.id);
      if (m) {
        const ev = { event, data: event === 'checkpoint' ? { ...data, before: undefined, after: undefined } : data, ts: Date.now() };
        m.events.push(ev);
        if (event === 'final') { m.content = data.text; m.model = data.model; m.status = data.question ? 'question' : 'done'; m.usage = data.usage; buffer.content = data.text; }
        if (event === 'error') { m.status = 'error'; m.content = buffer.content; m.error = data.text; m.partial = !!buffer.content.trim(); }
        if (event === 'stopped') { m.status = 'stopped'; m.content = buffer.content; m.partial = !!buffer.content.trim(); }
        if (event === 'thought_done') m.reasoning = data.text;
        store.updateMessage(chatId, msg.id, m);
      }
    }
    broadcast({ runId: laneRun, chatId, msgId: msg.id, lane, event, data });
  };
  (async () => {
    try {
      const r = await runAgent({ chatId, runId: laneRun, history, modelKey, emit, planMode, autonomy, lane, webMode, notes, pinned });
      if (r && r.api) store.updateMessage(chatId, msg.id, { api: r.api });
    } catch (e) { emit('error', { text: e.message }); }
    finally { emit('done', {}); }
  })();
  return { msgId: msg.id, runId: laneRun };
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;
  if (p === '/api/upload' && req.method === 'POST') {
    // raw body upload: ?name=<filename>  → saved to workspace attachments/, images are pre-analyzed (OCR + vision if configured)
    const name = (q.get('name') || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
    let buf; try { buf = await readRaw(req); } catch (e) { return json(res, 413, { error: e.message }); }
    const dir = path.join(config.workspaceDir(), 'attachments'); fs.mkdirSync(dir, { recursive: true });
    let fp = path.join(dir, name); let i = 1; while (fs.existsSync(fp)) fp = path.join(dir, name.replace(/(\.[^.]+)?$/, `-${i++}$1`));
    fs.writeFileSync(fp, buf);
    const relPath = path.relative(config.workspaceDir(), fp).replace(/\\/g, '/');
    const out = { ok: true, path: relPath, bytes: buf.length, kind: IMG_EXT.test(name) ? 'image' : 'file' };
    if (out.kind === 'image') { try { const a = await tools.extras.analyzeImage(fp, { ocr: true }); out.analysis = a; analysisCache.set(relPath, a); } catch (e) { out.analysis = { error: e.message }; } }
    else if (buf.length < 2e6 && !buf.includes(0)) out.text = buf.toString('utf8').slice(0, 60000);
    return json(res, 200, out);
  }
  const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
  if (p === '/api/todos') return json(res, 200, { todos: tools.extras.loadTodos(q.get('chatId') || 'default') });
  if (p === '/api/compact' && req.method === 'POST') {
    const chat = store.getChat(body.chatId); if (!chat) return json(res, 404, { error: 'chat not found' });
    const hist = chat.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content);
    if (hist.length < 2) return json(res, 200, { ok: false, error: 'nothing to compact' });
    try {
      const brief = await compact(hist);
      if (!brief) return json(res, 200, { ok: false, error: 'empty summary' });
      // replace history with the brief: keep it as one user note + one assistant ack so the model continues from it
      store.updateChat(body.chatId, { messages: [] });
      store.addMessage(body.chatId, { role: 'user', content: '[خلاصهٔ فشردهٔ گفتگوی قبلی / compact brief]\n\n' + brief });
      store.addMessage(body.chatId, { role: 'assistant', content: (config.load().lang === 'en' ? '✅ Conversation compacted. I will continue from this brief.' : '✅ گفتگو فشرده شد؛ از این خلاصه ادامه می‌دهم.'), status: 'done', events: [], model: 'ORCA' });
      return json(res, 200, { ok: true, chars: brief.length, before: hist.length });
    } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  }

  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no', 'access-control-allow-origin': '*' });
    res.write(': connected\n\n');
    clients.add(res);
    const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 20000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }
  if (p === '/api/update' && req.method === 'GET') return json(res, 200, { ...(await remote.checkForUpdates(q.get('force') === '1')), download: remote.downloadState(), vault: vault.status(), remote: remote.remote(), repo: remote.REPO, channel: remote.CHANNEL });
  if (p === '/api/update/download' && req.method === 'POST') { remote.downloadUpdate((d) => broadcast({ event: 'update', data: { download: d } })).then((d) => broadcast({ event: 'update', data: { download: d, ready: d.ready, error: d.error } })); return json(res, 200, { ok: true }); }
  if (p === '/api/update/apply' && req.method === 'POST') { try { const r = remote.applyUpdate(); if (r.restarting) setTimeout(() => process.exit(0), 800); return json(res, 200, r); } catch (e) { return json(res, 400, { error: e.message }); } }
  if (p === '/api/update/simulate' && req.method === 'POST' && process.env.ORCA_DEV) { broadcast({ event: 'update', data: { available: true, latest: body.version || '9.9.9', url: 'https://github.com/' + remote.REPO + '/releases', notes: body.notes || '- test release', asset: { name: 'ORCA-Agent-9.9.9-win-x64.zip' }, mustUpdate: !!body.must } }); return json(res, 200, { ok: true }); }
  if (p === '/api/update/dismiss' && req.method === 'POST') { config.save({ dismissedUpdate: body.version || '' }); return json(res, 200, { ok: true }); }
  if (p === '/api/health') return json(res, 200, { ok: true, version: require('../package.json').version, builtin: vault.enabled(), vault: vault.status().ok, repo: remote.REPO, tools: tools.TOOL_NAMES, electron: !!process.versions.electron, bins: { ffmpeg: !!tools.extras.findBin('ffmpeg'), ytdlp: !!tools.extras.findBin('yt-dlp') }, vision: !!tools.extras.visionModel() });
  if (p === '/api/config' && req.method === 'GET') return json(res, 200, config.publicView());
  if (p === '/api/config' && req.method === 'POST') {
    const patch = { ...body };
    delete patch.keys;
    if (patch.providers && typeof patch.providers === 'object') for (const pv of Object.values(patch.providers)) if (pv && pv.apiKey && String(pv.apiKey).includes('…')) delete pv.apiKey; // masked value → keep stored key
    if (patch.customModels) patch.customModels = patch.customModels.map((m) => { const old = config.load().customModels.find((x) => x.key === m.key); if (m.apiKey && m.apiKey.includes('…') && old) m.apiKey = old.apiKey; return m; });
    config.save(patch); return json(res, 200, config.publicView());
  }
  if (p === '/api/models/test' && req.method === 'POST') {
    const t0 = Date.now();
    try {
      let sample;
      if (body.key) sample = await quick(body.key, 'Reply with the single word: OK', 20);
      else sample = await catalog.probe({ baseUrl: body.baseUrl, apiKey: body.apiKey, model: body.model, api: body.api });
      return json(res, 200, { ok: true, ms: Date.now() - t0, sample: String(sample || '').slice(-60) });
    } catch (e) { return json(res, 200, { ok: false, status: e.status, error: String(e.message || e).slice(0, 300), ms: Date.now() - t0 }); }
  }
  // ---- provider catalog (models.dev mirror, cached) ----
  if (p === '/api/providers/catalog' && req.method === 'GET') return json(res, 200, await catalog.list(q.get('refresh') === '1'));
  if (p === '/api/providers/models' && req.method === 'GET') return json(res, 200, await catalog.models(q.get('id')));
  if (p === '/api/providers/discover' && req.method === 'POST') { try { const st = body.id && config.load().providers[body.id]; const b = { ...body, apiKey: body.apiKey || (st && st.apiKey) || '', baseUrl: body.baseUrl || (st && st.baseUrl) || '' }; return json(res, 200, { models: await catalog.discover(b) }); } catch (e) { return json(res, 200, { models: [], error: e.message }); } }
  if (p === '/api/vault' && req.method === 'GET') { if (q.get('refresh') === '1') await vault.refresh(true).catch(() => {}); return json(res, 200, vault.status()); }
  // ---- stats / backup ----
  if (p === '/api/stats') {
    const chats = store.listChats(); let messages = 0, bytes = 0;
    for (const c of chats) { const full = store.getChat(c.id); messages += (full?.messages || []).length; }
    try { for (const f of fs.readdirSync(path.join(config.getDataDir(), 'chats'))) bytes += fs.statSync(path.join(config.getDataDir(), 'chats', f)).size; } catch (_) {}
    let checkpoints = 0; try { checkpoints = fs.readdirSync(path.join(config.getDataDir(), 'checkpoints')).length; } catch (_) {}
    return json(res, 200, { chats: chats.length, messages, checkpoints, bytes });
  }
  if (p === '/api/backup' && req.method === 'GET') { const all = store.listChats().map((c) => store.getChat(c.id)).filter(Boolean); let memory = ''; try { memory = fs.readFileSync(path.join(config.getDataDir(), 'memory.md'), 'utf8'); } catch (_) {} return json(res, 200, { version: 1, exportedAt: Date.now(), chats: all, memory }); }
  if (p === '/api/backup' && req.method === 'POST') { let n = 0; for (const c of body.chats || []) { if (c && c.id && Array.isArray(c.messages)) { store.importChat(c); n++; } } if (body.memory) { const f = path.join(config.getDataDir(), 'memory.md'); const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; if (!cur.includes(body.memory.trim().slice(0, 200))) fs.appendFileSync(f, '\n' + body.memory); } return json(res, 200, { imported: n }); }
  if (p === '/api/chats/all' && req.method === 'DELETE') { let n = 0; for (const c of store.listChats()) { store.deleteChat(c.id); n++; } return json(res, 200, { deleted: n }); }

  // ---- chats ----
  if (p === '/api/chats' && req.method === 'GET') return json(res, 200, { chats: store.listChats() });
  if (p === '/api/chats' && req.method === 'POST') return json(res, 200, store.createChat(body));
  if (p === '/api/search') return json(res, 200, { hits: store.search(q.get('q') || '') });
  if (p === '/api/leaderboard') return json(res, 200, { rows: store.leaderboard() });
  let m;
  if ((m = p.match(/^\/api\/chats\/([\w-]+)$/))) {
    if (req.method === 'GET') { const c = store.getChat(m[1]); return c ? json(res, 200, c) : json(res, 404, { error: 'not found' }); }
    if (req.method === 'DELETE') return json(res, 200, { ok: store.deleteChat(m[1]) });
    if (req.method === 'POST') return json(res, 200, store.updateChat(m[1], body) || {});
  }
  if ((m = p.match(/^\/api\/chats\/([\w-]+)\/messages\/([\w-]+)$/))) {
    if (req.method === 'POST') { const r = store.updateMessage(m[1], m[2], { ...(typeof body.pinned === 'boolean' ? { pinned: body.pinned } : {}) }); return r ? json(res, 200, { ok: true, pinned: !!r.pinned }) : json(res, 404, { error: 'not found' }); }
    if (req.method === 'DELETE') return json(res, 200, { ok: store.deleteMessage(m[1], m[2]) });
  }
  if ((m = p.match(/^\/api\/chats\/([\w-]+)\/fork$/)) && req.method === 'POST') { const c = store.forkChat(m[1], body.messageId, body.title); return c ? json(res, 200, c) : json(res, 404, { error: 'not found' }); }
  if ((m = p.match(/^\/api\/chats\/([\w-]+)\/pinned$/))) { const c = store.getChat(m[1]); return c ? json(res, 200, { pinned: c.messages.filter((x) => x.pinned).map((x) => ({ id: x.id, role: x.role, text: String(x.content || '').slice(0, 2000), ts: x.ts })) }) : json(res, 404, { error: 'not found' }); }
  if ((m = p.match(/^\/api\/chats\/([\w-]+)\/export$/))) { res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="orca-${m[1]}.md"` }); return res.end(store.exportChat(m[1])); }
  if ((m = p.match(/^\/api\/chats\/([\w-]+)\/checkpoints$/))) return json(res, 200, { checkpoints: store.listCheckpoints(m[1]) });
  if ((m = p.match(/^\/api\/chats\/([\w-]+)\/vote$/))) { store.addVote(m[1], body); return json(res, 200, { ok: true, leaderboard: store.leaderboard() }); }
  if ((m = p.match(/^\/api\/checkpoints\/([\w-]+)$/))) return json(res, 200, store.restoreCheckpoint(m[1], body.direction || 'before'));
  if ((m = p.match(/^\/api\/checkpoints\/([\w-]+)\/diff$/))) { const ck = require('./core/store'); const r = (function () { try { return JSON.parse(fs.readFileSync(path.join(config.getDataDir(), 'checkpoints', m[1] + '.json'), 'utf8')); } catch (_) { return null; } })(); return json(res, 200, r || { error: 'not found' }); }

  // ---- send message / run ----
  if (p === '/api/send' && req.method === 'POST') {
    let { chatId, text, mode = 'direct', model, models = [], planMode = false, autonomy, regenerateFrom, images = [], webMode = false, continueFrom } = body;
    // "Continue" on an interrupted/stopped answer: no new user text — the agent resumes the same turn
    if (continueFrom && text == null) {
      const chat0 = store.getChat(chatId); if (!chat0) return json(res, 404, { error: 'chat not found' });
      const prev = chat0.messages.find((x) => x.id === continueFrom && x.role === 'assistant');
      if (!prev) return json(res, 404, { error: 'message not found' });
      text = `[system] Your previous answer was interrupted (${prev.status || 'stopped'}). Continue it from exactly where it stopped — no greeting, no recap. It ended with: ${JSON.stringify(String(prev.content || '').slice(-400))}`;
      body._hidden = true;
    }
    // A very long paste is saved as a workspace file so the model can read/process it with tools instead of
    // retyping it into a tool call (which used to blow the output limit and stall for minutes).
    let pasted = null;
    if (typeof text === 'string' && text.length > 12000 && !/<attached_(file|image|text)/.test(text)) {
      try {
        const dir = path.join(config.workspaceDir(), 'attachments'); fs.mkdirSync(dir, { recursive: true });
        const name = `paste-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
        fs.writeFileSync(path.join(dir, name), text);
        pasted = 'attachments/' + name;
      } catch (_) {}
    }
    // attached images → hidden analysis block the text-only models can read (OCR + vision if configured)
    if (Array.isArray(images) && images.length && text != null) {
      const blocks = [];
      for (const im of images.slice(0, 8)) {
        const relPath = String(im.path || im).replace(/^\/+/, '');
        let a = analysisCache.get(relPath);
        if (!a) { try { a = await tools.extras.analyzeImage(path.join(config.workspaceDir(), relPath), { ocr: true }); analysisCache.set(relPath, a); } catch (e) { a = { error: e.message }; } }
        blocks.push(`<attached_image path="${relPath}" size="${a.width || '?'}x${a.height || '?'}">\n${a.vision ? 'VISION (' + a.vision_model + '): ' + a.vision + '\n' : ''}${a.ocr_text ? 'OCR TEXT (confidence ' + a.ocr_confidence + '%):\n' + a.ocr_text : (a.vision ? '' : 'OCR found no readable text.')}${a.note && !a.vision ? '\nNOTE: ' + a.note : ''}\n</attached_image>`);
      }
      text = String(text || '') + '\n\n' + blocks.join('\n');
    }
    // slash commands
    const slash = String(text || '').trim().match(/^\/(help|init|compact)\b\s*(.*)$/i);
    if (slash) {
      const chat0 = store.getChat(chatId); if (!chat0) return json(res, 404, { error: 'chat not found' });
      const cmd = slash[1].toLowerCase(); const fa = config.load().lang !== 'en';
      store.addMessage(chatId, { role: 'user', content: String(text) });
      let reply = '';
      if (cmd === 'help') reply = fa ? '**دستورات:**\n- `/init` — ساخت ORCA.md (حافظهٔ پروژه)\n- `/compact` — فشرده‌سازی تاریخچهٔ این گفتگو\n- `/plan` — روشن/خاموش کردن حالت نقشه\n- `/model <نام>` — انتخاب مدل (auto, minimax, deepseek, glm)\n- `/export` — خروجی Markdown این گفتگو\n- `/clear` — گفتگوی جدید\n- `/files` — پنل فایل‌ها\n\nهمچنین: لینک اینستاگرام/تیک‌تاک/X/یوتیوب را بفرست تا دانلود کند؛ عکس را بکش و رها کن تا ببیند (OCR + مدل بینایی در صورت تنظیم).' : '**Commands:**\n- `/init` — create ORCA.md project memory\n- `/compact` — compact this conversation\n- `/plan` — toggle plan mode\n- `/model <name>` — pick model (auto, minimax, deepseek, glm)\n- `/export` — export Markdown\n- `/clear` — new chat\n- `/files` — files panel\n\nAlso: paste an Instagram/TikTok/X/YouTube link to download; drop an image to have it read (OCR + vision model if configured).';
      else if (cmd === 'init') { const r = await tools.callTool('project_init', { overwrite: /force|overwrite/i.test(slash[2]) }); reply = r.error ? '❌ ' + r.error : (r.created ? (fa ? '✅ فایل `ORCA.md` ساخته شد — حافظهٔ پروژه؛ در هر گفتگوی این پوشه خوانده می‌شود. آن را کامل کنید یا از من بخواهید کاملش کنم.' : '✅ `ORCA.md` created — project memory, loaded in every chat of this workspace. Fill it in or ask me to.') : (fa ? 'ℹ️ `ORCA.md` از قبل وجود دارد.' : 'ℹ️ `ORCA.md` already exists.')) + '\n\n```markdown\n' + (r.text || '').slice(0, 1500) + '\n```'; }
      else if (cmd === 'compact') { const hist = chat0.messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content); try { const brief = hist.length >= 2 ? await compact(hist) : ''; if (brief) { store.updateChat(chatId, { messages: [] }); store.addMessage(chatId, { role: 'user', content: '[compact brief]\n\n' + brief }); reply = (fa ? '✅ گفتگو فشرده شد (' + hist.length + ' پیام → خلاصه). ادامه بدهید.' : '✅ Compacted (' + hist.length + ' messages → brief). Continue.') + '\n\n' + brief; } else reply = fa ? 'چیزی برای فشرده‌سازی نیست.' : 'Nothing to compact.'; } catch (e) { reply = '❌ ' + e.message; } }
      const am = store.addMessage(chatId, { role: 'assistant', content: reply, status: 'done', events: [], model: 'ORCA' });
      return json(res, 200, { runId: null, lanes: [], models: [], local: true, msgId: am.id, text: reply });
    }
    // Plan mode auto-exit: a short confirmation after a plan means "execute now".
    if (planMode && /^(بله|آره|اره|باشه|اوکی|ok|okay|yes|y|go|do it|execute|run|proceed|اجرا)/i.test(String(text || '').trim()) && String(text || '').trim().length < 60) planMode = false;
    const chat = store.getChat(chatId); if (!chat) return json(res, 404, { error: 'chat not found' });
    if (regenerateFrom) store.truncateAfter(chatId, regenerateFrom);
    if (text != null) store.addMessage(chatId, { role: 'user', content: String(text), ...(pasted ? { pastedPath: pasted } : {}), ...(body._hidden ? { hidden: true } : {}) });
    const fresh = store.getChat(chatId);
    const notes = fresh.notes || '';
    const pinned = fresh.messages.filter((x) => x.pinned && (x.role === 'user' || x.role === 'assistant')).map((x) => ({ role: x.role, text: x.content }));
    // direct mode context = user msgs + lane-less assistant msgs (+ lane 'a' if the chat used to be a comparison)
    const history = fresh.messages.filter((x) => x.role === 'user' || (x.role === 'assistant' && (!x.lane || x.lane === 'a')));
    const runId = store.uid();
    const cfg = config.load();
    const lanes = [];
    if (body.lang && ['fa', 'en'].includes(body.lang) && body.lang !== cfg.lang) config.save({ lang: body.lang });
    let chosen = model || cfg.defaultModel;
    if (mode === 'direct') {
      if (chosen === 'auto') chosen = routeAuto({ text: String(text || ''), history, planMode, hasFiles: /<attached_(file|image)/.test(String(text || '')) });
      lanes.push(startLane({ chatId, runId, lane: '', modelKey: chosen, history, planMode, autonomy, webMode, notes, pinned }));
    } else {
      let pair = (models.length === 2 ? models : cfg.compareModels).map((k) => (k === 'auto' ? routeAuto({ text: String(text || ''), history, planMode }) : k));
      if (mode === 'battle') { const pool = config.allModels().filter((x) => config.resolve(x.key)?.apiKey).map((x) => x.key); pair = pool.sort(() => Math.random() - 0.5).slice(0, 2); if (pair.length < 2) pair = [cfg.defaultModel, cfg.defaultModel]; }
      store.updateChat(chatId, { mode, models: pair });
      const laneHistory = (lane) => fresh.messages.filter((x) => x.role === 'user' || (x.role === 'assistant' && (x.lane === lane || !x.lane)));
      lanes.push(startLane({ chatId, runId, lane: 'a', modelKey: pair[0], history: laneHistory('a'), planMode, autonomy, webMode, notes, pinned }));
      lanes.push(startLane({ chatId, runId, lane: 'b', modelKey: pair[1], history: laneHistory('b'), planMode, autonomy, webMode, notes, pinned }));
    }
    const titleSrc = String(text || '').replace(/<attached_(file|image)[\s\S]*?<\/attached_\1>/g, '').replace(/\n\n<attached_(file|image)[\s\S]*$/, '').trim() || (images.length ? (cfg.lang === 'en' ? 'Image question' : 'سؤال دربارهٔ تصویر') : '');
    if (!chat.title && titleSrc && !body._hidden) { const fast = config.allModels().find((m) => m.tier === 'fast' && config.resolve(m.key)?.apiKey)?.key || cfg.defaultModel; quick(fast, `Write a 3-6 word title (same language as the message, no quotes, no punctuation) for this chat message:\n\n${titleSrc.slice(0, 500)}`).then((t) => { const tt = (t || '').split('\n')[0].trim().slice(0, 60); if (tt) { store.updateChat(chatId, { title: tt }); broadcast({ event: 'title', chatId, data: { title: tt } }); } }).catch(() => {}); }
    return json(res, 200, { runId, lanes, models: lanes.length === 2 ? store.getChat(chatId).models : [chosen] });
  }
  if (p === '/api/stop' && req.method === 'POST') { let n = 0; for (const id of body.runIds || [body.runId]) if (stopRun(id)) n++; return json(res, 200, { stopped: n }); }
  if (p === '/api/approve' && req.method === 'POST') return json(res, 200, { ok: approve(body.runId, body.callId, body.decision || 'allow') });

  // ---- workspace ----
  if (p === '/api/workspace/office') {
    const rp = q.get('path') || ''; const ext = path.extname(rp).toLowerCase();
    try {
      if (ext === '.docx') { const r = await tools.callTool('read_docx', { path: rp }); return json(res, 200, r.error ? r : { markdown: r.markdown }); }
      if (ext === '.pdf') { const r = await tools.callTool('read_pdf', { path: rp, max_chars: 60000 }); return json(res, 200, r.error ? r : { markdown: `**${r.pages} pages**\n\n` + r.text }); }
      if (ext === '.xlsx' || ext === '.csv') { const r = await tools.callTool('read_xlsx', { path: rp, max_rows: 300 }); if (r.error) return json(res, 200, r); const mdParts = r.sheets.map((sh) => { const rows = sh.rows || []; if (!rows.length) return `### ${sh.name}\n_(empty)_`; const w = Math.max(...rows.map((x) => x.length)); const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '); const line = (rw) => '| ' + Array.from({ length: w }, (_, i) => cell(rw[i])).join(' | ') + ' |'; return `### ${sh.name} (${sh.total_rows} rows)\n\n${line(rows[0])}\n|${' --- |'.repeat(w)}\n${rows.slice(1).map(line).join('\n')}`; }); return json(res, 200, { markdown: mdParts.join('\n\n') }); }
      if (ext === '.pptx') { const r = await readPptx(rp); return json(res, 200, r); }
      return json(res, 400, { error: 'unsupported' });
    } catch (e) { return json(res, 200, { error: e.message }); }
  }
  if (p === '/api/workspace/files') return json(res, 200, await tools.callTool('list_files', { path: q.get('path') || '.', depth: 6 }));
  if (p === '/api/workspace/file') {
    if (req.method === 'GET') return json(res, 200, await tools.callTool('read_file', { path: q.get('path'), limit: 5000 }));
    if (req.method === 'POST') return json(res, 200, await tools.callTool('write_file', { path: body.path, content: body.content }));
  }
  if (p === '/api/memory') {
    const f = path.join(config.getDataDir(), 'memory.md');
    if (req.method === 'GET') return json(res, 200, { text: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '' });
    if (req.method === 'POST') { fs.writeFileSync(f, body.text || ''); return json(res, 200, { ok: true }); }
  }
  json(res, 404, { error: 'no route ' + p });
}

async function readPptx(rp) {
  const JSZip = require('jszip');
  const f = path.join(config.workspaceDir(), rp);
  const zip = await JSZip.loadAsync(fs.readFileSync(f));
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
  const out = [];
  for (const n of names) {
    const xml = await zip.file(n).async('string');
    const paras = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) => [...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join('')).filter((t) => t.trim());
    const idx = +n.match(/(\d+)\.xml/)[1];
    out.push(`### Slide ${idx}${paras.length ? ': ' + paras[0] : ''}\n\n${paras.slice(1).map((t) => '- ' + t).join('\n')}${/<c:chart/.test(xml) ? '\n\n_📊 chart_' : ''}${/<a:tbl>/.test(xml) ? '\n\n_📋 table_' : ''}`);
  }
  return { markdown: out.join('\n\n') || '_(no slides)_' };
}
const WS_MIME = { ...MIME, '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.wasm': 'application/wasm', '.py': 'text/plain; charset=utf-8' };
function serveWorkspace(res, rel) {
  const root = path.resolve(config.workspaceDir());
  const fp = path.resolve(root, decodeURIComponent(rel));
  if (!fp.startsWith(root + path.sep) && fp !== root) { res.writeHead(403); return res.end('forbidden'); }
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const size = fs.statSync(fp).size; const ct = WS_MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
  const range = res.req && res.req.headers.range; // video/audio seeking needs byte ranges
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/); let start = m && m[1] ? +m[1] : 0; let end = m && m[2] ? +m[2] : size - 1; if (start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); } end = Math.min(end, size - 1);
    res.writeHead(206, { 'content-type': ct, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'no-cache' });
    return fs.createReadStream(fp, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': ct, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
  fs.createReadStream(fp).pipe(res);
}

function serveStatic(req, res, url) {
  let fp = url.pathname === '/' ? '/index.html' : url.pathname;
  if (fp.startsWith('/ws/')) return serveWorkspace(res, fp.slice(4));
  if (fp.startsWith('/assets/')) fp = path.join(__dirname, '..', fp);
  else fp = path.join(UI, fp);
  if (!fp || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const ext = path.extname(fp).toLowerCase();
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': /\/vendor\/|\/assets\//.test(fp) ? 'public, max-age=86400' : 'no-cache' };
  const ae = String(req.headers['accept-encoding'] || '');
  if (/\.(js|css|html|svg|json)$/.test(ext) && ae.includes('gzip')) { headers['content-encoding'] = 'gzip'; res.writeHead(200, headers); return fs.createReadStream(fp).pipe(zlib.createGzip({ level: 6 })).pipe(res); }
  res.writeHead(200, headers);
  fs.createReadStream(fp).pipe(res);
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end(); }
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) { console.error(e); try { json(res, 500, { error: e.message }); } catch (_) {} }
  });
}

let lastAnnounced = '';
function startBackground() {
  const tick = async () => {
    try { await vault.refresh(); } catch (_) {}
    try { await remote.refreshRemote(); } catch (_) {}
    try { const u = await remote.checkForUpdates(); /* internally cached for 6 h */ if (u.available && u.latest !== lastAnnounced) { lastAnnounced = u.latest; broadcast({ event: 'update', data: { available: true, latest: u.latest, notes: u.notes, url: u.url, mustUpdate: u.mustUpdate } }); } } catch (_) {}
  };
  vault.refresh().catch(() => {}); // keys first — the first message must not wait for the update check
  setTimeout(tick, 4000); setInterval(tick, 15 * 60 * 1000).unref();
}
function listen(port, host) {
  startBackground();
  try { store.sweepRunning(); } catch (_) {}
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(port, host, () => resolve({ server: srv, port: srv.address().port }));
  });
}

if (require.main === module) {
  const port = +(process.env.PORT || 7860);
  if (process.env.ORCA_DATA) config.setDataDir(process.env.ORCA_DATA);
  // Web mode has no authentication and the agent can run shell commands: bind to loopback unless HOST is set explicitly.
  const host = process.env.HOST || '127.0.0.1';
  listen(port, host).then(({ port }) => {
    console.log(`ORCA web mode → http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  data: ${config.getDataDir()}`);
    if (host === '0.0.0.0') console.log('WARNING: listening on all interfaces without authentication — anyone on your network can control this agent. Use a firewall or a reverse proxy with auth.');
  });
}

module.exports = { listen, createServer };
