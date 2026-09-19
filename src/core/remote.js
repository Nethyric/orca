'use strict';
// Remote services for the public build (no server of our own):
//   • remote config — small JSON pulled from GitHub (raw → jsDelivr mirror): notices, minimum supported version, feature flags.
//                     Model list + provider keys come from the Sealed Vault (vault.js).
//   • updates       — checks GitHub Releases (latest release for the repo in orca.config.json); compares semver,
//                     exposes {available, version, notes, url, asset}. Portable build → downloads the zip, verifies sha256
//                     from the release manifest (SHA256SUMS), extracts, and swaps the folder on restart.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('./config');

const APP = (() => { try { return require('../../orca.config.json'); } catch (_) { return {}; } })();
const PKG = (() => { try { return require('../../package.json'); } catch (_) { return { version: '0.0.0' }; } })();
const VERSION = PKG.version;
const BUILD_INFO = (() => { try { return require('../build-info.json'); } catch (_) { return {}; } })();
const REPO = APP.repo || 'Nethyric/orca';
const CHANNEL = APP.updateChannel || 'stable';
const UA = `ORCA/${VERSION} (${process.platform}; ${process.arch})`;

// ---------- anonymous install id (random; used only to de-duplicate update checks — no personal data) ----------
function installId() {
  const f = path.join(config.getDataDir(), 'install-id');
  try { const v = fs.readFileSync(f, 'utf8').trim(); if (/^[a-f0-9]{32}$/.test(v)) return v; } catch (_) {}
  const v = crypto.randomBytes(16).toString('hex');
  try { fs.writeFileSync(f, v); } catch (_) {}
  return v;
}

// ---------- remote config ----------
let remoteCfg = null, remoteAt = 0, remoteInflight = null;
const DEFAULT_REMOTE = { notice: null, minVersion: null, flags: {}, fetchedAt: 0, source: 'builtin' };
function cachePath() { return path.join(config.getDataDir(), 'remote-config.json'); }
function loadCachedRemote() {
  if (remoteCfg) return remoteCfg;
  try { remoteCfg = { ...DEFAULT_REMOTE, ...JSON.parse(fs.readFileSync(cachePath(), 'utf8')), source: 'cache' }; } catch (_) { remoteCfg = { ...DEFAULT_REMOTE }; }
  return remoteCfg;
}
async function fetchJson(url, headers = {}, timeoutMs = 8000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json', 'User-Agent': UA, ...headers }, signal: ctl.signal });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json, text, headers: r.headers };
  } finally { clearTimeout(t); }
}
async function refreshRemote(force = false) {
  const now = Date.now();
  if (!force && remoteCfg && now - remoteAt < 15 * 60 * 1000) return remoteCfg;
  if (remoteInflight) return remoteInflight;
  remoteInflight = (async () => {
    const sources = [];
    sources.push({ url: `https://raw.githubusercontent.com/${REPO}/main/remote/config.json` });
    sources.push({ url: `https://cdn.jsdelivr.net/gh/${REPO}@main/remote/config.json` });
    for (const s of sources) {
      try {
        const r = await fetchJson(s.url, s.headers || {});
        if (r.status === 200 && r.json && typeof r.json === 'object') {
          remoteCfg = { ...DEFAULT_REMOTE, ...r.json, fetchedAt: now, source: 'github' };
          remoteAt = now;
          try { fs.writeFileSync(cachePath(), JSON.stringify(remoteCfg, null, 2)); } catch (_) {}
          return remoteCfg;
        }
      } catch (_) {}
    }
    remoteAt = now; // don't hammer when offline
    return loadCachedRemote();
  })();
  try { return await remoteInflight; } finally { remoteInflight = null; }
}
function remote() { return remoteCfg || loadCachedRemote(); }


