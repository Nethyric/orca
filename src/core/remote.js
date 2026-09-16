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
function cmpVer(a, b) { // semver-ish compare, ignores pre-release tags except that "x.y.z-beta" < "x.y.z"
  const pa = String(a).replace(/^v/, '').split('-'), pb = String(b).replace(/^v/, '').split('-');
  const na = pa[0].split('.').map((x) => parseInt(x, 10) || 0), nb = pb[0].split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0); }
  if (pa[1] && !pb[1]) return -1; if (!pa[1] && pb[1]) return 1; return 0;
}
let updState = { checkedAt: 0, available: false, version: VERSION, latest: null, error: '' };
function updateStatePath() { return path.join(config.getDataDir(), 'update-state.json'); }
async function checkForUpdates(force = false) {
  if (!force && Date.now() - updState.checkedAt < 6 * 60 * 60 * 1000) return updState;
  try {
    const rem = await refreshRemote();
    let rel = null;
    // GitHub Releases of the public repo (raw + jsDelivr mirrors are used for the small remote config).
    const gh = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`, { accept: 'application/vnd.github+json' }, 10000).catch(() => null);
    if (gh && gh.status === 200 && gh.json && gh.json.tag_name) rel = gh.json;
    if (!rel) throw new Error(gh ? `GitHub HTTP ${gh.status}` : 'offline');
    const latest = String(rel.tag_name).replace(/^v/, '');
    const assets = (rel.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    const plat = process.platform === 'win32' ? /win.*x64.*\.zip$/i : process.platform === 'darwin' ? /mac.*\.(zip|dmg)$/i : /linux.*\.(AppImage|zip|tar\.gz)$/i;
    const asset = assets.find((a) => plat.test(a.name)) || null;
    const sums = assets.find((a) => /SHA256SUMS/i.test(a.name)) || null;
    updState = {
      checkedAt: Date.now(), available: cmpVer(latest, VERSION) > 0, version: VERSION, latest,
      notes: String(rel.body || '').slice(0, 4000), url: rel.html_url || `https://github.com/${REPO}/releases/latest`, published: rel.published_at,
      asset, sums: sums && sums.url, minVersion: rem.minVersion || null, mustUpdate: !!(rem.minVersion && cmpVer(VERSION, rem.minVersion) < 0), error: '',
    };
    try { fs.writeFileSync(updateStatePath(), JSON.stringify(updState)); } catch (_) {}
  } catch (e) { updState = { ...updState, checkedAt: Date.now(), error: e.message }; }
  return updState;
}
function updateState() { return updState; }

// Portable Windows self-update: download zip → verify sha256 → extract next to the app → write a small
// updater script that swaps folders after the app exits. (NSIS/installer builds should use electron-updater instead.)
let dl = { active: false, pct: 0, bytes: 0, total: 0, error: '', ready: false, path: '' };
function downloadState() { return dl; }
async function downloadUpdate(onProgress) {
  const st = await checkForUpdates(true);
  if (dl.active) return dl;
  if (!st.available || !st.asset) { dl = { active: false, pct: 0, bytes: 0, total: 0, error: st.error || 'no update asset for this platform', ready: false, path: '' }; return dl; }
  dl = { active: true, pct: 0, bytes: 0, total: st.asset.size || 0, error: '', ready: false, path: '' };
  const dir = path.join(config.getDataDir(), 'updates'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, st.asset.name);
  try {
    const r = await fetch(st.asset.url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!r.ok) throw new Error('download HTTP ' + r.status);
    const total = +r.headers.get('content-length') || dl.total; dl.total = total;
    const hash = crypto.createHash('sha256'); const out = fs.createWriteStream(dest);
    const reader = r.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; hash.update(value); out.write(Buffer.from(value)); dl.bytes += value.length; dl.pct = total ? Math.round(dl.bytes / total * 100) : 0; if (onProgress) onProgress(dl); }
    await new Promise((res) => out.end(res));
    const digest = hash.digest('hex');
    if (st.sums) { // verify against SHA256SUMS when the release publishes it
      const s = await fetchJson(st.sums, {}, 10000).catch(() => null);
      const line = s && s.text && s.text.split('\n').find((l) => l.includes(st.asset.name));
      if (line && !line.toLowerCase().startsWith(digest)) throw new Error('checksum mismatch — download discarded');
    }
    dl = { ...dl, active: false, ready: true, path: dest, sha256: digest };
    fs.writeFileSync(path.join(dir, 'pending.json'), JSON.stringify({ version: st.latest, zip: dest, sha256: digest, at: Date.now() }));
  } catch (e) { dl = { ...dl, active: false, error: e.message }; try { fs.unlinkSync(dest); } catch (_) {} }
  return dl;
}
// Apply: extract the zip beside the current app folder and launch a detached script that waits for exit, swaps, restarts.
function applyUpdate() {
  const dir = path.join(config.getDataDir(), 'updates');
  let pend; try { pend = JSON.parse(fs.readFileSync(path.join(dir, 'pending.json'), 'utf8')); } catch (_) { throw new Error('no downloaded update'); }
  if (!fs.existsSync(pend.zip)) throw new Error('update file missing');
  const exe = process.execPath; const appDir = path.dirname(exe);
  if (process.platform !== 'win32') { return { manual: true, zip: pend.zip, note: 'Extract the archive over the current app folder and restart.' }; }
  const stage = path.join(dir, 'stage'); fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
  const ps = [
    `$ErrorActionPreference='Stop'`,
    `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
    `[System.IO.Compression.ZipFile]::ExtractToDirectory('${pend.zip.replace(/'/g, "''")}', '${stage.replace(/'/g, "''")}')`,
    `$src = Get-ChildItem -Path '${stage.replace(/'/g, "''")}' -Directory | Select-Object -First 1`,
    `if (-not $src) { $src = Get-Item '${stage.replace(/'/g, "''")}' }`,
    `$pid_ = ${process.pid}`,
    `while (Get-Process -Id $pid_ -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }`,
    `Start-Sleep -Milliseconds 600`,
    `$dst = '${appDir.replace(/'/g, "''")}'`,
    `Get-ChildItem -Path $src.FullName -Force | ForEach-Object { $t = Join-Path $dst $_.Name; if (Test-Path $t) { Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue }; Move-Item -LiteralPath $_.FullName -Destination $dst -Force }`,
    `Remove-Item -LiteralPath '${pend.zip.replace(/'/g, "''")}' -Force -ErrorAction SilentlyContinue`,
    `Remove-Item -LiteralPath '${path.join(dir, 'pending.json').replace(/'/g, "''")}' -Force -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath '${exe.replace(/'/g, "''")}'`,
  ].join('\r\n');
  const script = path.join(dir, 'apply-update.ps1'); fs.writeFileSync(script, ps, 'utf8');
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { restarting: true };
}

module.exports = { VERSION, BUILD_INFO, REPO, CHANNEL, APP, installId, refreshRemote, remote, checkForUpdates, updateState, downloadUpdate, downloadState, applyUpdate, cmpVer };
