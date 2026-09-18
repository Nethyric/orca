'use strict';
// Post-processing for the macOS / Linux builds: drop a README next to the artifacts and print what was produced.
// (electron-builder already names the files ORCA-Agent-<version>-<os>-<arch>.<ext> — see package.json → build.)
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const which = process.argv[2] || (process.platform === 'darwin' ? 'mac' : 'linux');
const rel = path.join(__dirname, '..', 'release');
const files = fs.readdirSync(rel).filter((f) => /^ORCA-Agent-.*\.(zip|dmg|AppImage|tar\.gz)$/.test(f));

const readme = which === 'mac' ? [
  `ORCA Agent ${pkg.version} — macOS`,
  '',
  'Install:  open the .dmg and drag ORCA Agent to Applications (or unzip the .zip).',
  '          Apple Silicon → arm64 build, Intel → x64 build.',
  'First run: the app is not notarized. If macOS says it "cannot be opened", right-click the app → Open → Open,',
  '          or run:  xattr -dr com.apple.quarantine "/Applications/ORCA Agent.app"',
  'Data:     ~/Library/Application Support/ORCA Agent/data   (chats, checkpoints, memory, config)',
  'Files:    ~/Library/Application Support/ORCA Agent/data/workspace   (change in Settings)',
  '',
  'Languages: English (default), فارسی, Русский, 中文 — language button in the title bar.',
  'Updates:  ORCA checks GitHub Releases; on macOS it downloads the new build and opens the folder for you.',
] : [
  `ORCA Agent ${pkg.version} — Linux x64`,
  '',
  'AppImage: chmod +x ORCA-Agent-*.AppImage && ./ORCA-Agent-*.AppImage',
  '          (needs FUSE 2; on Ubuntu 22.04+: sudo apt install libfuse2 — or run with --appimage-extract-and-run)',
  'tar.gz:   tar xzf ORCA-Agent-*.tar.gz && ./ORCA-Agent-*/orca-agent',
  'Data:     ~/.config/ORCA Agent/data   (chats, checkpoints, memory, config)',
  'Files:    ~/.config/ORCA Agent/data/workspace   (change in Settings)',
  '',
  'Sandbox:  if the app refuses to start on a hardened kernel, run with --no-sandbox.',
  'Languages: English (default), فارسی, Русский, 中文 — language button in the title bar.',
  'Updates:  ORCA checks GitHub Releases; on Linux it downloads the new build and opens the folder for you.',
];
fs.writeFileSync(path.join(rel, `README-${which}.txt`), readme.join('\n') + '\n');

for (const f of files) console.log(`✔ ${f} (${(fs.statSync(path.join(rel, f)).size / 1048576).toFixed(1)} MB)`);
if (!files.length) { console.error('no artifacts found in release/'); process.exit(1); }