// ---------- updates ----------
// Everything an end user needs happens inside the app: check → download (resumable, mirrors when github.com is
// blocked) → verify sha256 (release asset digest + SHA256SUMS) → install → relaunch. Nobody has to visit GitHub.
//   Windows (portable folder)   extract beside the app, swap the folder after exit, relaunch — done by a detached
//                               PowerShell script (cmd fallback), the app itself handles extraction.
//   macOS (.app bundle)         extract the zip, replace the .app in place (staging → rename swap), relaunch.
//   Linux AppImage              replace the file in place, relaunch.
//   Linux tar.gz folder         extract, swap the folder after exit, relaunch (detached sh).
// Not running from a packaged build (npm start / web mode) → the package is downloaded + verified and revealed only.
function cmpVer(a, b) { // semver-ish compare, ignores pre-release tags except that "x.y.z-beta" < "x.y.z"
  const pa = String(a).replace(/^v/, '').split('-'), pb = String(b).replace(/^v/, '').split('-');
  const na = pa[0].split('.').map((x) => parseInt(x, 10) || 0), nb = pb[0].split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0); }
  if (pa[1] && !pb[1]) return -1; if (!pa[1] && pb[1]) return 1; return 0;
}
// Public mirrors of GitHub release downloads, used only when github.com itself does not answer (some networks block it).
// Every byte is still verified against the release checksum, so a mirror cannot hand us a different file.
const MIRRORS = ['https://ghfast.top/', 'https://gh-proxy.com/', 'https://ghproxy.net/', 'https://gh.llkk.cc/'];
const ASSET_PREFIX = 'ORCA-Agent-';

