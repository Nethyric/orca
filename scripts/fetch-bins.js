'use strict';
// Downloads the binaries bundled into the desktop builds (not committed to git):
//   bin/ffmpeg(.exe), bin/yt-dlp(.exe) for the target platform, assets/tessdata/{eng,fas,rus,chi_sim}.traineddata
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const root = path.join(__dirname, '..');
const get = async (url) => { const r = await fetch(url, { redirect: 'follow' }); if (!r.ok) throw new Error(url + ' → ' + r.status); return Buffer.from(await r.arrayBuffer()); };
(async () => {
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true }); fs.mkdirSync(path.join(root, 'assets', 'tessdata'), { recursive: true });
  // which platform are we bundling for? (defaults to the host; override with ORCA_TARGET=win|mac|linux and ORCA_ARCH=x64|arm64)
  const target = process.env.ORCA_TARGET || ({ win32: 'win', darwin: 'mac', linux: 'linux' })[process.platform] || 'linux';
  const arch = process.env.ORCA_ARCH || (process.arch === 'arm64' ? 'arm64' : 'x64');
  const FF = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';
  const YT = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
  const bins = target === 'win' ? [['bin/ffmpeg.exe', FF + 'ffmpeg-win32-x64.gz', 'gz'], ['bin/yt-dlp.exe', YT + 'yt-dlp.exe']]
    : target === 'mac' ? [['bin/ffmpeg', FF + (arch === 'arm64' ? 'ffmpeg-darwin-arm64.gz' : 'ffmpeg-darwin-x64.gz'), 'gz'], ['bin/yt-dlp', YT + 'yt-dlp_macos']]
    : [['bin/ffmpeg', FF + (arch === 'arm64' ? 'ffmpeg-linux-arm64.gz' : 'ffmpeg-linux-x64.gz'), 'gz'], ['bin/yt-dlp', YT + (arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux')]];
  console.log(`bundling for ${target}/${arch}`);
  const jobs = [
    ...bins,
    ['assets/tessdata/eng.traineddata', 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata'],
    ['assets/tessdata/fas.traineddata', 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/fas.traineddata'],
    ['assets/tessdata/rus.traineddata', 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/rus.traineddata'],
    ['assets/tessdata/chi_sim.traineddata', 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/chi_sim.traineddata'],
  ];
  for (const [dst, url, kind] of jobs) {
    const f = path.join(root, dst);
    if (fs.existsSync(f) && fs.statSync(f).size > 100000) { console.log('✓ have', dst); continue; }
    process.stdout.write('↓ ' + dst + ' … ');
    let b = await get(url); if (kind === 'gz') b = zlib.gunzipSync(b);
    fs.writeFileSync(f, b); if (!dst.endsWith('.exe') && dst.startsWith('bin/')) fs.chmodSync(f, 0o755); console.log((b.length / 1048576).toFixed(1) + ' MB');
  }
})().catch((e) => { console.error(e); process.exit(1); });
