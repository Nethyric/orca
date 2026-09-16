'use strict';
// Post-processing for Windows build on Linux (no wine):
//  1) embed ORCA icon + version info into the exe with resedit (pure JS)
//  2) rename exe, add a launcher .bat + README
//  3) zip the portable folder
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pkg = require('../package.json');

(async () => {
  const ResEdit = await import('resedit');
  const dir = path.join(__dirname, '..', 'release', 'win-unpacked');
  const src = path.join(dir, 'ORCA Agent.exe');
  const dst = path.join(dir, 'ORCA.exe');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(src));
  const res = ResEdit.NtExecutableResource.from(exe);

  // icon
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.ico')));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map((i) => i.data));

  // version info
  const vi = ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = pkg.version.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'ORCA Agent — autonomous multi-model AI agent', ProductName: 'ORCA Agent', CompanyName: 'Nethyric', LegalCopyright: '© Nethyric', OriginalFilename: 'ORCA.exe', InternalName: 'ORCA', FileVersion: pkg.version, ProductVersion: pkg.version });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(dst, Buffer.from(exe.generate()));
  fs.unlinkSync(src);

  fs.writeFileSync(path.join(dir, 'README.txt'), [
    'ORCA Agent ' + pkg.version + ' — Windows x64 portable',
    '',
    'Run:      double-click ORCA.exe   (no installation needed)',
    'Data:     %APPDATA%\\ORCA Agent\\data   (chats, checkpoints, memory, config)',
    'Files:    %APPDATA%\\ORCA Agent\\data\\workspace   (change in Settings)',
    '',
    'Windows SmartScreen may warn because the exe is not code-signed:',
    '  click "More info" → "Run anyway".',
    '',
    'Web mode (optional, needs Node.js): npx @electron/asar extract resources\\app.asar app  then  node app\\src\\server.js  → http://localhost:7860',
    '',
    'Languages: English (default), فارسی, Русский, 中文 — click the language button in the title bar.',
    'Updates: ORCA checks GitHub Releases and offers one-click updates (Settings → Updates).',
  ].join('\r\n'));

  const out = path.join(__dirname, '..', 'release', `ORCA-Agent-${pkg.version}-win-x64.zip`);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  const tmp = path.join(__dirname, '..', 'release', 'ORCA-Agent');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.renameSync(dir, tmp);
  try { execSync(`cd "${path.dirname(tmp)}" && zip -qr -9 "${out}" "ORCA-Agent"`, { stdio: 'inherit' }); }
  catch (_) { execSync(`cd "${path.dirname(tmp)}" && python3 -m zipfile -c "${out}" "ORCA-Agent"`, { stdio: 'inherit' }); }
  fs.renameSync(tmp, dir);
  const mb = (fs.statSync(out).size / 1048576).toFixed(1);
  console.log(`\n✔ ${out} (${mb} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
