'use strict';
// Post-build step for the Windows job: writes release/README-win.txt, shipped next to the
// installers in every release. Icon and version resources are embedded natively by
// electron-builder (rcedit) since the build runs on a Windows runner.
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const txt = [
  `ORCA Agent ${pkg.version} — Windows x64`,
  '',
  'Two ways to run it:',
  '',
  `  1) Installer   ORCA-Setup-${pkg.version}-win-x64.exe`,
  '     Run it, choose a folder, done. Per-user install (no admin rights needed).',
  '     Uninstall from Settings > Apps, or "Uninstall ORCA Agent" in the install folder.',
  '',
  `  2) Portable    ORCA-${pkg.version}-win-x64-portable.exe`,
  '     A single file — run it from anywhere, nothing is installed.',
  '',
  `Data:     %APPDATA%\\ORCA Agent\\data   (chats, checkpoints, memory, config)`,
  `Files:    %APPDATA%\\ORCA Agent\\data\\workspace   (change in Settings)`,
  '',
  'Windows SmartScreen may warn because the exe is not code-signed:',
  '  click "More info" > "Run anyway".',
  '',
  'Updates:  ORCA updates itself. Installed builds download the next installer and',
  '          apply it silently on restart; the portable exe replaces its own file;',
  '          every package is verified against SHA256SUMS first (Settings > Updates).',
  '',
  'Web mode (optional, needs Node.js): extract ORCA-Agent-<version>-win-x64.zip,',
  '  then  node src\\server.js  inside it  ->  http://localhost:7860',
  '',
  'Languages: English (default), فارسی, Русский, 中文 — Settings > General.',
].join('\r\n');

const out = path.join(__dirname, '..', 'release', 'README-win.txt');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, txt);
console.log(`✔ ${out} (${txt.length} bytes)`);