let TEST = null; // { kind, root, exe, shell } — set by tests to exercise the install scripts without a packaged build
function _override(o) { TEST = o || null; applying = null; }
function packaged() { // running from a real build (asar inside an Electron app) rather than `npm start` / web mode
  if (TEST) return TEST.kind !== 'dev';
  if (!process.versions.electron) return false;
  try { return !!(process.mainModule && /app\.asar/.test(process.mainModule.filename)) || /app\.asar/.test(__dirname); } catch (_) { return /app\.asar/.test(__dirname); }
}
function installKind() { // how this copy can be replaced
  if (TEST && TEST.kind) return TEST.kind;
  if (!packaged()) return 'dev';
  if (process.platform === 'win32') return 'win-portable';
  if (process.platform === 'darwin') return 'mac-app';
  if (process.env.APPIMAGE) return 'linux-appimage';
  return 'linux-dir';
}
function appRoot() { // the folder/bundle/file that gets replaced
  if (TEST && TEST.root) return TEST.root;
  const exe = process.execPath;
  if (process.platform === 'darwin') { const m = exe.match(/^(.*?\.app)\/Contents\/MacOS\//); return m ? m[1] : path.dirname(exe); }
  if (process.platform === 'linux' && process.env.APPIMAGE) return process.env.APPIMAGE;
  return path.dirname(exe);
}
function pickAsset(assets) {
  const arch = process.arch === 'arm64' ? '(arm64|aarch64)' : '(x64|x86_64|amd64)';
  const prefs = process.platform === 'win32' ? [/win.*x64.*\.zip$/i]
    : process.platform === 'darwin' ? [new RegExp(`mac.*${arch}.*\\.zip$`, 'i'), new RegExp(`mac.*${arch}.*\\.dmg$`, 'i'), /mac.*\.(zip|dmg)$/i]
    : (process.env.APPIMAGE ? [new RegExp(`linux.*${arch}.*\\.AppImage$`, 'i'), new RegExp(`linux.*${arch}.*\\.tar\\.gz$`, 'i')] : [new RegExp(`linux.*${arch}.*\\.tar\\.gz$`, 'i'), new RegExp(`linux.*${arch}.*\\.AppImage$`, 'i')]).concat([/linux.*\.(AppImage|zip|tar\.gz)$/i]);
  for (const re of prefs) { const a = assets.find((x) => re.test(x.name)); if (a) return a; }
  return null;
}
async function fetchText(url, timeoutMs = 10000) { const r = await fetchJson(url, {}, timeoutMs); return r.status === 200 ? r.text : null; }
// Release lookup: GitHub API → (blocked / rate-limited) resolve the "latest" redirect + SHA256SUMS to learn the version and files.
async function fetchLatestRelease() {
  const gh = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`, { accept: 'application/vnd.github+json' }, 10000).catch(() => null);
  if (gh && gh.status === 200 && gh.json && gh.json.tag_name) {
    const rel = gh.json;
    return { tag: String(rel.tag_name), notes: String(rel.body || ''), url: rel.html_url, published: rel.published_at, source: 'api',
      assets: (rel.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, sha256: /^sha256:/.test(a.digest || '') ? a.digest.slice(7) : '' })) };
  }
  // Security: the checksum manifest used to *discover and vouch for* a release is only fetched
  // from github.com itself. Mirrors stay usable for the (verified) bytes, but a mirror can never
  // define what counts as a valid package. When GitHub is unreachable we refuse to guess.
  const bases = [`https://github.com/${REPO}/releases/latest/download/`];
  for (const b of bases) {
    const sums = await fetchText(b + 'SHA256SUMS', 12000).catch(() => null);
    if (!sums) continue;
    const lines = sums.split('\n').map((l) => l.trim()).filter(Boolean);
    const files = lines.map((l) => { const m = l.match(/^([a-f0-9]{64})\s+\*?(\S.*)$/i); return m ? { sha256: m[1].toLowerCase(), name: m[2].trim() } : null; }).filter(Boolean);
    // ORCA-Agent-<version>-<os>-<arch>.<ext>; a pre-release suffix never contains the platform words
    const v = files.map((f) => (f.name.match(new RegExp(`^${ASSET_PREFIX}(\\d+\\.\\d+\\.\\d+(?:-(?!win|mac|linux)[\\w.]+)?)-(?:win|mac|linux)`)) || [])[1]).find(Boolean);
    if (!v) continue;
    const dl = `https://github.com/${REPO}/releases/download/v${v}/`;
    const notes = await fetchText(`https://raw.githubusercontent.com/${REPO}/v${v}/CHANGELOG.md`, 8000).catch(() => null) || await fetchText(`https://cdn.jsdelivr.net/gh/${REPO}@v${v}/CHANGELOG.md`, 8000).catch(() => null) || '';
    return { tag: 'v' + v, notes: changelogSection(notes, v), url: `https://github.com/${REPO}/releases/tag/v${v}`, published: null, source: 'sums',
      assets: files.map((f) => ({ name: f.name, url: dl + f.name, size: 0, sha256: f.sha256 })) };
  }
  throw new Error(gh ? (gh.status === 403 || gh.status === 429 ? 'update server busy — try again in a few minutes' : `GitHub HTTP ${gh.status}`) : 'offline');
}
function changelogSection(md, version) { // the "## [x.y.z]" block from CHANGELOG.md
  if (!md) return '';
  const re = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, 'm');
  const m = md.match(re); return m ? m[1].trim() : '';
}
let updState = { checkedAt: 0, available: false, version: VERSION, latest: null, error: '', kind: installKind() };
function updateStatePath() { return path.join(config.getDataDir(), 'update-state.json'); }
async function checkForUpdates(force = false) {
  if (!force && Date.now() - updState.checkedAt < 6 * 60 * 60 * 1000) return updState;
  try {
    const rem = await refreshRemote();
    const rel = await fetchLatestRelease();
    const latest = rel.tag.replace(/^v/, '');
    const asset = pickAsset(rel.assets);
    const sums = rel.assets.find((a) => /SHA256SUMS/i.test(a.name)) || null;
    let notes = rel.notes || '';
    if (!/\n- |\n\* |### /.test(notes) && cmpVer(latest, VERSION) > 0) { // release body is just a compare link → use CHANGELOG.md
      const cl = await fetchText(`https://raw.githubusercontent.com/${REPO}/v${latest}/CHANGELOG.md`, 8000).catch(() => null) || await fetchText(`https://cdn.jsdelivr.net/gh/${REPO}@v${latest}/CHANGELOG.md`, 8000).catch(() => null);
      const sec = changelogSection(cl, latest); if (sec) notes = sec;
    }
    updState = {
      checkedAt: Date.now(), available: cmpVer(latest, VERSION) > 0, version: VERSION, latest, kind: installKind(), inApp: installKind() !== 'dev',
      notes: notes.slice(0, 6000), url: rel.url || `https://github.com/${REPO}/releases/latest`, published: rel.published, source: rel.source,
      asset, sums: sums && sums.url, minVersion: rem.minVersion || null, mustUpdate: !!(rem.minVersion && cmpVer(VERSION, rem.minVersion) < 0), error: '',
    };
    const pend = readPending();
    if (updState.available && pend && pend.version === latest && !dl.active) dl = { ...dl, active: false, ready: true, path: pend.zip, sha256: pend.sha256, verified: !!pend.verified, phase: 'ready', pct: 100, version: latest, error: '' }; // downloaded in a previous session
    if (!updState.available) dl = { ...dl, ready: false }; // an old pending download of a version that is no longer newer
    try { fs.writeFileSync(updateStatePath(), JSON.stringify(updState)); } catch (_) {}
  } catch (e) { updState = { ...updState, checkedAt: Date.now(), error: e.message, kind: installKind() }; }
  return updState;
}
function updateState() { return updState; }

// ---------- download (resumable, mirrors, verified) ----------
let dl = { active: false, pct: 0, bytes: 0, total: 0, error: '', ready: false, path: '', phase: '' };
let dlAbort = null;
function downloadState() { return dl; }
function updatesDir() { const d = path.join(config.getDataDir(), 'updates'); fs.mkdirSync(d, { recursive: true }); return d; }
function pendingPath() { return path.join(updatesDir(), 'pending.json'); }
function readPending() { try { const p = JSON.parse(fs.readFileSync(pendingPath(), 'utf8')); if (p && p.zip && fs.existsSync(p.zip)) return p; } catch (_) {} return null; }
function sha256File(file) { return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej); }); }
async function expectedDigest(st) { // release asset digest (API) → SHA256SUMS line → none
  if (st.asset && st.asset.sha256) return st.asset.sha256.toLowerCase();
  // Security: the checksum is only ever fetched from the official release source itself —
  // NEVER from the unauthenticated public mirrors. A mirror can carry the bytes, but it must
  // never be able to vouch for them; otherwise a mirror could substitute both file and hash.
  const urls = st.sums ? [st.sums] : [];
  for (const u of urls) { const t = await fetchText(u, 10000).catch(() => null); if (!t) continue; const line = t.split('\n').find((l) => l.trim().endsWith(st.asset.name)); const m = line && line.match(/^([a-f0-9]{64})/i); if (m) return m[1].toLowerCase(); }
  return '';
}
async function fetchWithResume(url, dest, expectedTotal, onChunk, signal) {
  let have = 0; try { have = fs.statSync(dest).size; } catch (_) {}
  if (expectedTotal && have > expectedTotal) { fs.rmSync(dest, { force: true }); have = 0; }
  if (expectedTotal && have === expectedTotal) return have;
  const ctl = new AbortController(); const onAbort = () => ctl.abort(); if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const idle = { t: null }; const arm = (ms = 45000) => { clearTimeout(idle.t); idle.t = setTimeout(() => ctl.abort(), ms); }; // stall guard: no headers for 15 s / no bytes for 45 s → next source
  try {
    arm(15000);
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...(have ? { Range: `bytes=${have}-` } : {}) }, redirect: 'follow', signal: ctl.signal });
    arm();
    if (r.status === 416) return have; // already complete
    if (!r.ok) throw new Error('download HTTP ' + r.status);
    if (have && r.status !== 206) { have = 0; fs.rmSync(dest, { force: true }); } // server ignored the range → start over
    const len = +r.headers.get('content-length') || 0; const total = have + len;
    const out = fs.createWriteStream(dest, { flags: have ? 'a' : 'w' });
    const reader = r.body.getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; arm(); if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res)); have += value.length; onChunk(have, total); } }
    finally { await new Promise((res) => out.end(res)); }
    return have;
  } finally { clearTimeout(idle.t); if (signal) signal.removeEventListener('abort', onAbort); }
}
async function downloadUpdate(onProgress) {
  if (dl.active) return dl;
  const st = (TEST && TEST.release) || await checkForUpdates(true);
  if (!st.available || !st.asset) { dl = { ...dl, active: false, error: st.error || 'no update package for this platform', ready: false }; return dl; }
  const pend = readPending();
  if (pend && pend.version === st.latest && pend.sha256) { const size = (() => { try { return fs.statSync(pend.zip).size; } catch (_) { return 0; } })(); dl = { active: false, pct: 100, bytes: size, total: size, error: '', ready: true, path: pend.zip, sha256: pend.sha256, verified: !!pend.verified, phase: 'ready', version: st.latest }; return dl; }
  const dest = path.join(updatesDir(), st.asset.name);
  for (const f of fs.readdirSync(updatesDir())) if (f !== st.asset.name && f.startsWith(ASSET_PREFIX)) { try { fs.rmSync(path.join(updatesDir(), f), { force: true }); } catch (_) {} } // old versions
  dl = { active: true, pct: 0, bytes: 0, total: st.asset.size || 0, error: '', ready: false, path: '', phase: 'download', version: st.latest };
  dlAbort = new AbortController();
  const report = () => { if (onProgress) onProgress(dl); };
  try {
    const digest = await expectedDigest(st);
    const sources = [st.asset.url, ...MIRRORS.map((m) => m + st.asset.url)];
    let lastErr = null, got = 0; const t0 = Date.now(); let lastT = t0, lastB = 0;
    for (const src of sources) {
      if (dlAbort.signal.aborted) throw new Error('cancelled');
      try {
        got = await fetchWithResume(src, dest, st.asset.size || 0, (have, total) => {
          const now = Date.now(); dl.bytes = have; dl.total = total || dl.total;
          if (now - lastT >= 500) { dl.speed = Math.round((have - lastB) / ((now - lastT) / 1000)); dl.eta = dl.speed > 0 && dl.total ? Math.round((dl.total - have) / dl.speed) : null; lastT = now; lastB = have; dl.pct = dl.total ? Math.min(100, Math.floor(have / dl.total * 100)) : 0; report(); }
        }, dlAbort.signal);
        lastErr = null; break;
      } catch (e) { lastErr = e; if (dlAbort.signal.aborted) throw new Error('cancelled'); dl.mirror = true; report(); }
    }
    if (lastErr) throw lastErr;
    dl.phase = 'verify'; dl.pct = 100; report();
    const actual = await sha256File(dest);
    // Security: a package with NO trusted external checksum is never accepted. Without a digest
    // there is nothing that proves these bytes are the release, so refuse rather than install.
    if (!digest) { fs.rmSync(dest, { force: true }); throw new Error('no trusted checksum available for this release — update refused'); }
    if (actual !== digest) { fs.rmSync(dest, { force: true }); throw new Error('checksum mismatch — the file was discarded, please download again'); }
    dl = { ...dl, active: false, ready: true, path: dest, sha256: actual, phase: 'ready', verified: true };
    fs.writeFileSync(pendingPath(), JSON.stringify({ version: st.latest, zip: dest, sha256: actual, verified: true, at: Date.now(), kind: installKind() }));
  } catch (e) { dl = { ...dl, active: false, error: e.message === 'cancelled' ? '' : e.message, phase: e.message === 'cancelled' ? 'cancelled' : 'error' }; if (e.message === 'cancelled') { /* keep the partial file for resume */ } }
  finally { dlAbort = null; report(); }
  return dl;
}
function cancelDownload() { if (dlAbort) dlAbort.abort(); return dl; }

