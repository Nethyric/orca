'use strict';
// ORCA 1.4 extras: vision (OCR + vision-model bridge), social media downloader (yt-dlp bundled),
// trending feeds, image/video generation, and agent tools inspired by modern coding agents:
// grep / glob / todo list / sub-agent tasks / diagnostics / project memory (ORCA.md).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const config = require('./config');

const isWin = process.platform === 'win32';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- bundled binaries ----------
function findBin(name) {
  const exe = isWin ? name + '.exe' : name;
  const cands = [];
  if (process.resourcesPath) cands.push(path.join(process.resourcesPath, 'bin', exe));
  cands.push(path.join(__dirname, '..', '..', 'bin', exe));
  if (process.env[name.toUpperCase().replace(/-/g, '_') + '_PATH']) cands.push(process.env[name.toUpperCase().replace(/-/g, '_') + '_PATH']);
  for (const c of cands) if (c && fs.existsSync(c)) { if (!isWin) { try { fs.accessSync(c, fs.constants.X_OK); } catch (_) { try { fs.chmodSync(c, 0o755); } catch (__) {} } } return c; }
  try { execSync((isWin ? 'where ' : 'command -v ') + exe, { stdio: 'ignore', windowsHide: true }); return exe; } catch (_) { return null; }
}
function run(cmd, args, { cwd, timeout = 600, onLine } = {}) {
  return new Promise((resolve) => {
    let out = '', done = false;
    let child;
    try { child = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); }
    catch (e) { return resolve({ code: 1, out: e.message }); }
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch (_) {} resolve({ code: 124, out: out + `\n[timed out after ${timeout}s]` }); } }, timeout * 1000);
    const onData = (d) => { const s = d.toString('utf8'); out += s; if (onLine) s.split(/\r?\n/).forEach((l) => l && onLine(l)); if (out.length > 400000) out = out.slice(-200000); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: 1, out: out + '\n' + e.message }); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: code ?? 0, out }); } });
  });
}
async function fetchJson(url, opts = {}, timeoutMs = 25000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { redirect: 'follow', ...opts, headers: { 'user-agent': UA, accept: 'application/json,text/plain,*/*', ...(opts.headers || {}) }, signal: ctl.signal });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json, text };
  } finally { clearTimeout(t); }
}
async function download(url, dest, { headers = {}, timeoutMs = 300000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return { bytes: buf.length, type: r.headers.get('content-type') || '' };
  } finally { clearTimeout(t); }
}
const sanitize = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';
const fmtN = (n) => (n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));

