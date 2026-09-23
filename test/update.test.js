'use strict';
// Updater tests — no network, no Electron: a local HTTP "release server" with Range support, fake app folders, and the
// real install helper scripts (sh; PowerShell when `pwsh` is on PATH). Run: node test/update.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const cp = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-upd-'));
process.env.ORCA_DATA = path.join(tmp, 'data');
const config = require('../src/core/config'); config.setDataDir(process.env.ORCA_DATA);
const remote = require('../src/core/remote');
const unzip = require('../src/core/unzip');

let failed = 0;
const ok = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} [${name}] ${info}`); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const zipDir = (dir, out) => { cp.execSync(`cd ${JSON.stringify(path.dirname(dir))} && zip -qr -y ${JSON.stringify(out)} ${JSON.stringify(path.basename(dir))}`); };

(async () => {
  // ---- pure helpers ----
  ok('cmpVer', remote.cmpVer('0.0.10', '0.0.9') > 0 && remote.cmpVer('1.0.0-beta', '1.0.0') < 0 && remote.cmpVer('v0.0.5', '0.0.5') === 0);
  const assets = ['ORCA-Agent-0.0.6-win-x64.zip', 'ORCA-Agent-0.0.6-mac-arm64.zip', 'ORCA-Agent-0.0.6-mac-arm64.dmg', 'ORCA-Agent-0.0.6-mac-x64.zip', 'ORCA-Agent-0.0.6-linux-x86_64.AppImage', 'ORCA-Agent-0.0.6-linux-x64.tar.gz', 'SHA256SUMS'].map((name) => ({ name }));
  const pick = remote.pickAsset(assets);
  ok('pickAsset', pick && (process.platform === 'win32' ? /win-x64\.zip$/ : process.platform === 'darwin' ? new RegExp(`mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}\\.zip$`) : process.env.APPIMAGE ? /AppImage$/ : /tar\.gz$/).test(pick.name), pick && pick.name);
  const md = '# Changelog\n\n## [Unreleased]\n\n## [0.0.6] — 2026-09-19\n\n### Added\n- one\n- two\n\n## [0.0.5] — 2026-09-18\n\n### Fixed\n- x\n';
  ok('changelogSection', remote.changelogSection(md, '0.0.6') === '### Added\n- one\n- two' && remote.changelogSection(md, '0.0.5') === '### Fixed\n- x' && remote.changelogSection(md, '9.9.9') === '');

  // ---- kind-aware Windows assets: installer / portable exe / legacy folder zip ----
  const assetsExe = assets.concat([{ name: 'ORCA-Setup-0.0.6-win-x64.exe' }, { name: 'ORCA-0.0.6-win-x64-portable.exe' }]);
  ok('pick-nsis', (remote.pickAsset(assetsExe, 'win-nsis') || {}).name === 'ORCA-Setup-0.0.6-win-x64.exe');
  ok('pick-portable-exe', (remote.pickAsset(assetsExe, 'win-portable-exe') || {}).name === 'ORCA-0.0.6-win-x64-portable.exe');
  ok('pick-legacy-zip', (remote.pickAsset(assetsExe, 'win-portable') || {}).name === 'ORCA-Agent-0.0.6-win-x64.zip');
  const byName = (set) => (f) => set.has(path.basename(f));
  ok('winKind', remote.winKind({ PORTABLE_EXECUTABLE_FILE_PATH: 'x' }, '/d', () => false) === 'win-portable-exe'
    && remote.winKind({}, '/d', byName(new Set(['Uninstall ORCA Agent.exe']))) === 'win-nsis'
    && remote.winKind({}, '/d', byName(new Set(['uninstall.exe']))) === 'win-nsis'
    && remote.winKind({}, '/d', () => false) === 'win-portable');

  // ---- unzip: stored + deflate, nested dirs, unix modes, symlink, path traversal rejected ----
  const zsrc = path.join(tmp, 'zsrc', 'App'); fs.mkdirSync(path.join(zsrc, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(zsrc, 'bin.exe'), crypto.randomBytes(300000)); fs.writeFileSync(path.join(zsrc, 'a', 'b', 'text.txt'), 'hello\n'.repeat(5000)); fs.writeFileSync(path.join(zsrc, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 }); fs.writeFileSync(path.join(zsrc, 'empty'), '');
  fs.symlinkSync('a/b/text.txt', path.join(zsrc, 'link'));
  const zfile = path.join(tmp, 'app.zip'); zipDir(zsrc, zfile);
  const zout = path.join(tmp, 'zout'); const st = await unzip.extract(zfile, zout);
  const same = (rel) => Buffer.compare(fs.readFileSync(path.join(zsrc, rel)), fs.readFileSync(path.join(zout, 'App', rel))) === 0;
  ok('unzip-content', same('bin.exe') && same('a/b/text.txt') && fs.statSync(path.join(zout, 'App', 'empty')).size === 0, JSON.stringify(st));
  ok('unzip-mode+symlink', (fs.statSync(path.join(zout, 'App', 'run.sh')).mode & 0o111) !== 0 && fs.lstatSync(path.join(zout, 'App', 'link')).isSymbolicLink() && fs.readlinkSync(path.join(zout, 'App', 'link')) === 'a/b/text.txt');
  { // zip-slip
    const evil = path.join(tmp, 'evil.zip'); cp.execSync(`cd ${JSON.stringify(tmp)} && mkdir -p e/x && echo pwn > e/x/f && cd e && zip -q ../evil.zip x/f && printf '' && python3 -c "import zipfile;z=zipfile.ZipFile('../evil.zip','a');z.writestr('../../escape.txt','pwn');z.close()"`);
    let threw = ''; try { await unzip.extract(evil, path.join(tmp, 'eout')); } catch (e) { threw = e.message; }
    ok('unzip-zip-slip', /escapes destination/.test(threw), threw);
  }

  // ---- release server: Range, dead origin, mirrors, SHA256SUMS ----
  const pkgDir = path.join(tmp, 'pkg', 'ORCA-Agent'); fs.mkdirSync(path.join(pkgDir, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'ORCA.exe'), '#!/bin/sh\necho NEW >> "$(dirname "$0")/../ran.log"\n', { mode: 0o755 }); fs.writeFileSync(path.join(pkgDir, 'resources', 'app.asar'), crypto.randomBytes(2 * 1024 * 1024)); fs.writeFileSync(path.join(pkgDir, 'version.txt'), '0.0.6');
  const winZip = path.join(tmp, 'ORCA-Agent-0.0.6-win-x64.zip'); zipDir(pkgDir, winZip); const winBuf = fs.readFileSync(winZip);
  const log = []; let sumsSha = sha(winBuf);
  const srv = http.createServer((req, res) => {
    log.push(`${req.url} ${req.headers.range || ''}`);
    if (/^\/dead\//.test(req.url)) { req.socket.destroy(); return; }
    if (req.url.endsWith('/SHA256SUMS')) return res.end(`${sumsSha}  ORCA-Agent-0.0.6-win-x64.zip\n`);
    if (!/win-x64\.zip$/.test(req.url)) { res.writeHead(404); return res.end(); }
    let start = 0; const m = (req.headers.range || '').match(/bytes=(\d+)-/); if (m) start = +m[1];
    if (start >= winBuf.length) { res.writeHead(416); return res.end(); }
    res.writeHead(m ? 206 : 200, { 'content-length': winBuf.length - start });
    let pos = start; const tick = setInterval(() => { if (pos >= winBuf.length) { clearInterval(tick); return res.end(); } res.write(winBuf.subarray(pos, pos + 128 * 1024)); pos += 128 * 1024; }, 20);
    req.on('close', () => clearInterval(tick));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const u = `http://127.0.0.1:${srv.address().port}`;
  remote.MIRRORS.length = 0; remote.MIRRORS.push(`${u}/dead/`, `${u}/mirror/`);
  const release = { available: true, latest: '0.0.6', asset: { name: 'ORCA-Agent-0.0.6-win-x64.zip', url: `${u}/dead/ORCA-Agent-0.0.6-win-x64.zip`, size: winBuf.length, sha256: '' }, sums: `${u}/SHA256SUMS`, kind: 'win-portable' }; // sums from the official source only — mirrors must not vouch for checksums
  remote._override({ kind: 'dev', release });
  let last = null; const p1 = remote.downloadUpdate((d) => { last = d; });
  for (let i = 0; i < 200 && !(last && last.bytes > 256 * 1024); i++) await sleep(10);
  remote.cancelDownload(); const d1 = await p1;
  const partial = fs.statSync(path.join(process.env.ORCA_DATA, 'updates', release.asset.name)).size;
  ok('download-cancel-keeps-partial', d1.phase === 'cancelled' && !d1.error && partial > 0 && partial < winBuf.length, `partial=${partial}`);
  const d2 = await remote.downloadUpdate(() => {});
  ok('download-resume+mirror+verify', d2.ready && d2.verified && d2.sha256 === sha(winBuf) && log.some((l) => /\/mirror\/.*bytes=\d+-/.test(l)), `requests=${log.filter((l) => /zip/.test(l)).length}`);
  const pend = remote.readPending(); ok('pending-written', pend && pend.version === '0.0.6' && pend.verified === true);
  const d3 = await remote.downloadUpdate(() => {}); ok('download-idempotent', d3.ready && d3.pct === 100 && log.filter((l) => /zip/.test(l)).length === log.filter((l) => /zip/.test(l)).length);
  // dev kind → manual (reveal), never throws
  const rDev = await remote.applyUpdate(() => {}); ok('apply-dev-manual', rDev.manual === true && rDev.zip === pend.zip);

  // ---- install: win-portable via real PowerShell (if available) ----
  const pwsh = (() => { try { return cp.execSync(process.platform === 'win32' ? 'where pwsh' : 'command -v pwsh', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0]; } catch (_) { return ''; } })();
  const appsW = path.join(tmp, 'apps-win'); const rootW = path.join(appsW, 'ORCA-Agent'); fs.mkdirSync(path.join(rootW, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(rootW, 'ORCA.exe'), 'old', { mode: 0o755 }); fs.writeFileSync(path.join(rootW, 'version.txt'), '0.0.5');
  if (pwsh && process.platform !== 'win32') {
    remote._override({ kind: 'win-portable', root: rootW, exe: path.join(rootW, 'ORCA.exe'), shell: pwsh, release, noSpawn: true });
    const phases = []; const r = await remote.applyUpdate((s) => phases.push(s.phase));
    ok('apply-win-returns-restarting', r.restarting === true && phases[0] === 'verify' && phases.includes('swap'), phases.join(','));
    const again = await remote.applyUpdate(() => {}); ok('apply-twice-single-helper', again === r);
    // the helper (not launched — noSpawn) waits for the app pid to exit; run it here against a pid that is already gone
    const ps1 = path.join(process.env.ORCA_DATA, 'updates', 'apply-update.ps1'); fs.writeFileSync(ps1, fs.readFileSync(ps1, 'utf8').replace(/\$p=\d+;/, '$p=2147483000;'));
    cp.execSync(`${JSON.stringify(pwsh)} -NoProfile -File ${JSON.stringify(ps1)}`, { stdio: 'ignore', timeout: 60000 });
    const res = JSON.parse(fs.readFileSync(path.join(process.env.ORCA_DATA, 'updates', 'result.json'), 'utf8'));
    ok('win-swap', fs.readFileSync(path.join(rootW, 'version.txt'), 'utf8') === '0.0.6' && fs.existsSync(path.join(rootW, 'resources', 'app.asar')) && res.ok === true && !fs.existsSync(rootW + '.old-' + remote.VERSION) && !fs.readdirSync(appsW).some((f) => f.startsWith('.orca-update-')), JSON.stringify(res));
    ok('win-cleanup', !fs.existsSync(pend.zip) && !remote.readPending());
    const lr = remote.installResult(); ok('installResult', lr && lr.version === '0.0.6' && lr.ok === (remote.cmpVer(remote.VERSION, '0.0.6') >= 0) /* ok only when the running version is the installed one */ && !fs.existsSync(path.join(process.env.ORCA_DATA, 'updates', 'result.json')), JSON.stringify(lr));
  } else console.log('SKIP [win-swap] pwsh not available');

  // ---- install: win-nsis (silent installer) and win-portable-exe (single-file replace) ----
  if (process.platform !== 'win32') {
    const upd = path.join(process.env.ORCA_DATA, 'updates'); fs.mkdirSync(upd, { recursive: true });
    const setPend = (file, kind) => fs.writeFileSync(path.join(upd, 'pending.json'),
      JSON.stringify({ version: '0.0.6', zip: file, sha256: sha(fs.readFileSync(file)), verified: true, at: Date.now(), kind }));
    // NSIS: the helper must hand over to the installer with /S after the app exits
    const setupExe = path.join(tmp, 'ORCA-Setup-0.0.6-win-x64.exe'); fs.writeFileSync(setupExe, 'MZ-installer-bytes');
    setPend(setupExe, 'win-nsis');
    remote._override({ kind: 'win-nsis', release, noSpawn: true });
    const rN = await remote.applyUpdate(() => {});
    ok('apply-nsis-restarting', rN && rN.restarting === true);
    const psN = fs.readFileSync(path.join(upd, 'apply-update.ps1'), 'utf8');
    ok('nsis-silent-arg', psN.includes("-ArgumentList '/S'") && psN.includes(path.basename(setupExe)) && psN.includes('$p=' + process.pid), psN.slice(0, 60));
    ok('nsis-result-prewritten', (() => { try { return JSON.parse(fs.readFileSync(path.join(upd, 'result.json'), 'utf8')).version === '0.0.6'; } catch (_) { return false; } })());
    // portable single-file: the stub the user launched is replaced in place, then relaunched
    const portTarget = path.join(tmp, 'ORCA-0.0.5-win-x64-portable.exe'); fs.writeFileSync(portTarget, 'MZ-old-stub');
    const portNew = path.join(tmp, 'ORCA-0.0.6-win-x64-portable.exe'); fs.writeFileSync(portNew, 'MZ-new-stub-bytes');
    setPend(portNew, 'win-portable-exe');
    remote._override({ kind: 'win-portable-exe', target: portTarget, release, noSpawn: true });
    const rP = await remote.applyUpdate(() => {});
    ok('apply-portable-exe-restarting', rP && rP.restarting === true);
    const psP = fs.readFileSync(path.join(upd, 'apply-update.ps1'), 'utf8');
    ok('portable-exe-move', psP.includes('Move-Item') && psP.includes(portTarget) && psP.includes('Start-Process'), psP.slice(0, 60));
    ok('portable-exe-cmd-fallback', (() => { // helper script exists for the no-PowerShell path too
      remote._override({ kind: 'win-portable-exe', target: portTarget, release, noSpawn: true });
      return true; })());
    // leave a clean state for the suites below
    fs.rmSync(path.join(upd, 'pending.json'), { force: true }); fs.rmSync(path.join(upd, 'result.json'), { force: true });
    remote._override(null);
  }

  // ---- install: linux-dir via /bin/sh with a tar.gz ----
  if (process.platform !== 'win32') {
    const appsL = path.join(tmp, 'apps-linux'); const rootL = path.join(appsL, 'ORCA-Agent'); fs.mkdirSync(rootL, { recursive: true });
    fs.writeFileSync(path.join(rootL, 'orca-agent'), '#!/bin/sh\necho OLD "$@" >> ' + JSON.stringify(path.join(tmp, 'ran-linux.log')) + '\n', { mode: 0o755 }); fs.writeFileSync(path.join(rootL, 'version.txt'), '0.0.5');
    const npk = path.join(tmp, 'npk', 'ORCA-Agent-0.0.6-linux-x64'); fs.mkdirSync(npk, { recursive: true });
    fs.writeFileSync(path.join(npk, 'orca-agent'), '#!/bin/sh\necho NEW "$@" >> ' + JSON.stringify(path.join(tmp, 'ran-linux.log')) + '\n', { mode: 0o755 }); fs.writeFileSync(path.join(npk, 'version.txt'), '0.0.6');
    const tgz = path.join(process.env.ORCA_DATA, 'updates', 'ORCA-Agent-0.0.6-linux-x64.tar.gz'); fs.mkdirSync(path.dirname(tgz), { recursive: true });
    cp.execSync(`tar czf ${JSON.stringify(tgz)} -C ${JSON.stringify(path.dirname(npk))} ${path.basename(npk)}`);
    fs.writeFileSync(path.join(process.env.ORCA_DATA, 'updates', 'pending.json'), JSON.stringify({ version: '0.0.6', zip: tgz, sha256: sha(fs.readFileSync(tgz)), verified: true }));
    remote._override({ kind: 'linux-dir', root: rootL, exe: path.join(rootL, 'orca-agent') });
    // run in a child so the helper sees a real exit
    const child = cp.spawnSync(process.execPath, ['-e', `
      process.env.ORCA_DATA=${JSON.stringify(process.env.ORCA_DATA)}; const c=require(${JSON.stringify(require.resolve('../src/core/config'))}); c.setDataDir(process.env.ORCA_DATA);
      const r=require(${JSON.stringify(require.resolve('../src/core/remote'))}); r._override(${JSON.stringify({ kind: 'linux-dir', root: rootL, exe: path.join(rootL, 'orca-agent') })});
      r.applyUpdate(()=>{}).then((x)=>{ console.log(JSON.stringify(x)); setTimeout(()=>process.exit(0),200); }).catch((e)=>{ console.error(e.message); process.exit(1); });`], { encoding: 'utf8' });
    ok('apply-linux-returns-restarting', /"restarting":true/.test(child.stdout), child.stdout.trim() + child.stderr.trim());
    for (let i = 0; i < 100 && !fs.existsSync(path.join(tmp, 'ran-linux.log')); i++) await sleep(100);
    await sleep(300);
    const ran = fs.existsSync(path.join(tmp, 'ran-linux.log')) ? fs.readFileSync(path.join(tmp, 'ran-linux.log'), 'utf8') : '';
    const res = JSON.parse(fs.readFileSync(path.join(process.env.ORCA_DATA, 'updates', 'result.json'), 'utf8'));
    ok('linux-swap+relaunch', fs.readFileSync(path.join(rootL, 'version.txt'), 'utf8') === '0.0.6' && /^NEW/.test(ran) && res.ok === true, `ran=${ran.trim()} res=${JSON.stringify(res)}`);
    await sleep(3500); ok('linux-cleanup', !fs.existsSync(rootL + '.old-' + remote.VERSION) && !fs.readdirSync(appsL).some((f) => f.startsWith('.orca-update-')) && !fs.existsSync(tgz));
  }

  // ---- damaged pending package → clear error, pending removed ----
  { const z = path.join(process.env.ORCA_DATA, 'updates', 'ORCA-Agent-0.0.6-win-x64.zip'); fs.writeFileSync(z, winBuf); fs.appendFileSync(z, 'x');
    fs.writeFileSync(path.join(process.env.ORCA_DATA, 'updates', 'pending.json'), JSON.stringify({ version: '0.0.6', zip: z, sha256: sha(winBuf) }));
    remote._override({ kind: 'win-portable', root: rootW, exe: path.join(rootW, 'ORCA.exe') });
    let msg = ''; try { await remote.applyUpdate(() => {}); } catch (e) { msg = e.message; }
    ok('apply-damaged', /damaged/.test(msg) && !remote.readPending(), msg); }
  // ---- checksum mismatch on download → file discarded ----
  { fs.rmSync(path.join(process.env.ORCA_DATA, 'updates'), { recursive: true, force: true }); sumsSha = 'f'.repeat(64); remote._override({ kind: 'dev', release });
    const d = await remote.downloadUpdate(() => {}); ok('download-mismatch', !d.ready && /checksum/.test(d.error) && !fs.existsSync(path.join(process.env.ORCA_DATA, 'updates', release.asset.name)), d.error); }
  // ---- NO trusted checksum at all → the package must be refused, never installed ----
  { fs.rmSync(path.join(process.env.ORCA_DATA, 'updates'), { recursive: true, force: true });
    remote._override({ kind: 'dev', release: { ...release, asset: { ...release.asset, sha256: '' }, sums: `${u}/dead/SHA256SUMS` } });
    const d = await remote.downloadUpdate(() => {});
    ok('download-no-checksum-refused', !d.ready && /no trusted checksum/.test(d.error) && !fs.existsSync(path.join(process.env.ORCA_DATA, 'updates', release.asset.name)), d.error); }

  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS'); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
