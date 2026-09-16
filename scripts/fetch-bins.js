'use strict';
// Downloads the binaries that are bundled into the Windows build (not committed to git):
//   bin/ffmpeg.exe, bin/yt-dlp.exe, assets/tessdata/{eng,fas,rus,chi_sim}.traineddata
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const root = path.join(__dirname, '..');
const get = async (url) => { const r = await fetch(url, { redirect: 'follow' }); if (!r.ok) throw new Error(url + ' → ' + r.status); return Buffer.from(await r.arrayBuffer()); };
(async () => {
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true }); fs.mkdirSync(path.join(root, 'assets', 'tessdata'), { recursive: true });
  const jobs = [
    ['bin/ffmpeg.exe', 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz', 'gz'],
    ['bin/yt-dlp.exe', 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'],
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
    fs.writeFileSync(f, b); console.log((b.length / 1048576).toFixed(1) + ' MB');
  }
})().catch((e) => { console.error(e); process.exit(1); });