function makeTools({ safe, rel, WS }) {
  // ================= VISION =================
  let ocrWorker = null, ocrLangs = '';
  async function getOcr(langs) {
    const want = langs.join('+');
    if (ocrWorker && ocrLangs === want) return ocrWorker;
    if (ocrWorker) { try { await ocrWorker.terminate(); } catch (_) {} ocrWorker = null; }
    const { createWorker } = require('tesseract.js');
    const dataTess = path.join(config.getDataDir(), 'tessdata');
    const langDirs = [process.resourcesPath && path.join(process.resourcesPath, 'tessdata'), path.join(__dirname, '..', '..', 'assets', 'tessdata'), dataTess].filter(Boolean);
    let langPath = langDirs.find((d) => langs.every((l) => fs.existsSync(path.join(d, l + '.traineddata'))));
    if (!langPath) { // assemble the language files once in the data dir (copy from any bundle dir, else fetch tessdata_fast)
      fs.mkdirSync(dataTess, { recursive: true });
      for (const l of langs) {
        const f = path.join(dataTess, l + '.traineddata'); if (fs.existsSync(f)) continue;
        const src = langDirs.map((d) => path.join(d, l + '.traineddata')).find((q) => fs.existsSync(q));
        if (src) fs.copyFileSync(src, f); else await download(`https://github.com/tesseract-ocr/tessdata_fast/raw/main/${l}.traineddata`, f, { timeoutMs: 180000 });
      }
      langPath = dataTess;
    }
    const cachePath = path.join(config.getDataDir(), 'tesscache'); fs.mkdirSync(cachePath, { recursive: true });
    // the worker thread must load from a real path (outside app.asar) — electron-builder unpacks tesseract.js + deps
    let workerPath; try { workerPath = require.resolve('tesseract.js/src/worker-script/node/index.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'); } catch (_) {}
    ocrWorker = await createWorker(langs, 1, { langPath, gzip: false, cachePath, ...(workerPath ? { workerPath } : {}), logger: () => {}, errorHandler: (e) => { console.error('[ocr]', e && e.message || e); } });
    ocrLangs = want;
    return ocrWorker;
  }
  async function ocrImage(absPath, langs) {
    // default OCR languages: English + the UI language's script (fa → fas, ru → rus, zh → chi_sim); files are bundled or fetched once
    const ui = (() => { try { return config.load().lang; } catch (_) { return 'en'; } })();
    const extra = ({ fa: 'fas', ru: 'rus', zh: 'chi_sim' })[ui];
    const w = await getOcr(langs && langs.length ? langs : extra ? ['eng', extra] : ['eng']);
    const r = await w.recognize(absPath);
    let text = r.data.text.trim(); const conf = Math.round(r.data.confidence || 0);
    // drop garbage: very low confidence or only punctuation/1-2 chars
    if (conf < 25 || text.replace(/[^\p{L}\p{N}]/gu, '').length < 3) text = '';
    return { text, confidence: conf };
  }
  // cheap visual summary when no vision model: dominant colours + brightness via ffmpeg (bundled)
  async function paletteOf(absPath) {
    const ff = findBin('ffmpeg'); if (!ff) return null;
    return new Promise((resolve) => {
      const child = spawn(ff, ['-v', 'error', '-i', absPath, '-vf', 'scale=12:12:flags=area', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { windowsHide: true });
      const chunks = []; child.stdout.on('data', (d) => chunks.push(d)); child.on('error', () => resolve(null));
      child.on('close', () => {
        const b = Buffer.concat(chunks); if (b.length < 12 * 12 * 3) return resolve(null);
        const buckets = new Map(); let lum = 0;
        for (let i = 0; i < b.length; i += 3) { const r = b[i], g = b[i + 1], bl = b[i + 2]; lum += 0.2126 * r + 0.7152 * g + 0.0722 * bl; const k = [r, g, bl].map((v) => Math.round(v / 51) * 51).join(','); buckets.set(k, (buckets.get(k) || 0) + 1); }
        const n = b.length / 3; const top = [...buckets.entries()].sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k, c]) => { const [r, g, bl] = k.split(',').map(Number); return `#${[r, g, bl].map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('')} (${Math.round(c / n * 100)}%)`; });
        resolve({ brightness: Math.round(lum / n), dominant_colors: top });
      });
    });
  }
  function imageMeta(absPath) {
    const buf = Buffer.alloc(64); const fd = fs.openSync(absPath, 'r'); fs.readSync(fd, buf, 0, 64, 0); fs.closeSync(fd);
    let width = 0, height = 0, format = path.extname(absPath).slice(1).toLowerCase();
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { width = buf.readUInt32BE(16); height = buf.readUInt32BE(20); format = 'png'; }
    else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) { width = buf.readUInt16LE(6); height = buf.readUInt16LE(8); format = 'gif'; }
    else if (buf[0] === 0xff && buf[1] === 0xd8) {
      format = 'jpeg';
      try { const b = fs.readFileSync(absPath); let i = 2; while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { height = b.readUInt16BE(i + 5); width = b.readUInt16BE(i + 7); break; } i += 2 + b.readUInt16BE(i + 2); } } catch (_) {}
    } else if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') { format = 'webp'; }
    return { width, height, format, bytes: fs.statSync(absPath).size };
  }
  // A vision-capable model (optional): any OpenAI-compatible endpoint that accepts image_url parts.
  function visionModel() {
    const c = config.load();
    const v = c.vision || {};
    const pv = (c.providers || {});
    const keyOf = (id) => (pv[id] && pv[id].apiKey) || '';
    const urlOf = (id) => (pv[id] && pv[id].baseUrl) || '';
    // 1) explicit choice: custom endpoint or one of the user's providers (+ optional model override)
    if (v.provider === 'custom' && v.baseUrl && v.model) return { baseUrl: v.baseUrl.replace(/\/+$/, ''), apiKey: v.apiKey || '', model: v.model };
    if (v.provider && pv[v.provider]) {
      const p = pv[v.provider]; const m = v.model || ((p.models || []).find((x) => x.attachment) || {}).id;
      const base = v.baseUrl || p.baseUrl; const key = v.apiKey || p.apiKey;
      if (m && base && (key || p.local)) return { baseUrl: base.replace(/\/+$/, ''), apiKey: key || '', model: m };
    }
    // 2) auto: any user provider whose catalog says a selected model accepts images
    for (const [, p] of Object.entries(pv)) { const m = (p.models || []).find((x) => x.attachment); if ((p.apiKey || p.local) && m && p.baseUrl) return { baseUrl: p.baseUrl.replace(/\/+$/, ''), apiKey: p.apiKey || '', model: m.id }; }
    // 3) legacy: a bare key + model typed directly
    if (v.model && v.apiKey && v.baseUrl) return { baseUrl: v.baseUrl.replace(/\/+$/, ''), apiKey: v.apiKey, model: v.model };
    return null;
  }
  async function describeWithVision(absPath, question) {
    const vm = visionModel(); if (!vm) return null;
    const meta = imageMeta(absPath);
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[meta.format] || 'image/png';
    const b64 = fs.readFileSync(absPath).toString('base64');
    const body = { model: vm.model, max_tokens: 900, messages: [{ role: 'user', content: [{ type: 'text', text: question || 'Describe this image in detail. Transcribe any text exactly. If it is a screenshot of code or an error, quote it verbatim.' }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }] };
    const r = await fetchJson(vm.baseUrl + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + vm.apiKey, 'content-type': 'application/json' }, body: JSON.stringify(body) }, 90000);
    if (r.status >= 400 || !r.json) throw new Error(`vision model HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    return { model: vm.model, text: (r.json.choices?.[0]?.message?.content || '').trim() };
  }
  async function analyzeImage(absPath, { question, ocr = true, langs } = {}) {
    const meta = imageMeta(absPath);
    const out = { path: rel(absPath), ...meta };
    try { const v = await describeWithVision(absPath, question); if (v && v.text) { out.vision = v.text; out.vision_model = v.model; } } catch (e) { out.vision_error = e.message; }
    if (ocr) { try { const o = await ocrImage(absPath, langs); out.ocr_text = o.text; out.ocr_confidence = o.confidence; } catch (e) { out.ocr_error = e.message; } }
    if (!out.vision) {
      try { const pal = await paletteOf(absPath); if (pal) Object.assign(out, pal); } catch (_) {}
      out.note = 'No vision-capable model is configured (the built-in chat models are text-only), so only OCR text + colour summary are available. Be honest about what cannot be seen. Full image understanding: add an OpenRouter key (Settings → Models; free vision models exist) or set a vision model in Settings → Agent.';
    }
    return out;
  }

  // ================= SOCIAL DOWNLOADER =================
  const ytdlp = () => findBin('yt-dlp');
  const ffmpegBin = () => findBin('ffmpeg');
  const platformOf = (u) => /tiktok\.com|vm\.tiktok/.test(u) ? 'tiktok' : /instagram\.com/.test(u) ? 'instagram' : /(^|\/\/)(x\.com|twitter\.com|t\.co)/.test(u) ? 'x' : /youtu\.?be/.test(u) ? 'youtube' : /facebook\.com|fb\.watch/.test(u) ? 'facebook' : /reddit\.com/.test(u) ? 'reddit' : /pinterest\./.test(u) ? 'pinterest' : /threads\.net|threads\.com/.test(u) ? 'threads' : 'other';
  const cookiesArgs = (cookies) => {
    const c = config.load();
    const file = cookies || c.cookiesFile || '';
    if (file && fs.existsSync(file)) return ['--cookies', file];
    if (cookies && /^(chrome|edge|firefox|brave|opera|vivaldi|chromium)$/i.test(cookies)) return ['--cookies-from-browser', cookies.toLowerCase()];
    if (c.cookiesBrowser) return ['--cookies-from-browser', c.cookiesBrowser];
    return [];
  };
  async function ytdlpInfo(url, extra = []) {
    const y = ytdlp(); if (!y) return { error: 'yt-dlp binary missing' };
    const r = await run(y, ['--no-warnings', '--no-playlist', '-J', ...extra, url], { timeout: 120 });
    if (r.code !== 0) return { error: r.out.split('\n').filter((l) => /ERROR/.test(l)).join(' ').slice(0, 400) || r.out.slice(-400) };
    try { const j = JSON.parse(r.out.slice(r.out.indexOf('{'))); return { info: j }; } catch (_) { return { error: 'bad json from yt-dlp' }; }
  }
  // TikTok via public tikwm API (no watermark, photo carousels)
  async function tikwm(url) {
    const r = await fetchJson('https://www.tikwm.com/api/?hd=1&url=' + encodeURIComponent(url), {}, 30000);
    if (!r.json || r.json.code !== 0) throw new Error('tikwm: ' + (r.json?.msg || r.status));
    const d = r.json.data;
    const abs = (u) => (u && u.startsWith('/') ? 'https://www.tikwm.com' + u : u);
    return { id: d.id, title: d.title, author: d.author?.unique_id, plays: d.play_count, likes: d.digg_count, duration: d.duration, video: abs(d.hdplay || d.play), watermark: abs(d.wmplay), music: abs(d.music), images: (d.images || []).map(abs), cover: abs(d.cover) };
  }
  // Instagram public fallbacks (profile feed + post via yt-dlp)
  const IG_H = { 'x-ig-app-id': '936619743392459', accept: '*/*', referer: 'https://www.instagram.com/' };
  async function igProfile(username) {
    let r, u;
    for (let a = 0; a < 3 && !u; a++) {
      if (a) await sleep(1500 * a);
      r = await fetchJson(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, { headers: { ...IG_H, ...(a === 1 ? { 'user-agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 458229237)' } : {}) } }, 25000);
      u = r.json?.data?.user;
    }
    if (!u) throw new Error(`instagram profile "${username}" not reachable right now (HTTP ${r.status}${r.status === 401 || r.status === 429 ? ': Instagram rate-limits anonymous requests from this IP — wait a few minutes or set cookies in Settings' : ''})`);
    const posts = (u.edge_owner_to_timeline_media?.edges || []).map((e) => e.node).map((n) => ({ shortcode: n.shortcode, url: `https://www.instagram.com/p/${n.shortcode}/`, type: n.is_video ? 'video' : n.__typename === 'GraphSidecar' ? 'carousel' : 'image', likes: n.edge_liked_by?.count, views: n.video_view_count, comments: n.edge_media_to_comment?.count, caption: (n.edge_media_to_caption?.edges?.[0]?.node?.text || '').slice(0, 200), media: n.is_video ? n.video_url : n.display_url, thumb: n.display_url, children: (n.edge_sidecar_to_children?.edges || []).map((c) => c.node.is_video ? c.node.video_url : c.node.display_url), taken_at: n.taken_at_timestamp }));
    return { username: u.username, full_name: u.full_name, followers: u.edge_followed_by?.count, following: u.edge_follow?.count, posts_total: u.edge_owner_to_timeline_media?.count, bio: u.biography, private: u.is_private, verified: u.is_verified, avatar: u.profile_pic_url_hd, posts };
  }
  // X via fxtwitter/vxtwitter public APIs (photos + videos), then yt-dlp
  async function xPost(url) {
    const m = url.match(/status\/(\d+)/); if (!m) throw new Error('not a status URL');
    const id = m[1];
    for (const api of [`https://api.fxtwitter.com/i/status/${id}`, `https://api.vxtwitter.com/i/status/${id}`]) {
      try {
        const r = await fetchJson(api, {}, 20000);
        const t = r.json?.tweet || r.json; if (!t || (r.json?.code && r.json.code !== 200) || t.type === 'tombstone') continue;
        const media = t.media?.all || t.media_extended || [];
        const items = media.map((x) => ({ type: x.type === 'gif' ? 'video' : x.type, url: x.type === 'photo' || x.type === 'image' ? x.url : (x.url || x.variants?.[0]?.url), thumb: x.thumbnail_url }));
        return { id, author: t.author?.screen_name || t.user_screen_name, text: t.text, likes: t.likes, views: t.views, media: items };
      } catch (_) {}
    }
    throw new Error('post not reachable via public APIs (private/age-gated/deleted or X blocked it) — try with cookies');
  }
  async function saveMedia(url, outDir, base, ext, headers) {
    const target = path.join(outDir, `${sanitize(base)}.${ext}`);
    let dest = target, n = 1; while (fs.existsSync(dest)) dest = target.replace(/\.[^.]+$/, `-${n++}$&`);
    const r = await download(url, dest, { headers });
    return { path: rel(dest), bytes: r.bytes };
  }
  async function socialDownload({ url, output_dir = 'downloads', quality = 'best', audio_only = false, no_watermark = true, cookies, max_items = 20 }) {
    if (!url) return { error: 'url is required' };
    url = String(url).trim();
    const plat = platformOf(url);
    const outDir = safe(path.join(output_dir, plat)); fs.mkdirSync(outDir, { recursive: true });
    const files = []; const notes = [];
    const stamp = () => new Date().toISOString().slice(0, 10);
    // --- TikTok ---
    if (plat === 'tiktok' && !audio_only) {
      try {
        const d = await tikwm(url);
        const base = `${d.author || 'tiktok'} - ${d.title || d.id}`.slice(0, 70);
        if (d.images && d.images.length) {
          for (const [i, img] of d.images.slice(0, max_items).entries()) files.push(await saveMedia(img, outDir, `${base} [${i + 1}]`, 'jpg'));
          if (d.music) files.push(await saveMedia(d.music, outDir, `${base} [sound]`, 'mp3'));
          notes.push('photo carousel: saved all images + original sound');
        } else if (d.video) {
          files.push(await saveMedia(no_watermark ? d.video : (d.watermark || d.video), outDir, base, 'mp4'));
          notes.push(no_watermark ? 'no-watermark HD source' : 'watermarked source');
        }
        return { ok: true, platform: plat, title: d.title, author: d.author, plays: d.plays, likes: d.likes, duration: d.duration, files, notes };
      } catch (e) { notes.push('tikwm fallback: ' + e.message); }
    }
    // --- X photos/videos via public APIs ---
    if (plat === 'x') {
      try {
        const p = await xPost(url);
        if (p.media.length) {
          for (const [i, m] of p.media.slice(0, max_items).entries()) {
            if (m.type === 'photo' || m.type === 'image') { const u = m.url.includes('?') ? m.url : m.url + '?name=orig'; files.push(await saveMedia(u, outDir, `${p.author} - ${p.id} [${i + 1}]`, (m.url.match(/\.(png|jpe?g|webp)/i) || [, 'jpg'])[1].replace('jpeg', 'jpg'))); }
            else files.push(await saveMedia(m.url, outDir, `${p.author} - ${p.id}${p.media.length > 1 ? ' [' + (i + 1) + ']' : ''}`, 'mp4'));
          }
          if (audio_only && files.some((f) => f.path.endsWith('.mp4'))) notes.push('audio_only ignored for X photo/video mix — extract with media_edit(extract_audio)');
          return { ok: true, platform: plat, author: p.author, text: p.text, likes: p.likes, views: p.views, files, notes };
        }
        notes.push('post has no media via public API; trying yt-dlp');
      } catch (e) { notes.push(e.message); }
    }
    // --- Instagram profile URL → latest posts ---
    const igUser = plat === 'instagram' && url.match(/instagram\.com\/([A-Za-z0-9_.]+)\/?(\?|$)/) && !/\/(p|reel|reels|tv|stories|explore)\//.test(url) ? url.match(/instagram\.com\/([A-Za-z0-9_.]+)/)[1] : null;
    if (igUser && !['p', 'reel', 'reels', 'explore', 'stories', 'accounts'].includes(igUser)) {
      try {
        const prof = await igProfile(igUser);
        let n = 0;
        for (const post of prof.posts) {
          if (n >= max_items) break;
          const urls = post.children.length ? post.children : [post.media];
          for (const [i, mu] of urls.entries()) { if (!mu) continue; files.push(await saveMedia(mu, outDir, `${prof.username} - ${post.shortcode}${urls.length > 1 ? ' [' + (i + 1) + ']' : ''}`, /\.mp4|video/.test(mu) || (post.type === 'video' && !post.children.length) ? 'mp4' : 'jpg')); }
          n++;
        }
        return { ok: true, platform: plat, profile: { username: prof.username, full_name: prof.full_name, followers: prof.followers, posts_total: prof.posts_total }, downloaded_posts: n, files, notes: ['latest public posts of the profile (photos, carousels, videos). Stories/private content need cookies.'] };
      } catch (e) { notes.push(e.message); }
    }
    // --- generic: yt-dlp (YouTube, Instagram posts/reels, X videos, TikTok, Facebook, Reddit, 1800+ sites) ---
    const y = ytdlp(); if (!y) return { error: 'yt-dlp binary missing (bin/yt-dlp' + (isWin ? '.exe' : '') + ')', notes };
    const ff = ffmpegBin();
    const fmt = audio_only ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0'] : quality === 'best' ? ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4'] : quality === 'small' ? ['-f', 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/bv*[height<=480]+ba/wv*+wa/w', '-S', 'res:480,+size', '--merge-output-format', 'mp4'] : ['-f', `bv*[height<=${parseInt(quality) || 1080}][ext=mp4]+ba[ext=m4a]/b[height<=${parseInt(quality) || 1080}]/b`, '--merge-output-format', 'mp4'];
    const args = ['--no-warnings', '--no-playlist', '--newline', '--no-colors', '--restrict-filenames', '--windows-filenames', '--write-thumbnail', '--convert-thumbnails', 'jpg', '--playlist-end', String(max_items), '-o', path.join(outDir, '%(uploader,channel,creator|unknown)s - %(title).60s [%(id)s].%(ext)s'), ...(ff ? ['--ffmpeg-location', path.dirname(ff)] : []), ...fmt, ...cookiesArgs(cookies), url];
    if (/\/(playlist|@|channel|user|c)\//.test(url) || /list=/.test(url)) args.splice(args.indexOf('--no-playlist'), 1);
    const before = new Set(fs.readdirSync(outDir));
    const r = await run(y, args, { timeout: 900 });
    const created = fs.readdirSync(outDir).filter((f) => !before.has(f));
    for (const f of created) files.push({ path: rel(path.join(outDir, f)), bytes: fs.statSync(path.join(outDir, f)).size });
    if (r.code !== 0 && !files.length) {
      const err = r.out.split('\n').filter((l) => /ERROR/.test(l)).join(' | ').slice(0, 500) || r.out.slice(-500);
      const loginWall = /login|cookies|rate-limit|429|empty media response|not available|private/i.test(err);
      return { error: err, platform: plat, notes, hint: loginWall ? 'This content requires being logged in. Export cookies from your browser ("Get cookies.txt LOCALLY" extension) and set the file in Settings → Agent → cookies file, or pass cookies:"chrome"/"firefox"/"edge" to read them from the browser.' : undefined };
    }
    const media = files.filter((f) => !/\.(jpg|webp|png)$/i.test(f.path));
    const title = (r.out.match(/\[download\] Destination: .*[\\/](.+)\.[a-z0-9]+$/m) || [])[1];
    return { ok: true, platform: plat, engine: 'yt-dlp', title, files: media.length ? [...media, ...files.filter((f) => /\.(jpg|webp|png)$/i.test(f.path))] : files, notes };
  }

  // ---- Trending / explore ----
  async function socialTrending({ platform = 'tiktok', region = 'US', count = 10, query, download: dl = false, output_dir = 'downloads', max_download = 5 }) {
    count = Math.min(Math.max(+count || 10, 1), 50);
    const items = [];
    let note = '';
    if (platform === 'tiktok') {
      if (query) {
        const r = await fetchJson(`https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(query)}&count=${count}&region=${region}`, {}, 30000);
        for (const v of r.json?.data?.videos || []) items.push({ platform, title: v.title, author: v.author?.unique_id, plays: v.play_count, likes: v.digg_count, duration: v.duration, url: `https://www.tiktok.com/@${v.author?.unique_id}/video/${v.video_id || v.id}`, cover: v.cover });
        if (!items.length) note = 'TikTok search API returned nothing (' + (r.json?.msg || r.status) + ') — try again in a few seconds or use trending without query.';
      } else {
        const r = await fetchJson(`https://www.tikwm.com/api/feed/list?region=${encodeURIComponent(region)}&count=${count}`, {}, 30000);
        for (const v of r.json?.data || []) items.push({ platform, title: v.title, author: v.author?.unique_id, plays: v.play_count, likes: v.digg_count, comments: v.comment_count, duration: v.duration, url: `https://www.tiktok.com/@${v.author?.unique_id}/video/${v.video_id}`, cover: v.cover });
        if (!items.length) note = 'TikTok trending feed unavailable right now (' + (r.json?.msg || r.status) + ')';
        else note = `TikTok "For You"/explore trending feed for region ${region}`;
      }
    } else if (platform === 'youtube') {
      const y = ytdlp();
      const target = query ? `ytsearch${count}:${query}` : null;
      if (target && y) {
        const r = await run(y, ['--flat-playlist', '--no-warnings', '--print', '%(view_count)s\t%(title)s\t%(channel)s\t%(duration)s\t%(webpage_url)s', target], { timeout: 120 });
        for (const l of r.out.split('\n')) { const [views, title, channel, duration, url] = l.split('\t'); if (url && /^https?:/.test(url)) items.push({ platform, title, author: channel, views: +views || null, duration: +duration || null, url }); }
      } else {
        for (const host of ['api.piped.private.coffee', 'pipedapi.kavin.rocks', 'pipedapi.adminforge.de', 'api.piped.yt']) {
          try { const r = await fetchJson(`https://${host}/trending?region=${encodeURIComponent(region)}`, {}, 12000); if (Array.isArray(r.json) && r.json.length) { for (const v of r.json.slice(0, count)) items.push({ platform, title: v.title, author: v.uploaderName, views: v.views, duration: v.duration, url: 'https://www.youtube.com' + v.url, thumb: v.thumbnail }); note = 'YouTube trending (region ' + region + ')'; break; } } catch (_) {}
        }
        if (!items.length) note = 'YouTube trending feed unavailable; use query to search instead.';
      }
    } else if (platform === 'x') {
      const r = await fetchJson(`https://trends24.in/${region && region !== 'US' ? region.toLowerCase().replace(/\s+/g, '-') + '/' : ''}`, {}, 20000);
      const seen = new Set();
      for (const m of r.text.matchAll(/class=["']?trend-link["']?[^>]*>([^<]{1,80})<\/a>(?:\s*<span class=["']?tweet-count["']?[^>]*data-count=["']?([^"'> ]*)["']?[^>]*>([^<]*)<\/span>)?/g)) { const name = m[1].trim(); if (!name || seen.has(name)) continue; seen.add(name); const cnt = (m[3] || m[2] || '').trim(); items.push({ platform, trend: name, tweets: cnt || undefined, url: `https://x.com/search?q=${encodeURIComponent(name)}&f=live` }); if (items.length >= count) break; }
      if (!items.length) { // fallback source
        try { const g = await fetchJson('https://getdaytrends.com/' + (region && region !== 'US' ? encodeURIComponent(region.toLowerCase().replace(/\s+/g, '-')) + '/' : ''), {}, 20000); for (const m of g.text.matchAll(/<td class="main"><a class="string" href="\/trend\/[^"]+">([^<]+)<\/a><\/td>[\s\S]{0,600}?(?:<span class="small[^"]*">([^<]*)<\/span>)?/g)) { const name = m[1].trim(); if (seen.has(name)) continue; seen.add(name); items.push({ platform, trend: name, tweets: (m[2] || '').trim() || undefined, url: `https://x.com/search?q=${encodeURIComponent(name)}&f=live` }); if (items.length >= count) break; } } catch (_) {}
      }
      note = items.length ? `Current X trends (${region}). To download a post pass its status URL to social_download.` : 'X trends unavailable right now.';
    } else if (platform === 'instagram') {
      if (query && !query.startsWith('#')) {
        try { const prof = await igProfile(query.replace(/^@/, '')); for (const p of prof.posts.slice(0, count)) items.push({ platform, ...p }); note = `Latest public posts of @${prof.username} (${fmtN(prof.followers)} followers)`; }
        catch (e) { note = e.message; }
      } else {
        note = 'Instagram Explore/hashtag feeds are only served to logged-in sessions. Options: (1) give a username → latest posts; (2) set cookies (Settings → Agent) and then social_download a hashtag/explore URL; (3) use TikTok/YouTube trending which are public.';
      }
    } else return { error: 'platform must be tiktok | youtube | x | instagram' };
    const out = { platform, region, count: items.length, items, note };
    if (dl && items.length) {
      out.downloads = [];
      for (const it of items.filter((i) => i.url && !i.trend).slice(0, Math.min(max_download, 10))) {
        const r = await socialDownload({ url: it.url, output_dir });
        out.downloads.push({ url: it.url, ok: !!r.ok, files: r.files || [], error: r.error });
      }
    }
    return out;
  }

  // ================= GENERATION =================
  async function generateImage({ prompt, output = '', width = 1024, height = 1024, seed, model = 'flux', count = 1, negative_prompt }) {
    if (!prompt) return { error: 'prompt is required' };
    count = Math.min(Math.max(+count || 1, 1), 4);
    const c = config.load(); const g = c.imageGen || {};
    const outDir = safe(output ? path.dirname(output) || 'generated' : 'generated'); fs.mkdirSync(outDir, { recursive: true });
    const base = output ? path.basename(output).replace(/\.[^.]+$/, '') : sanitize(prompt.slice(0, 40)) + '-' + Date.now().toString(36);
    const files = [];
    // Provider A: any OpenAI-compatible /images/generations (OpenAI, Together, fal proxy, OpenRouter image models via chat) if configured
    if (g.provider === 'openai' && g.apiKey) {
      const r = await fetchJson((g.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/images/generations', { method: 'POST', headers: { authorization: 'Bearer ' + g.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ model: g.model || 'gpt-image-1', prompt, n: count, size: `${width}x${height}`, response_format: 'b64_json' }) }, 180000);
      if (r.status >= 400 || !r.json) return { error: `image provider HTTP ${r.status}: ${r.text.slice(0, 300)}` };
      for (const [i, d] of (r.json.data || []).entries()) { const f = path.join(outDir, `${base}${count > 1 ? '-' + (i + 1) : ''}.png`); if (d.b64_json) fs.writeFileSync(f, Buffer.from(d.b64_json, 'base64')); else if (d.url) await download(d.url, f); files.push({ path: rel(f), bytes: fs.statSync(f).size }); }
      return { ok: true, provider: 'openai-compatible', model: g.model || 'gpt-image-1', files, prompt };
    }
    const up = (c.providers || {})[g.provider];
    if (g.provider && g.provider !== 'openai' && (up || g.baseUrl)) {
      // any chat-completions provider whose model returns images in message.images (e.g. Gemini-image class models)
      const key = g.apiKey || (up && up.apiKey) || '';
      const base = (g.baseUrl || (up && up.baseUrl) || '').replace(/\/+$/, '');
      if (!base) return { error: 'image provider has no base URL' };
      if (!g.model) return { error: 'set a model id for the image provider in Settings → Agent → Image generation' };
      const r = await fetchJson(base + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ model: g.model, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'] }) }, 180000);
      const imgs = r.json?.choices?.[0]?.message?.images || [];
      if (r.status >= 400 || !imgs.length) return { error: `image provider HTTP ${r.status}: ${r.text.slice(0, 300)}` };
      for (const [i, im] of imgs.entries()) { const url = im.image_url?.url || ''; const m = url.match(/^data:image\/(\w+);base64,(.+)$/); const f = path.join(outDir, `${base}${imgs.length > 1 ? '-' + (i + 1) : ''}.${m ? m[1].replace('jpeg', 'jpg') : 'png'}`); if (m) fs.writeFileSync(f, Buffer.from(m[2], 'base64')); else await download(url, f); files.push({ path: rel(f), bytes: fs.statSync(f).size }); }
      return { ok: true, provider: g.provider, model: g.model, files, prompt };
    }
    // Provider B (default, free, no key): Pollinations
    const errors = [];
    for (let i = 0; i < count; i++) {
      const s = seed != null ? +seed + i : Math.floor(Math.random() * 1e9);
      const q = new URLSearchParams({ width: String(Math.min(+width || 1024, 2048)), height: String(Math.min(+height || 1024, 2048)), seed: String(s), nologo: 'true', model: model || 'flux', enhance: 'false', safe: 'false' });
      if (negative_prompt) q.set('negative_prompt', negative_prompt);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1500))}?${q}`;
      const wantExt = (output && (output.match(/\.(png|jpe?g|webp)$/i) || [])[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
      let f = path.join(outDir, `${base}${count > 1 ? '-' + (i + 1) : ''}.jpg`);
      let ok = false;
      for (let a = 0; a < 3 && !ok; a++) {
        try { const r = await download(url, f, { timeoutMs: 120000 }); if (r.bytes > 3000 && /image/.test(r.type)) ok = true; else errors.push('bad response ' + r.type); } catch (e) { errors.push(e.message); await sleep(2000 * (a + 1)); }
      }
      if (ok && wantExt !== 'jpg') { // honour the requested extension (provider always returns JPEG) — convert with ffmpeg when available
        const ff = ffmpegBin(); const f2 = f.replace(/\.jpg$/, '.' + wantExt);
        if (ff) { const r = await run(ff, ['-y', '-loglevel', 'error', '-i', f, f2], { timeout: 60 }); if (r.code === 0 && fs.existsSync(f2)) { fs.unlinkSync(f); f = f2; } }
      }
      if (ok) files.push({ path: rel(f), bytes: fs.statSync(f).size, seed: s, url });
    }
    if (!files.length) return { error: 'image generation failed: ' + errors.slice(-3).join('; '), hint: 'Set an image provider key in Settings → Agent → Image generation, or retry.' };
    return { ok: true, provider: 'pollinations', model: model || 'flux', files, prompt, note: 'free provider (no key). For OpenAI/gpt-image or Gemini-image quality add a key in Settings.' };
  }

  async function generateVideo({ prompt, output = '', duration = 5, aspect_ratio = '16:9', image, model, wait = true }) {
    if (!prompt) return { error: 'prompt is required' };
    const c = config.load(); const g = c.videoGen || {};
    const outDir = safe(output ? path.dirname(output) || 'generated' : 'generated'); fs.mkdirSync(outDir, { recursive: true });
    const base = output ? path.basename(output).replace(/\.[^.]+$/, '') : sanitize(prompt.slice(0, 40)) + '-' + Date.now().toString(36);
    const dest = path.join(outDir, base + '.mp4');
    const provider = g.provider || '';
    if (!provider || !g.apiKey) {
      // No key: build a real video anyway — generate key frames with the free image provider and animate with ffmpeg (Ken Burns + crossfade).
      const ff = ffmpegBin(); if (!ff) return { error: 'ffmpeg missing' };
      const shots = Math.max(2, Math.min(6, Math.round((+duration || 5) / 2.5)));
      const [w, h] = aspect_ratio === '9:16' ? [720, 1280] : aspect_ratio === '1:1' ? [1024, 1024] : [1280, 720];
      const frames = [];
      for (let i = 0; i < shots; i++) {
        const r = await generateImage({ prompt: `${prompt}, cinematic still frame ${i + 1} of ${shots}, consistent style`, output: path.posix.join(rel(outDir), `${base}-frame${i + 1}.jpg`), width: w, height: h, seed: 1000 + i });
        if (r.ok) frames.push(safe(r.files[0].path));
      }
      if (frames.length < 2) return { error: 'could not generate key frames for the video' };
      const per = Math.max(2, (+duration || 5) / frames.length);
      const fps = 25; const n = Math.round(per * fps);
      const inputs = frames.flatMap((f) => ['-loop', '1', '-framerate', String(fps), '-t', per.toFixed(2), '-i', f]); // exactly `per` seconds per still
      const zoom = frames.map((_, i) => `[${i}:v]scale=${w * 2}:${h * 2},zoompan=z='min(zoom+0.0012,1.25)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=${fps},setsar=1,format=yuv420p[v${i}]`).join(';');
      let chain = ''; let last = 'v0'; let off = per - 0.7;
      for (let i = 1; i < frames.length; i++) { const outL = i === frames.length - 1 ? 'vout' : `x${i}`; chain += `;[${last}][v${i}]xfade=transition=fade:duration=0.7:offset=${off.toFixed(2)}[${outL}]`; last = outL; off += per - 0.7; }
      const filter = zoom + chain;
      const r = await run(ff, ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[vout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest], { timeout: 600 });
      if (r.code !== 0 || !fs.existsSync(dest)) return { error: 'ffmpeg failed: ' + r.out.slice(-400) };
      return { ok: true, provider: 'orca-animated-stills', files: [{ path: rel(dest), bytes: fs.statSync(dest).size }], frames: frames.map(rel), duration: +duration || 5, note: 'No video-generation API key is configured, so ORCA generated AI key-frames and animated them (Ken Burns + crossfade). For true text-to-video (Runway/Kling/Veo/Luma via Replicate or fal.ai) add a key in Settings → Agent → Video generation.' };
    }
    // Provider: Replicate (any video model version) or fal.ai queue
    if (provider === 'replicate') {
      const modelId = model || g.model || 'wan-video/wan-2.2-t2v-fast';
      const input = { prompt, ...(image ? { image: 'data:image/png;base64,' + fs.readFileSync(safe(image)).toString('base64') } : {}), ...(g.extraInput || {}) };
      if (/aspect/.test(JSON.stringify(g.extraInput || {})) === false) input.aspect_ratio = aspect_ratio;
      let r = await fetchJson(`https://api.replicate.com/v1/models/${modelId}/predictions`, { method: 'POST', headers: { authorization: 'Bearer ' + g.apiKey, 'content-type': 'application/json', prefer: 'wait=60' }, body: JSON.stringify({ input }) }, 90000);
      if (r.status >= 400 || !r.json) return { error: `replicate HTTP ${r.status}: ${r.text.slice(0, 300)}` };
      let pred = r.json; const t0 = Date.now();
      while (wait && !['succeeded', 'failed', 'canceled'].includes(pred.status) && Date.now() - t0 < 15 * 60e3) { await sleep(5000); r = await fetchJson(pred.urls.get, { headers: { authorization: 'Bearer ' + g.apiKey } }, 30000); if (r.json) pred = r.json; }
      if (pred.status !== 'succeeded') return { error: 'replicate: ' + (pred.error || pred.status), id: pred.id };
      const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      await download(outUrl, dest, { timeoutMs: 600000 });
      return { ok: true, provider: 'replicate', model: modelId, files: [{ path: rel(dest), bytes: fs.statSync(dest).size }], id: pred.id };
    }
    if (provider === 'fal') {
      const modelId = model || g.model || 'fal-ai/minimax/hailuo-02/standard/text-to-video';
      const body = { prompt, aspect_ratio, duration: String(duration), ...(image ? { image_url: 'data:image/png;base64,' + fs.readFileSync(safe(image)).toString('base64') } : {}), ...(g.extraInput || {}) };
      let r = await fetchJson(`https://queue.fal.run/${modelId}`, { method: 'POST', headers: { authorization: 'Key ' + g.apiKey, 'content-type': 'application/json' }, body: JSON.stringify(body) }, 60000);
      if (r.status >= 400 || !r.json) return { error: `fal HTTP ${r.status}: ${r.text.slice(0, 300)}` };
      const { status_url, response_url } = r.json; const t0 = Date.now(); let st = r.json;
      while (wait && st.status !== 'COMPLETED' && Date.now() - t0 < 15 * 60e3) { await sleep(5000); r = await fetchJson(status_url, { headers: { authorization: 'Key ' + g.apiKey } }, 30000); if (r.json) st = r.json; if (st.status === 'FAILED') return { error: 'fal: failed', detail: st }; }
      r = await fetchJson(response_url, { headers: { authorization: 'Key ' + g.apiKey } }, 30000);
      const outUrl = r.json?.video?.url || r.json?.videos?.[0]?.url; if (!outUrl) return { error: 'fal: no video url', detail: r.text.slice(0, 300) };
      await download(outUrl, dest, { timeoutMs: 600000 });
      return { ok: true, provider: 'fal', model: modelId, files: [{ path: rel(dest), bytes: fs.statSync(dest).size }] };
    }
    return { error: `unknown video provider "${provider}" (use replicate | fal)` };
  }

  // ================= CODING-AGENT TOOLS =================
  const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache', 'release', '.orca_tmp']);
  const globToRe = (glob) => new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '§§').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/§§/g, '(?:.*/)?') + '$');
  function walk(root, onFile, maxFiles = 20000) {
    let n = 0;
    (function rec(d) { if (n > maxFiles) return; let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; } for (const e of ents) { if (SKIP.has(e.name)) continue; const fp = path.join(d, e.name); if (e.isDirectory()) rec(fp); else { n++; onFile(fp); } } })(root);
  }
  async function glob({ pattern, path: p = '.', limit = 200 }) {
    if (!pattern) return { error: 'pattern is required (e.g. **/*.js)' };
    const root = safe(p); const re = globToRe(pattern.replace(/^\.\//, ''));
    const hits = [];
    walk(root, (fp) => { const r = path.relative(root, fp).replace(/\\/g, '/'); if (re.test(r) || re.test(path.basename(fp))) { let st; try { st = fs.statSync(fp); } catch (_) { return; } hits.push({ path: rel(fp), bytes: st.size, mtime: st.mtimeMs }); } });
    hits.sort((a, b) => b.mtime - a.mtime);
    return { count: hits.length, files: hits.slice(0, limit).map((h) => `${h.path} (${h.bytes}B)`), truncated: hits.length > limit };
  }
  async function grep({ pattern, path: p = '.', glob: g = '', context = 0, max_results = 80, case_sensitive = false }) {
    if (!pattern) return { error: 'pattern is required' };
    let re; try { re = new RegExp(pattern, case_sensitive ? '' : 'i'); } catch (e) { return { error: 'bad regex: ' + e.message }; }
    const root = safe(p); const gre = g ? globToRe(g) : null; const hits = []; let scanned = 0;
    walk(root, (fp) => {
      if (hits.length >= max_results) return;
      const r = path.relative(root, fp).replace(/\\/g, '/');
      if (gre && !gre.test(r) && !gre.test(path.basename(fp))) return;
      let st; try { st = fs.statSync(fp); } catch (_) { return; } if (st.size > 2e6) return;
      let txt; try { txt = fs.readFileSync(fp, 'utf8'); } catch (_) { return; } if (txt.includes('\u0000')) return;
      scanned++;
      const lines = txt.split('\n');
      for (let i = 0; i < lines.length && hits.length < max_results; i++) if (re.test(lines[i])) hits.push({ file: rel(fp), line: i + 1, text: lines[i].trim().slice(0, 240), ...(context ? { before: lines.slice(Math.max(0, i - context), i).map((l) => l.slice(0, 200)), after: lines.slice(i + 1, i + 1 + context).map((l) => l.slice(0, 200)) } : {}) });
    });
    return { count: hits.length, scanned_files: scanned, matches: hits, truncated: hits.length >= max_results };
  }
  // ---- todo list (per chat; the UI renders it live) ----
  const todos = new Map(); // chatId -> [{id,text,status}]
  let currentChat = 'default';
  function setCurrentChat(id) { currentChat = id || 'default'; }
  function todoFile(id) { const d = path.join(config.getDataDir(), 'todos'); fs.mkdirSync(d, { recursive: true }); return path.join(d, String(id).replace(/[^\w-]/g, '_') + '.json'); }
  function loadTodos(id) { if (!todos.has(id)) { try { todos.set(id, JSON.parse(fs.readFileSync(todoFile(id), 'utf8'))); } catch (_) { todos.set(id, []); } } return todos.get(id); }
  async function todoWrite({ todos: list, merge = false }) {
    if (!Array.isArray(list)) return { error: 'todos must be an array of {id?, text, status}' };
    const cur = merge ? loadTodos(currentChat) : [];
    for (const t of list) { const id = t.id || ('t' + (cur.length + 1)); const st = ['pending', 'in_progress', 'done', 'cancelled'].includes(t.status) ? t.status : 'pending'; const ex = cur.find((x) => x.id === id); if (ex) Object.assign(ex, { text: t.text || ex.text, status: st }); else cur.push({ id, text: String(t.text || '').slice(0, 300), status: st }); }
    todos.set(currentChat, cur); fs.writeFileSync(todoFile(currentChat), JSON.stringify(cur));
    return { ok: true, todos: cur, _todos: cur };
  }
  async function todoRead() { return { todos: loadTodos(currentChat) }; }
  // ---- diagnostics (syntax check) ----
  async function diagnostics({ path: p }) {
    const files = [];
    if (p) { const f = safe(p); if (fs.statSync(f).isDirectory()) walk(f, (x) => /\.(js|mjs|cjs|py|json)$/.test(x) && files.push(x), 400); else files.push(f); }
    else walk(WS(), (x) => /\.(js|mjs|cjs|py|json)$/.test(x) && files.push(x), 400);
    const problems = []; let checked = 0;
    const py = (() => { for (const c of isWin ? ['python', 'py -3', 'python3'] : ['python3', 'python']) { try { execSync(`${c} --version`, { stdio: 'pipe', windowsHide: true }); return c; } catch (_) {} } return null; })();
    for (const f of files.slice(0, 200)) {
      checked++;
      const ext = path.extname(f);
      if (ext === '.json') { try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { problems.push({ file: rel(f), message: e.message }); } continue; }
      if (/^\.(js|mjs|cjs)$/.test(ext)) { const node = process.execPath; const r = await run(node, ['--check', f], { timeout: 20 }); if (r.code !== 0) { const m = r.out.match(/:(\d+)\n[\s\S]*?\n\n(SyntaxError[^\n]*)/); problems.push({ file: rel(f), line: m ? +m[1] : undefined, message: (m ? m[2] : r.out.split('\n').filter((l) => /Error/.test(l))[0] || r.out).slice(0, 300) }); } continue; }
      if (ext === '.py' && py) { const r = await run(py.split(' ')[0], [...py.split(' ').slice(1), '-m', 'py_compile', f], { timeout: 20 }); if (r.code !== 0) problems.push({ file: rel(f), message: r.out.trim().split('\n').slice(-2).join(' ').slice(0, 300) }); }
    }
    return { checked, problems, ok: problems.length === 0 };
  }
  // ---- project memory (ORCA.md / AGENTS.md / CLAUDE.md in the workspace) ----
  function projectMemory() {
    for (const n of ['ORCA.md', 'AGENTS.md', 'CLAUDE.md', '.orca/rules.md']) { const f = path.join(WS(), n); if (fs.existsSync(f)) { try { return { file: n, text: fs.readFileSync(f, 'utf8').slice(0, 8000) }; } catch (_) {} } }
    return null;
  }
  async function projectInit({ overwrite = false } = {}) {
    const f = path.join(WS(), 'ORCA.md');
    if (fs.existsSync(f) && !overwrite) return { ok: true, exists: true, path: 'ORCA.md', text: fs.readFileSync(f, 'utf8').slice(0, 4000) };
    // quick structural scan
    const langs = {}; let files = 0; const top = new Set();
    walk(WS(), (fp) => { files++; const e = path.extname(fp).toLowerCase(); if (e) langs[e] = (langs[e] || 0) + 1; const r = path.relative(WS(), fp).split(/[\\/]/)[0]; top.add(r); }, 5000);
    const pkg = fs.existsSync(path.join(WS(), 'package.json')) ? JSON.parse(fs.readFileSync(path.join(WS(), 'package.json'), 'utf8')) : null;
    const md = `# ORCA.md — project memory\n\n_ORCA reads this file at the start of every conversation in this workspace. Keep it short and current._\n\n## Project\n- Files: ${files}, top-level: ${[...top].slice(0, 25).join(', ')}\n- Languages: ${Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} (${v})`).join(', ') || '—'}\n${pkg ? `- package.json: ${pkg.name || ''} ${pkg.version || ''}; scripts: ${Object.keys(pkg.scripts || {}).join(', ') || '—'}\n` : ''}\n## Commands\n- build: \n- test: \n- run: \n\n## Conventions\n- \n\n## Decisions & notes\n- \n`;
    fs.writeFileSync(f, md, 'utf8');
    return { ok: true, created: true, path: 'ORCA.md', text: md };
  }

  // ---- sub-agent (delegated task with its own context) ----
  let runSubagent = null; // injected by agent.js to avoid a require cycle
  async function task({ description, prompt, model, max_steps = 14 }) {
    if (!runSubagent) return { error: 'sub-agents unavailable' };
    if (!prompt) return { error: 'prompt is required' };
    return runSubagent({ description, prompt, model, maxSteps: Math.min(+max_steps || 14, 30) });
  }

  // ---- headless Chrome discovery (Chrome/Edge/Chromium on the user's machine; Electron's own binary as a last resort) ----
  function findChrome() {
    const chromes = isWin ? [path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(process.env.LOCALAPPDATA || '', 'Chromium\\Application\\chrome.exe'), path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];
    for (const c of chromes) { if (!c) continue; if (path.isAbsolute(c) ? fs.existsSync(c) : (() => { try { execSync('command -v ' + c, { stdio: 'ignore' }); return true; } catch (_) { return false; } })()) return c; }
    // Playwright's cached chromium (dev machines)
    try { const home = os.homedir(); const roots = [path.join(home, '.cache', 'ms-playwright'), path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')]; for (const r of roots) { if (!fs.existsSync(r)) continue; for (const d of fs.readdirSync(r)) { const cands = [path.join(r, d, 'chrome-linux', 'chrome'), path.join(r, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), path.join(r, d, 'chrome-win', 'chrome.exe'), path.join(r, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')]; for (const c of cands) if (fs.existsSync(c)) return c; } } } catch (_) {}
    return null;
  }
  // ---- browser_check: load a page in headless Chrome, capture console errors + uncaught exceptions + a screenshot ----
  // Uses --remote-debugging-pipe? No: simplest robust path = Chrome's --dump-dom + --enable-logging to a file catches console.error/exceptions.
  async function browserCheck({ url, width = 1280, height = 800, wait_ms = 2500, output = 'screenshots/check.png', keys = [] }) {
    const bin = findChrome();
    if (!bin) return { ok: false, error: 'No Chrome/Edge/Chromium found on this machine — do a static check instead (node --check on scripts, matching tags/ids).' };
    let target = url;
    if (!/^https?:\/\//i.test(target)) { const f = safe(target); if (!fs.existsSync(f)) return { error: 'file not found: ' + target }; target = 'file:///' + f.replace(/\\/g, '/'); }
    const dest = safe(output); fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-bc-')); const logFile = path.join(tmpd, 'chrome_debug.log');
    // A tiny harness page loads the target in an iframe and records errors from it (same-origin for file:// with --allow-file-access-from-files),
    // then also simulates key presses so games advance a few frames before the screenshot.
    const harness = path.join(tmpd, 'harness.html');
    const keysJs = JSON.stringify((Array.isArray(keys) ? keys : String(keys || '').split(',')).map((k) => String(k).trim()).filter(Boolean).slice(0, 12));
    fs.writeFileSync(harness, `<!doctype html><html><body style="margin:0"><iframe id=f src="${target.replace(/"/g, '&quot;')}" style="border:0;width:${width}px;height:${height}px"></iframe><script>
const errs=[];const f=document.getElementById('f');
function hook(w){try{w.addEventListener('error',e=>errs.push('ERROR: '+(e.message||e.type)+' @'+(e.filename||'')+':'+(e.lineno||''))); w.addEventListener('unhandledrejection',e=>errs.push('UNHANDLED PROMISE: '+(e.reason&&e.reason.message||e.reason))); const ce=w.console.error.bind(w.console); w.console.error=(...a)=>{errs.push('console.error: '+a.map(x=>x&&x.stack||String(x)).join(' '));ce(...a)}; const cw=w.console.warn.bind(w.console); w.console.warn=(...a)=>{errs.push('console.warn: '+a.map(String).join(' '));cw(...a)};}catch(e){errs.push('HOOK FAILED (cross-origin?): '+e.message)}}
f.addEventListener('load',()=>{try{hook(f.contentWindow)}catch(e){errs.push('no access: '+e.message)}
 const ks=${keysJs}; let i=0; const tick=()=>{ if(i<ks.length){ try{ const k=ks[i++]; const ev=(t)=>new KeyboardEvent(t,{key:k,code:k,bubbles:true}); f.contentWindow.document.dispatchEvent(ev('keydown')); f.contentWindow.dispatchEvent(ev('keydown')); f.contentWindow.document.dispatchEvent(ev('keyup')); }catch(e){} setTimeout(tick,220);} }; setTimeout(tick,600);
 setTimeout(()=>{ let info={}; try{ const d=f.contentDocument; info={title:d.title, bodyText:(d.body&&d.body.innerText||'').slice(0,600), canvases:d.querySelectorAll('canvas').length, imgsBroken:[...d.images].filter(i=>i.complete&&i.naturalWidth===0).length, links:d.links.length, scripts:d.scripts.length}; }catch(e){info={err:e.message}}
 console.log('ORCA_CHECK '+JSON.stringify({errors:errs.slice(0,40),info})); },${Math.min(Math.max(+wait_ms || 2500, 500), 15000)});
});
</script></body></html>`);
    const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--enable-logging=stderr', '--v=0', `--window-size=${width},${height}`, `--screenshot=${dest}`, `--virtual-time-budget=${Math.min(+wait_ms + 4000, 20000)}`, '--user-data-dir=' + path.join(tmpd, 'ud'), 'file:///' + harness.replace(/\\/g, '/')];
    const r = await run(bin, args, { timeout: 60 });
    let report = null; const m = r.out.match(/ORCA_CHECK (\{.*\})/); if (m) { try { report = JSON.parse(m[1]); } catch (_) {} }
    const consoleErrs = [...r.out.matchAll(/CONSOLE.*?"(.*?)", source: (.*?) \(\d+\)/g)].map((x) => x[1]).filter((t) => !/ORCA_CHECK/.test(t)).slice(0, 20);
    try { fs.rmSync(tmpd, { recursive: true, force: true }); } catch (_) {}
    const errors = [...new Set([...(report ? report.errors : []), ...consoleErrs.filter((e) => /error|exception|failed|cannot|undefined|null/i.test(e))])];
    const out = { ok: errors.length === 0, url: url, errors, info: report ? report.info : null, screenshot: fs.existsSync(dest) ? rel(dest) : null, note: errors.length ? 'Fix these errors, then run browser_check again.' : 'No runtime errors detected. Look at the screenshot with view_image if layout matters.' };
    if (!report && !fs.existsSync(dest)) out.error = 'Chrome did not produce a report: ' + r.out.slice(-300);
    return out;
  }

  // ---- screenshots of URLs / local HTML for the agent to inspect (via headless Chrome if present) ----
  async function screenshotUrl({ url, output = 'screenshots/page.png', width = 1280, height = 800, full_page = false }) {
    const dest = safe(output); fs.mkdirSync(path.dirname(dest), { recursive: true });
    const bin = findChrome();
    if (!bin) return { error: 'No Chrome/Edge found for screenshots.' };
    if (!/^https?:\/\//i.test(url)) { const f = safe(url); if (!fs.existsSync(f)) return { error: 'file not found: ' + url }; url = 'file:///' + f.replace(/\\/g, '/'); }
    const r = await run(bin, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--window-size=${width},${height}`, `--screenshot=${dest}`, ...(full_page ? ['--full-page'] : []), '--virtual-time-budget=6000', url], { timeout: 60 });
    if (!fs.existsSync(dest)) return { error: 'screenshot failed: ' + r.out.slice(-300) };
    const a = await analyzeImage(dest, { ocr: true });
    return { ok: true, path: rel(dest), ...a };
  }

  const impl = {
    async view_image({ path: p, question, ocr = true, languages }) {
      if (!p) return { error: 'path is required' };
      let f;
      if (/^https?:\/\//i.test(p)) { f = safe(path.join('.orca_tmp', 'img-' + Date.now() + (path.extname(new URL(p).pathname) || '.jpg'))); await download(p, f); }
      else { f = path.isAbsolute(p) && fs.existsSync(p) ? p : safe(p); }
      if (!fs.existsSync(f)) return { error: 'not found: ' + p };
      const langs = Array.isArray(languages) && languages.length ? languages : undefined;
      return analyzeImage(f, { question, ocr, langs });
    },
    ocr_image: async ({ path: p, languages }) => { const f = safe(p); if (!fs.existsSync(f)) return { error: 'not found: ' + p }; const o = await ocrImage(f, Array.isArray(languages) && languages.length ? languages : undefined); return { path: p, ...o }; },
    screenshot: screenshotUrl,
    browser_check: browserCheck,
    social_download: socialDownload,
    social_trending: socialTrending,
    generate_image: generateImage,
    generate_video: generateVideo,
    glob, grep,
    todo_write: todoWrite, todo_read: todoRead,
    diagnostics,
    project_init: projectInit,
    task,
  };
  const SCHEMAS = [
    { type: 'function', function: { name: 'browser_check', description: 'Load a local HTML file (workspace path) or URL in headless Chrome and report runtime problems: uncaught exceptions, console.error/warn, unhandled promise rejections, broken images, plus page info (title, text excerpt, canvas count) and a screenshot. Optional `keys` (e.g. ["ArrowRight","ArrowRight"," "]) are pressed before the screenshot so games/apps advance. ALWAYS run this after building or changing a web page/app/game, fix every error, re-run until ok:true.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'workspace path like site/index.html or an http(s) URL' }, keys: { type: 'array', items: { type: 'string' }, description: 'key names to press in order (KeyboardEvent.key values)' }, wait_ms: { type: 'number', description: 'time to let the page run before reporting (default 2500)' }, width: { type: 'number' }, height: { type: 'number' }, output: { type: 'string', description: 'screenshot path (default screenshots/check.png)' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'view_image', description: 'Look at an image (workspace path, absolute path or URL): returns size/format, text read by OCR (English + Persian), and — when a vision model is configured — a full visual description. Use for screenshots, error images, UI mockups, photos the user attached (they are saved under attachments/).', parameters: { type: 'object', properties: { path: { type: 'string' }, question: { type: 'string', description: 'what to look for' }, ocr: { type: 'boolean' }, languages: { type: 'array', items: { type: 'string' }, description: 'tesseract langs, default ["eng","fas"]' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'screenshot', description: 'Render a URL or local HTML file in headless Chrome/Edge, save a PNG and OCR it — verify web pages you built.', parameters: { type: 'object', properties: { url: { type: 'string' }, output: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' }, full_page: { type: 'boolean' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'social_download', description: 'Download videos/photos/audio from Instagram (posts, reels, profiles → latest posts), TikTok (no watermark, photo carousels + sound), X/Twitter (photos + videos), YouTube (videos, Shorts, playlists) and 1800+ other sites. Saves into workspace downloads/<platform>/. For login-walled content pass cookies (browser name or cookies.txt path).', parameters: { type: 'object', properties: { url: { type: 'string' }, output_dir: { type: 'string', description: 'default downloads' }, quality: { type: 'string', description: 'best | 1080 | 720 | small' }, audio_only: { type: 'boolean' }, no_watermark: { type: 'boolean' }, cookies: { type: 'string', description: '"chrome"|"firefox"|"edge" or path to cookies.txt' }, max_items: { type: 'integer', description: 'max items for playlists/profiles/carousels' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'social_trending', description: 'Get what is trending right now: TikTok explore/For-You feed (public, by region) or TikTok search; YouTube trending or search; X/Twitter trends; Instagram latest posts of a username. Set download=true to also download the top items.', parameters: { type: 'object', properties: { platform: { type: 'string', enum: ['tiktok', 'youtube', 'x', 'instagram'] }, region: { type: 'string', description: 'US, GB, DE, IR, TR, … (X: country name)' }, count: { type: 'integer' }, query: { type: 'string', description: 'search keywords (tiktok/youtube) or username (instagram)' }, download: { type: 'boolean' }, max_download: { type: 'integer' }, output_dir: { type: 'string' } } } } },
    { type: 'function', function: { name: 'generate_image', description: 'Generate an image from a text prompt (free provider built in; OpenAI/Gemini-image if a key is set in Settings). Saves JPG/PNG into workspace generated/. Write prompts in English for best quality.', parameters: { type: 'object', properties: { prompt: { type: 'string' }, output: { type: 'string', description: 'e.g. generated/logo.png' }, width: { type: 'integer' }, height: { type: 'integer' }, seed: { type: 'integer' }, model: { type: 'string', description: 'flux (default) | turbo | gptimage …' }, count: { type: 'integer', description: '1-4' }, negative_prompt: { type: 'string' } }, required: ['prompt'] } } },
    { type: 'function', function: { name: 'generate_video', description: 'Generate a short video from a text prompt (optionally from an image). With a Replicate or fal.ai key (Settings → Agent) it uses real text-to-video models; without a key it generates AI key-frames and animates them into an MP4 with ffmpeg. Output in workspace generated/.', parameters: { type: 'object', properties: { prompt: { type: 'string' }, output: { type: 'string' }, duration: { type: 'number', description: 'seconds, default 5' }, aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] }, image: { type: 'string', description: 'optional start image path' }, model: { type: 'string' } }, required: ['prompt'] } } },
    { type: 'function', function: { name: 'glob', description: 'Find files by glob pattern (e.g. **/*.py, src/**/*.test.js), newest first.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, limit: { type: 'integer' } }, required: ['pattern'] } } },
    { type: 'function', function: { name: 'grep', description: 'Fast regex search across file contents with optional glob filter and context lines. Prefer this over run_shell grep.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, context: { type: 'integer' }, max_results: { type: 'integer' }, case_sensitive: { type: 'boolean' } }, required: ['pattern'] } } },
    { type: 'function', function: { name: 'todo_write', description: 'Create/update the visible task checklist for this job (shown live to the user). Call it at the start of multi-step work with all steps, then mark each step in_progress/done as you go. merge=true updates individual items.', parameters: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'cancelled'] } }, required: ['text'] } }, merge: { type: 'boolean' } }, required: ['todos'] } } },
    { type: 'function', function: { name: 'todo_read', description: 'Read the current task checklist.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'diagnostics', description: 'Syntax-check JS/Python/JSON files (whole workspace or a path) and list problems with line numbers. Run after writing code.', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
    { type: 'function', function: { name: 'project_init', description: 'Create ORCA.md project memory in the workspace (like AGENTS.md/CLAUDE.md): scanned structure + sections for commands, conventions, decisions. Then fill it in with edit_file. It is loaded automatically in every future chat.', parameters: { type: 'object', properties: { overwrite: { type: 'boolean' } } } } },
    { type: 'function', function: { name: 'task', description: 'Delegate a self-contained sub-task to a sub-agent with its own fresh context (e.g. "research X and report", "explore the codebase and summarize the architecture", "write and test module Y"). It has the same tools and returns a final report. Use for parallelizable or context-heavy work; call several in one turn to run them in parallel.', parameters: { type: 'object', properties: { description: { type: 'string', description: '3-6 word label' }, prompt: { type: 'string', description: 'complete, self-contained instructions' }, model: { type: 'string' }, max_steps: { type: 'integer' } }, required: ['description', 'prompt'] } } },
  ];
  return { impl, SCHEMAS, setCurrentChat, projectMemory, loadTodos, setSubagentRunner: (fn) => { runSubagent = fn; }, analyzeImage, findBin, visionModel };
}

module.exports = { makeTools, findBin, UA };