// ---------- install ----------
const sq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;           // POSIX single-quote
const pq = (v) => `'${String(v).replace(/'/g, "''")}'`;             // PowerShell single-quote
// spawn errors (missing binary, EACCES) arrive asynchronously — resolve to false instead of throwing later in nowhere
function detach(cmd, args, opts = {}) {
  if (TEST && TEST.noSpawn) return Promise.resolve(true);
  return new Promise((resolve) => {
    let c; try { c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts }); } catch (_) { return resolve(false); }
    c.once('error', () => resolve(false)); c.once('spawn', () => { c.unref(); resolve(true); });
  });
}
function reveal(file) { if (process.platform === 'darwin') detach('open', ['-R', file]); else if (process.platform === 'win32') detach('explorer.exe', ['/select,', file]); else detach('xdg-open', [path.dirname(file)]); }
let installing = { active: false, phase: '', error: '' };
function installState() { return installing; }
let lastInstall; // { ok, version, from, note } written by the helper script of the previous run; read once
function installResult() {
  if (lastInstall !== undefined) return lastInstall;
  const f = path.join(updatesDir(), 'result.json');
  try { lastInstall = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); lastInstall.current = VERSION; lastInstall.ok = !!lastInstall.ok && cmpVer(VERSION, lastInstall.version) >= 0; } catch (_) { lastInstall = null; }
  try { fs.rmSync(f, { force: true }); } catch (_) {}
  if (lastInstall && lastInstall.ok) { try { fs.rmSync(path.join(updatesDir(), 'stage'), { recursive: true, force: true }); } catch (_) {} }
  // leftovers of the swap (the previous version kept aside by the helper, an abandoned staging folder) — best effort, again a bit later
  const sweep = () => { try { const root = appRoot(), dir = path.dirname(root), me = path.basename(root); for (const f of fs.readdirSync(dir)) if ((f.startsWith(me + '.old-') || /^\.orca-update-\d+$/.test(f)) && f !== me) fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch (_) {} };
  if (installKind() !== 'dev') { sweep(); setTimeout(sweep, 20000).unref(); }
  return lastInstall;
}
// Returns { restarting: true } when a detached helper will swap and relaunch, or { manual: true, zip, note } when this copy
// cannot replace itself (dev run, unknown layout) — the verified package is then revealed instead.
let applying = null; // promise of the apply in progress; a second click gets the same result instead of a second helper
function applyUpdate(onProgress) { if (!applying) applying = applyUpdateOnce(onProgress).catch((e) => { applying = null; throw e; }); return applying; }
async function applyUpdateOnce(onProgress) {
  const pend = readPending();
  if (!pend) throw new Error('no downloaded update');
  const kind = installKind(), root = appRoot(), exe = (TEST && TEST.exe) || process.execPath, dir = updatesDir();
  const PS = (TEST && TEST.shell) || 'powershell.exe';
  const report = (phase) => { installing = { active: true, phase, error: '' }; if (onProgress) onProgress(installing); };
  report('verify');
  if (pend.sha256 && (await sha256File(pend.zip)) !== pend.sha256) { fs.rmSync(pend.zip, { force: true }); fs.rmSync(pendingPath(), { force: true }); dl = { ...dl, ready: false }; throw new Error('the downloaded package is damaged — download it again'); }
  const resultFile = path.join(dir, 'result.json'); fs.rmSync(resultFile, { force: true });
  const result = (ok, note) => JSON.stringify({ ok, version: pend.version, from: VERSION, note: note || '', at: 0 });
  const relaunchArgs = (process.defaultApp || !process.versions.electron ? [] : process.argv.slice(1)).filter((a) => a && !a.startsWith('--') && !/\.(js|asar)$/i.test(a)); // user args only (a file opened with the app), never our own flags
  try {
    if (kind === 'dev' || !/\.(zip|AppImage|tar\.gz)$/i.test(pend.zip)) { reveal(pend.zip); installing = { active: false, phase: 'manual', error: '' }; applying = null; return { manual: true, zip: pend.zip, note: 'This copy of ORCA is not a packaged build, so it cannot replace itself. The verified package is in your file manager.' }; }
    let stage = path.join(dir, 'stage');
    if (kind !== 'linux-appimage') { // prefer a sibling of the app: same volume, so the final swap is a rename and not a copy
      const sib = path.join(path.dirname(root), '.orca-update-' + process.pid);
      try { fs.rmSync(sib, { recursive: true, force: true }); fs.mkdirSync(sib, { recursive: true }); fs.writeFileSync(path.join(sib, '.w'), '1'); fs.rmSync(path.join(sib, '.w')); stage = sib; } catch (_) {}
      for (const f of (() => { try { return fs.readdirSync(path.dirname(root)); } catch (_) { return []; } })()) if (/^\.orca-update-\d+$/.test(f) && f !== path.basename(stage)) { try { fs.rmSync(path.join(path.dirname(root), f), { recursive: true, force: true }); } catch (_) {} }
    }
    fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
    if (kind === 'linux-appimage') {
      report('stage');
      const tmp = root + '.new'; fs.copyFileSync(pend.zip, tmp); fs.chmodSync(tmp, 0o755);
      const sh = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done; sleep 0.4; if mv -f ${sq(tmp)} ${sq(root)}; then rm -f ${sq(pend.zip)} ${sq(pendingPath())}; printf '%s' ${sq(result(true))} > ${sq(resultFile)}; else printf '%s' ${sq(result(false, 'could not replace the AppImage (permissions?)'))} > ${sq(resultFile)}; fi; nohup ${sq(root)} ${relaunchArgs.map(sq).join(' ')} >/dev/null 2>&1 &`;
      if (!(await detach('/bin/sh', ['-c', sh], { cwd: dir }))) throw new Error('could not start the install helper (/bin/sh)');
      installing = { active: false, phase: 'restarting', error: '' }; return { restarting: true };
    }
    report('extract');
    { // enough room for the extracted tree (+10 %) where we stage it?
      let need = 0; try { need = /\.tar\.gz$/i.test(pend.zip) ? fs.statSync(pend.zip).size * 2.6 : require('./unzip').readEntries(pend.zip).reduce((a, e) => a + (e.usize || 0), 0) * 1.1; } catch (_) {}
      let free = Infinity; try { const st = fs.statfsSync(stage); free = Number(st.bavail) * Number(st.bsize); } catch (_) {}
      if (need && free < need) throw new Error(`not enough free disk space: the update needs about ${Math.ceil(need / 1048576)} MB, ${Math.floor(free / 1048576)} MB are free next to the app`);
    }
    let newRoot; // the freshly extracted app folder / .app bundle
    if (/\.tar\.gz$/i.test(pend.zip)) { await new Promise((res, rej) => { const c = spawn('tar', ['xzf', pend.zip, '-C', stage], { stdio: 'ignore' }); c.on('error', rej); c.on('close', (code) => (code ? rej(new Error('tar exit ' + code)) : res())); }); }
    else { const unzip = require('./unzip'); await unzip.extract(pend.zip, stage, { onProgress: (p) => { if (p.done % 40 === 0) report(`extract ${Math.round(p.done / p.total * 100)}%`); } }); }
    const tops = fs.readdirSync(stage).filter((f) => !f.startsWith('.') && f !== '__MACOSX');
    if (kind === 'mac-app') newRoot = path.join(stage, tops.find((f) => /\.app$/i.test(f)) || '');
    else newRoot = tops.length === 1 && fs.statSync(path.join(stage, tops[0])).isDirectory() ? path.join(stage, tops[0]) : stage;
    if (!newRoot || !fs.existsSync(newRoot)) throw new Error('unexpected package layout');
    // sanity: the new tree must contain the executable we are about to relaunch
    const exeRel = kind === 'mac-app' ? path.join('Contents', 'MacOS') : path.basename(exe);
    if (!fs.existsSync(path.join(newRoot, exeRel))) throw new Error('package does not contain ' + exeRel);
    report('swap');
    const oldRoot = root + '.old-' + VERSION;
    const relaunch = path.join(root, path.basename(exe)); // (macOS relaunches the bundle with `open -n`)
    if (kind === 'win-portable') {
      // PowerShell: wait for exit → rename old folder aside → move new in → relaunch → delete old (best effort, keeps user data: it lives in %APPDATA%)
      const ps = [
        `$ErrorActionPreference='Stop'`,
        `$p=${process.pid}; while (Get-Process -Id $p -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 300 }`, `Start-Sleep -Milliseconds 700`,
        `$root=${pq(root)}; $new=${pq(newRoot)}; $old=${pq(oldRoot)}`,
        `if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue }`,
        `$ok=$false; for ($i=0; $i -lt 40 -and -not $ok; $i++) { try { Rename-Item -LiteralPath $root -NewName (Split-Path $old -Leaf) -ErrorAction Stop; $ok=$true } catch { Start-Sleep -Milliseconds 500 } }`,
        `if ($ok) { try { Move-Item -LiteralPath $new -Destination $root -Force -ErrorAction Stop } catch { & robocopy $new $root /E /MOVE /R:5 /W:1 /NFL /NDL /NJH /NJS | Out-Null } }`,
        `else { & robocopy $new $root /E /MOVE /IS /IT /R:10 /W:1 /NFL /NDL /NJH /NJS | Out-Null }`,
        `Remove-Item -LiteralPath ${pq(pend.zip)} -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath ${pq(pendingPath())} -Force -ErrorAction SilentlyContinue`,
        `if (Test-Path -LiteralPath ${pq(relaunch)}) { Set-Content -LiteralPath ${pq(resultFile)} -Value ${pq(result(true))} -Encoding UTF8 } else { Set-Content -LiteralPath ${pq(resultFile)} -Value ${pq(result(false, 'the new files could not be moved into place'))} -Encoding UTF8; if (Test-Path -LiteralPath $old) { Move-Item -LiteralPath $old -Destination $root -Force } }`,
        `Start-Process -FilePath ${pq(relaunch)} -WorkingDirectory $root`,
        `Start-Sleep -Seconds 3; Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath ${pq(stage)} -Recurse -Force -ErrorAction SilentlyContinue`,
      ].join('\r\n');
      const script = path.join(dir, 'apply-update.ps1'); fs.writeFileSync(script, '\uFEFF' + ps, 'utf8');
      const psOk = await detach(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...(process.platform === 'win32' ? ['-WindowStyle', 'Hidden'] : []), '-File', script], { cwd: dir });
      if (!psOk) { // PowerShell missing/blocked → cmd fallback
        const bat = [`@echo off`, `:w`, `tasklist /FI "PID eq ${process.pid}" 2>NUL | find "${process.pid}" >NUL && (timeout /t 1 /nobreak >NUL & goto w)`, `timeout /t 1 /nobreak >NUL`,
          `rd /s /q "${oldRoot}" 2>NUL`, `ren "${root}" "${path.basename(oldRoot)}" || (robocopy "${newRoot}" "${root}" /E /MOVE /NFL /NDL /NJH /NJS >NUL & goto run)`, `move /y "${newRoot}" "${root}" >NUL`,
          `:run`, `del /q "${pend.zip}" "${pendingPath()}" 2>NUL`, `start "" "${relaunch}"`, `timeout /t 3 /nobreak >NUL & rd /s /q "${oldRoot}" 2>NUL & rd /s /q "${stage}" 2>NUL`].join('\r\n');
        const b = path.join(dir, 'apply-update.cmd'); fs.writeFileSync(b, bat);
        if (!(await detach((TEST && TEST.cmd) || 'cmd.exe', ['/c', b], { cwd: dir }))) throw new Error('could not start the install helper (PowerShell and cmd both unavailable)');
      }
    } else { // mac-app · linux-dir
      const sh = [
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done; sleep 0.5`,
        `rm -rf ${sq(oldRoot)}`,
        `ok=1; if mv ${sq(root)} ${sq(oldRoot)} 2>/dev/null; then mv ${sq(newRoot)} ${sq(root)} || { mv ${sq(oldRoot)} ${sq(root)}; ok=0; }; else cp -R ${sq(newRoot)}/. ${sq(root)}/ || ok=0; fi`,
        kind === 'mac-app' ? `xattr -dr com.apple.quarantine ${sq(root)} 2>/dev/null; chmod +x ${sq(path.join(root, 'Contents', 'MacOS'))}/* 2>/dev/null` : `chmod +x ${sq(relaunch)} ${sq(path.join(root, 'chrome-sandbox'))} 2>/dev/null; if [ -u ${sq(path.join(oldRoot, 'chrome-sandbox'))} ]; then mv -f ${sq(path.join(oldRoot, 'chrome-sandbox'))} ${sq(path.join(root, 'chrome-sandbox'))} 2>/dev/null; fi`,
        `if [ $ok = 1 ]; then rm -f ${sq(pend.zip)} ${sq(pendingPath())}; printf '%s' ${sq(result(true))} > ${sq(resultFile)}; else printf '%s' ${sq(result(false, 'could not replace the app (is the folder writable?)'))} > ${sq(resultFile)}; fi`,
        kind === 'mac-app' ? `open -n ${sq(root)}` : `nohup ${sq(relaunch)} ${relaunchArgs.map(sq).join(' ')} >/dev/null 2>&1 &`,
        `sleep 3; rm -rf ${sq(oldRoot)} ${sq(stage)}`,
      ].join('\n');
      const script = path.join(dir, 'apply-update.sh'); fs.writeFileSync(script, sh, { mode: 0o755 });
      if (!(await detach('/bin/sh', [script], { cwd: dir }))) throw new Error('could not start the install helper (/bin/sh)');
    }
    installing = { active: false, phase: 'restarting', error: '' };
    return { restarting: true };
  } catch (e) { installing = { active: false, phase: 'error', error: e.message }; throw e; }
}

module.exports = { VERSION, BUILD_INFO, REPO, CHANNEL, APP, installId, refreshRemote, remote, checkForUpdates, updateState, downloadUpdate, downloadState, cancelDownload, applyUpdate, installState, installResult, installKind, appRoot, cmpVer, pickAsset, changelogSection, readPending, MIRRORS, _override };
