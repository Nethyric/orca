'use strict';
// Office / document / media tools: Word, Excel, PowerPoint, PDF reading, media (ffmpeg) editing.
// Everything works offline on the user's machine; ffmpeg ships with the app (bin/ffmpeg[.exe]).
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

let deps = null;
function D() {
  if (deps) return deps;
  deps = {};
  for (const [k, m] of [['docx', 'docx'], ['exceljs', 'exceljs'], ['pptx', 'pptxgenjs'], ['mammoth', 'mammoth'], ['pdf', 'pdf-parse']]) {
    try { deps[k] = require(m); } catch (e) { deps[k] = null; deps[k + 'Err'] = e.message; }
  }
  return deps;
}
const need = (k, label) => { const d = D()[k]; if (!d) throw new Error(`${label} support is not available in this build (${D()[k + 'Err'] || 'module missing'})`); return d; };

// ---------- ffmpeg discovery ----------
const isWin = process.platform === 'win32';
let ffmpegPath = null;
function findFfmpeg() {
  if (ffmpegPath !== null) return ffmpegPath;
  const exe = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', exe) : null, // packaged app (extraResources)
    path.join(__dirname, '..', '..', 'bin', exe),                                 // dev checkout
    process.env.FFMPEG_PATH || null,
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) { if (!isWin) try { fs.chmodSync(c, 0o755); } catch (_) {} ffmpegPath = c; return c; } } catch (_) {} }
  try { execFileSync(exe, ['-version'], { stdio: 'ignore', windowsHide: true }); ffmpegPath = exe; return exe; } catch (_) {}
  ffmpegPath = ''; return '';
}

function makeTools({ safe, rel, WS }) {
  const relSafe = (p) => rel(safe(p));
  const ensureDir = (f) => fs.mkdirSync(path.dirname(f), { recursive: true });
  const stat = (f) => { const s = fs.statSync(f); return { path: rel(f), bytes: s.size }; };

  // ---------- Word ----------
  async function write_docx({ path: p, title, blocks = [], markdown, rtl }) {
    const docx = need('docx', 'Word');
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun, PageBreak } = docx;
    if (markdown && !blocks.length) blocks = mdToBlocks(markdown);
    const auto = rtl ?? blocks.some((b) => /[\u0600-\u06FF]/.test(JSON.stringify(b)));
    const font = auto ? 'Vazirmatn' : 'Calibri';
    const para = (text, opts = {}) => new Paragraph({ bidirectional: auto, alignment: auto ? AlignmentType.RIGHT : AlignmentType.LEFT, ...opts, children: runs(text, opts.bold) });
    const runs = (text, bold) => String(text ?? '').split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((seg) => { const b = /^\*\*[^*]+\*\*$/.test(seg); return new TextRun({ text: b ? seg.slice(2, -2) : seg, bold: bold || b, rightToLeft: auto, font }); });
    const children = [];
    if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE, bidirectional: auto, alignment: auto ? AlignmentType.RIGHT : AlignmentType.LEFT }));
    for (const b of blocks) {
      const type = b.type || (typeof b === 'string' ? 'p' : 'p');
      const text = typeof b === 'string' ? b : b.text;
      if (type === 'h1' || type === 'h2' || type === 'h3') children.push(new Paragraph({ text: String(text), heading: { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 }[type], bidirectional: auto, alignment: auto ? AlignmentType.RIGHT : AlignmentType.LEFT }));
      else if (type === 'bullets' || type === 'numbers') for (const it of b.items || []) children.push(para(it, { bullet: type === 'bullets' ? { level: 0 } : undefined, numbering: type === 'numbers' ? { reference: 'nums', level: 0 } : undefined }));
      else if (type === 'table') {
        const rows = (b.rows || []).map((r, i) => new TableRow({ children: r.map((c) => new TableCell({ children: [para(c, { bold: i === 0 && b.header !== false })], width: { size: Math.floor(100 / r.length), type: WidthType.PERCENTAGE } })) }));
        children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: auto }));
        children.push(para(''));
      } else if (type === 'image' && b.path) {
        try { const img = fs.readFileSync(safe(b.path)); children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: img, transformation: { width: b.width || 480, height: b.height || 300 }, type: path.extname(b.path).slice(1).replace('jpg', 'jpeg') })] })); } catch (e) { children.push(para(`[image missing: ${b.path}]`)); }
      } else if (type === 'pagebreak') children.push(new Paragraph({ children: [new PageBreak()] }));
      else if (type === 'quote') children.push(para(text, { indent: { left: 720 }, italics: true }));
      else children.push(para(text));
    }
    const doc = new Document({ creator: 'ORCA', title: title || '', styles: { default: { document: { run: { font, size: 24 } } } }, numbering: { config: [{ reference: 'nums', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }] }] }, sections: [{ properties: auto ? { bidi: true } : {}, children }] });
    const f = safe(p.endsWith('.docx') ? p : p + '.docx'); ensureDir(f);
    fs.writeFileSync(f, await Packer.toBuffer(doc));
    return { ok: true, ...stat(f), blocks: blocks.length };
  }
  function mdToBlocks(md) {
    const out = []; const lines = String(md).split('\n'); let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^#{1,3}\s/.test(l)) { out.push({ type: 'h' + (l.match(/^#+/)[0].length), text: l.replace(/^#+\s*/, '') }); i++; continue; }
      if (/^\s*[-*]\s/.test(l)) { const items = []; while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s/, '')); out.push({ type: 'bullets', items }); continue; }
      if (/^\s*\d+[.)]\s/.test(l)) { const items = []; while (i < lines.length && /^\s*\d+[.)]\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s/, '')); out.push({ type: 'numbers', items }); continue; }
      if (/^\|/.test(l)) { const rows = []; while (i < lines.length && /^\|/.test(lines[i])) { const r = lines[i++]; if (/^\|\s*:?-+/.test(r)) continue; rows.push(r.split('|').slice(1, -1).map((c) => c.trim())); } out.push({ type: 'table', rows }); continue; }
      if (/^>\s?/.test(l)) { out.push({ type: 'quote', text: l.replace(/^>\s?/, '') }); i++; continue; }
      if (l.trim() === '---') { out.push({ type: 'pagebreak' }); i++; continue; }
      if (l.trim()) { let t = l; while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|[-*]\s|\d+[.)]\s|\||>)/.test(lines[i + 1])) t += ' ' + lines[++i]; out.push({ type: 'p', text: t }); }
      i++;
    }
    return out;
  }
  async function read_docx({ path: p }) {
    const mammoth = need('mammoth', 'Word');
    const f = safe(p);
    const r = await mammoth.convertToMarkdown({ path: f });
    const text = r.value.replace(/\n{3,}/g, '\n\n');
    return { path: rel(f), chars: text.length, markdown: text.slice(0, 60000), truncated: text.length > 60000, warnings: r.messages.slice(0, 5).map((m) => m.message) };
  }

  // ---------- Excel ----------
  async function write_xlsx({ path: p, sheets = [], rtl }) {
    const ExcelJS = need('exceljs', 'Excel');
    const wb = new ExcelJS.Workbook(); wb.creator = 'ORCA';
    const auto = rtl ?? /[\u0600-\u06FF]/.test(JSON.stringify(sheets));
    for (const s of sheets) {
      const ws = wb.addWorksheet((s.name || 'Sheet').slice(0, 31), { views: [{ rightToLeft: auto, state: s.freezeHeader === false ? undefined : 'frozen', ySplit: 1 }] });
      const rows = s.rows || [];
      const grid = rows.map((r) => r.map((c) => (typeof c === 'string' && /^=/.test(c) ? null : c)));
      const cellVal = (ref) => { const m = ref.match(/^([A-Z]+)(\d+)$/); if (!m) return NaN; const col = m[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1; const v = grid[+m[2] - 1]?.[col]; return typeof v === 'number' ? v : Number(v) || 0; };
      const evalF = (f) => { try { const expr = f.replace(/SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/gi, (_, c1, r1, c2, r2) => { let t = 0; for (let r = +r1; r <= +r2; r++) t += cellVal(c1 + r); return String(t); }).replace(/AVERAGE\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/gi, (_, c1, r1, c2, r2) => { let t = 0, n = 0; for (let r = +r1; r <= +r2; r++) { t += cellVal(c1 + r); n++; } return String(n ? t / n : 0); }).replace(/\b([A-Z]+\d+)\b/g, (m) => String(cellVal(m))); if (!/^[\d\s+\-*/().,]+$/.test(expr)) return undefined; const v = Function('"use strict";return (' + expr + ')')(); return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : undefined; } catch (_) { return undefined; } };
      rows.forEach((r, ri) => { r.forEach((c, ci) => { if (typeof c === 'string' && /^=/.test(c)) { const v = evalF(c.slice(1).toUpperCase()); if (v !== undefined) grid[ri][ci] = v; } }); });
      for (let ri = 0; ri < rows.length; ri++) ws.addRow(rows[ri].map((c, ci) => (typeof c === 'string' && /^=/.test(c) ? { formula: c.slice(1), result: grid[ri][ci] ?? undefined } : c)));
      if (rows.length && s.header !== false) { ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECFF' } }; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rows[0].length } }; }
      ws.columns.forEach((col, i) => { let w = 8; for (const r of rows.slice(0, 200)) { const v = r[i]; const len = v == null ? 0 : String(typeof v === 'object' ? v.result || '' : v).length; if (len > w) w = len; } col.width = Math.min(w + 2, 60); });
      for (const nf of s.numberFormats || []) ws.getColumn(nf.column).numFmt = nf.format; // e.g. {column:'C', format:'#,##0'}
      if (s.totals) { const r = ws.addRow([]); const n = rows.length; r.getCell(1).value = auto ? 'جمع' : 'Total'; r.getCell(1).font = { bold: true }; for (const col of s.totals) { const L = typeof col === 'number' ? ws.getColumn(col).letter : col; const ci = L.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1; let t = 0; for (let ri = 1; ri < n; ri++) t += Number(grid[ri]?.[ci]) || 0; r.getCell(L).value = { formula: `SUM(${L}2:${L}${n})`, result: t }; r.getCell(L).font = { bold: true }; } }
    }
    const f = safe(p.endsWith('.xlsx') ? p : p + '.xlsx'); ensureDir(f);
    await wb.xlsx.writeFile(f);
    return { ok: true, ...stat(f), sheets: sheets.map((s) => `${s.name || 'Sheet'} (${(s.rows || []).length} rows)`) };
  }
  async function read_xlsx({ path: p, sheet, max_rows = 200 }) {
    const ExcelJS = need('exceljs', 'Excel');
    const f = safe(p); const wb = new ExcelJS.Workbook();
    if (/\.csv$/i.test(f)) { const ws = await wb.csv.readFile(f); return { path: rel(f), sheets: [{ name: 'csv', rows: dump(ws, max_rows), total_rows: ws.rowCount }] }; }
    await wb.xlsx.readFile(f);
    const list = wb.worksheets.filter((w) => !sheet || w.name === sheet);
    return { path: rel(f), sheets: list.map((w) => ({ name: w.name, total_rows: w.rowCount, columns: w.columnCount, rows: dump(w, max_rows) })) };
  }
  const dump = (ws, max) => { const rows = []; ws.eachRow({ includeEmpty: false }, (row, n) => { if (rows.length < max) rows.push(row.values.slice(1).map((v) => (v && typeof v === 'object' ? (v.result ?? v.text ?? v.richText?.map((x) => x.text).join('') ?? (v instanceof Date ? v.toISOString().slice(0, 10) : JSON.stringify(v))) : v))); }); return rows; };

  // ---------- PowerPoint ----------
  async function write_pptx({ path: p, title, subtitle, slides = [], theme = 'dark', rtl }) {
    const PptxGenJS = need('pptx', 'PowerPoint');
    const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_16x9'; pptx.author = 'ORCA';
    const auto = rtl ?? /[\u0600-\u06FF]/.test(JSON.stringify([title, subtitle, slides]));
    const T = theme === 'light' ? { bg: 'FFFFFF', fg: '1A1D2B', muted: '5A607A', acc: '4F5BD5', card: 'F2F4FA' } : { bg: '0F1118', fg: 'F5F6FA', muted: 'A9AFC6', acc: '7C8BFF', card: '1A1D2B' };
    const font = auto ? 'Vazirmatn' : 'Calibri';
    const base = { fontFace: font, color: T.fg, rtlMode: auto, align: auto ? 'right' : 'left' };
    if (title) {
      const s = pptx.addSlide(); s.background = { color: T.bg };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 5.625, fill: { color: T.acc } });
      s.addText(title, { ...base, x: 0.8, y: 1.6, w: 8.4, h: 1.4, fontSize: 40, bold: true });
      if (subtitle) s.addText(subtitle, { ...base, x: 0.8, y: 3.0, w: 8.4, h: 0.8, fontSize: 20, color: T.muted });
    }
    slides.forEach((sl, idx) => {
      const s = pptx.addSlide(); s.background = { color: T.bg };
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 5.45, w: 10, h: 0.18, fill: { color: T.acc } });
      if (sl.title) s.addText(sl.title, { ...base, x: 0.5, y: 0.35, w: 9, h: 0.9, fontSize: 28, bold: true });
      let y = 1.4;
      if (sl.bullets && sl.bullets.length) { s.addText(sl.bullets.map((b) => ({ text: String(b), options: { bullet: true, breakLine: true } })), { ...base, x: 0.6, y, w: sl.image ? 5.2 : 8.8, h: 3.8, fontSize: 18, valign: 'top', paraSpaceAfter: 8 }); }
      if (sl.text && !sl.bullets) { s.addText(String(sl.text), { ...base, x: 0.6, y, w: 8.8, h: 3.8, fontSize: 18, valign: 'top' }); }
      if (sl.table && sl.table.length) { s.addTable(sl.table.map((r, i) => r.map((c) => ({ text: String(c), options: { bold: i === 0, fill: { color: i === 0 ? T.acc : T.card }, color: T.fg, fontFace: font, align: auto ? 'right' : 'left', rtlMode: auto } }))), { x: 0.6, y, w: 8.8, fontSize: 14, border: { type: 'solid', color: T.bg, pt: 1 } }); }
      if (sl.chart && sl.chart.labels) { const type = { bar: pptx.ChartType.bar, line: pptx.ChartType.line, pie: pptx.ChartType.pie, doughnut: pptx.ChartType.doughnut }[sl.chart.type || 'bar']; s.addChart(type, [{ name: sl.chart.name || sl.title || 'Series', labels: sl.chart.labels, values: sl.chart.values }], { x: 0.8, y: 1.3, w: 8.4, h: 3.9, chartColors: [T.acc, '22C48A', 'F0A531', 'F0567C', '22B8D6'], catAxisLabelColor: T.muted, valAxisLabelColor: T.muted, dataLabelColor: T.fg, showLegend: sl.chart.type === 'pie' || sl.chart.type === 'doughnut', legendColor: T.fg, showValue: true, dataLabelFontFace: font }); }
      if (sl.image) { try { const f = safe(sl.image); s.addImage({ path: f, x: 6.0, y: 1.4, w: 3.6, h: 3.6, sizing: { type: 'contain', w: 3.6, h: 3.6 } }); } catch (_) {} }
      if (sl.notes) s.addNotes(String(sl.notes));
      s.addText(String(idx + 1), { x: 9.3, y: 5.05, w: 0.5, h: 0.3, fontSize: 10, color: T.muted, align: 'right', fontFace: font });
    });
    const f = safe(p.endsWith('.pptx') ? p : p + '.pptx'); ensureDir(f);
    await pptx.writeFile({ fileName: f });
    return { ok: true, ...stat(f), slides: slides.length + (title ? 1 : 0) };
  }

  // ---------- PDF ----------
  async function read_pdf({ path: p, max_chars = 40000 }) {
    const pdf = need('pdf', 'PDF');
    const f = safe(p); const r = await pdf(fs.readFileSync(f));
    const text = r.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { path: rel(f), pages: r.numpages, chars: text.length, text: text.slice(0, max_chars), truncated: text.length > max_chars, info: r.info ? { title: r.info.Title, author: r.info.Author } : undefined };
  }

  // ---------- Media (ffmpeg) ----------
  function ff(args, timeout = 600) {
    const bin = findFfmpeg();
    if (!bin) return Promise.resolve({ error: 'ffmpeg not found. Reinstall ORCA or set FFMPEG_PATH.' });
    return new Promise((resolve) => {
      let out = ''; let done = false;
      const child = spawn(bin, ['-hide_banner', '-nostdin', '-y', ...args], { cwd: WS(), windowsHide: true });
      const timer = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch (_) {} resolve({ error: `ffmpeg timed out after ${timeout}s`, log: out.slice(-3000) }); } }, timeout * 1000);
      child.stderr.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); }); child.stdout.on('data', (d) => { out += d; });
      child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ error: e.message }); } });
      child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve(code === 0 ? { ok: true, log: out.slice(-1500) } : { error: `ffmpeg exited with ${code}`, log: out.slice(-3000) }); } });
    });
  }
  async function media_info({ path: p }) {
    const f = safe(p); if (!fs.existsSync(f)) return { error: 'not found: ' + p };
    const r = await ff(['-i', f], 30); // ffmpeg -i (no output) → exit 1 but prints stream info
    const log = r.log || '';
    const dur = (log.match(/Duration: (\d+):(\d+):(\d+\.\d+)/) || []);
    const seconds = dur.length ? (+dur[1]) * 3600 + (+dur[2]) * 60 + (+dur[3]) : null;
    const video = (log.match(/Stream #[^\n]*Video: ([^\n]*)/) || [])[1] || null;
    const audio = (log.match(/Stream #[^\n]*Audio: ([^\n]*)/) || [])[1] || null;
    const res = (video && video.match(/(\d{2,5})x(\d{2,5})/)) || [];
    const fps = (video && video.match(/([\d.]+) fps/)) || [];
    return { path: rel(f), bytes: fs.statSync(f).size, duration_seconds: seconds, duration: dur.length ? `${dur[1]}:${dur[2]}:${dur[3]}` : null, width: res[1] ? +res[1] : null, height: res[2] ? +res[2] : null, fps: fps[1] ? +fps[1] : null, video, audio, bitrate: (log.match(/bitrate: ([^\n]+)/) || [])[1] || null };
  }
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%');
  const assColor = (c) => { const m = { white: 'FFFFFF', black: '000000', yellow: 'FFE100', red: 'FF3B3B', green: '22C48A', blue: '4F8BFF', orange: 'F0A531', cyan: '22B8D6' }; let hex = (m[String(c).toLowerCase()] || String(c).replace('#', '')).padStart(6, '0').slice(0, 6); return `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`; };
  const assTime = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = (sec % 60); return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
  const fontFile = () => { const cands = [process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'ui', 'vendor', 'Vazirmatn.ttf') : null, path.join(__dirname, '..', '..', 'ui', 'vendor', 'Vazirmatn.ttf')].filter(Boolean); return cands.find((f) => fs.existsSync(f)) || null; };
  const fontsDirArg = () => { const f = fontFile(); return f ? `:fontsdir='${esc(path.dirname(f))}'` : ''; };
  function assDoc({ text, font_size = 36, color = 'white', position = 'bottom', box = true, width, height, seconds, events }) {
    const align = position === 'top' ? 8 : position === 'center' ? 5 : 2;
    const fs_ = Math.round(font_size * (height / 720));
    const style = `Style: Default,Vazirmatn,${fs_},${assColor(color)},&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,${box ? 3 : 1},${box ? 8 : 2},1,${align},40,40,40,1`;
    const evs = events || [{ start: 0, end: seconds, text }];
    const lines = evs.map((e) => `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Default,,0,0,0,,${String(e.text).replace(/\r?\n/g, '\\N')}`);
    return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${style}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`;
  }
  const parseSrt = (txt) => { const out = []; const t = (s) => { const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : 0; }; for (const block of String(txt).replace(/^\uFEFF/, '').split(/\r?\n\r?\n+/)) { const ls = block.split(/\r?\n/).filter((l) => l.trim()); const ti = ls.findIndex((l) => l.includes('-->')); if (ti === -1) continue; const [a, b] = ls[ti].split('-->'); out.push({ start: t(a), end: t(b), text: ls.slice(ti + 1).join('\n') }); } return out; };
  async function media_edit({ input, output, operation, start, end, duration, width, height, scale, speed, volume, fps, format, text, font_size = 36, position = 'bottom', color = 'white', box = true, crop, rotate, mute, fade_in, fade_out, bitrate, quality, extra_args = [], timeout = 900 }) {
    const inF = safe(input); if (!fs.existsSync(inF)) return { error: 'input not found: ' + input };
    if (!output) { const e = path.extname(input); output = input.slice(0, -e.length) + '.' + (operation || 'edit') + (format ? '.' + format : e); }
    const outF = safe(output); ensureDir(outF);
    const args = []; const vf = []; const af = []; let copy = false;
    if (start != null) args.push('-ss', String(start));
    args.push('-i', inF);
    if (end != null) args.push('-to', String(end)); else if (duration != null) args.push('-t', String(duration));
    switch (operation) {
      case 'trim': case 'cut': copy = !(fade_in || fade_out || speed || volume); break;
      case 'convert': break;
      case 'resize': vf.push(scale ? `scale=iw*${scale}:-2` : `scale=${width || -2}:${height || -2}`); break;
      case 'compress': args.push('-crf', String(quality || 28), '-preset', 'medium'); if (!width && !height && !scale) vf.push('scale=\'min(1280,iw)\':-2'); else vf.push(scale ? `scale=iw*${scale}:-2` : `scale=${width || -2}:${height || -2}`); break;
      case 'extract_audio': args.push('-vn'); if (!format && !/\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(output)) output += '.mp3'; break;
      case 'remove_audio': args.push('-an', '-c:v', 'copy'); break;
      case 'speed': { const s = +speed || 2; vf.push(`setpts=${(1 / s).toFixed(4)}*PTS`); let a = s; const chain = []; while (a > 2) { chain.push('atempo=2'); a /= 2; } while (a < 0.5) { chain.push('atempo=0.5'); a *= 2; } chain.push(`atempo=${a.toFixed(4)}`); af.push(chain.join(',')); break; }
      case 'gif': args.push('-r', String(fps || 12)); vf.push(`scale=${width || 480}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`); break;
      case 'thumbnail': args.push('-frames:v', '1'); if (width) vf.push(`scale=${width}:-2`); break;
      case 'frames': args.push('-vf', `fps=${fps || 1}`); break;
      case 'watermark_text': case 'text': {
        // Rendered through libass (proper Persian/Arabic shaping + RTL), not drawtext.
        const info = await media_info({ path: input });
        const total = duration != null ? +duration : end != null ? +end - (+start || 0) : Math.max(1, (info.duration_seconds || 3600) - (+start || 0));
        const assF = path.join(WS(), '.orca_text.ass');
        fs.writeFileSync(assF, assDoc({ text, font_size, color, position, box, width: info.width || 1280, height: info.height || 720, seconds: total }));
        vf.push(`ass='${esc(assF)}'${fontsDirArg()}`); break; }
      case 'crop': if (crop) vf.push(`crop=${crop}`); break; // "w:h:x:y" or "in_w/2:in_h"
      case 'rotate': vf.push({ 90: 'transpose=1', 180: 'transpose=1,transpose=1', 270: 'transpose=2', '-90': 'transpose=2' }[String(rotate || 90)] || `rotate=${rotate}*PI/180`); break;
      case 'volume': af.push(`volume=${volume || 1.5}`); break;
      case 'normalize_audio': af.push('loudnorm=I=-16:LRA=11:TP=-1.5'); break;
      case 'fade': break;
      case 'to_audio_format': args.push('-vn'); break;
      case 'custom': break;
      default: return { error: `unknown operation "${operation}". Use one of: trim, convert, resize, compress, extract_audio, remove_audio, speed, gif, thumbnail, frames, text, crop, rotate, volume, normalize_audio, fade, custom` };
    }
    if (fade_in) { vf.push(`fade=t=in:st=0:d=${fade_in}`); af.push(`afade=t=in:st=0:d=${fade_in}`); }
    if (fade_out) { const info = await media_info({ path: input }); const total = (duration != null ? +duration : end != null ? +end - (+start || 0) : (info.duration_seconds || 0) - (+start || 0)); if (total) { vf.push(`fade=t=out:st=${Math.max(0, total - fade_out)}:d=${fade_out}`); af.push(`afade=t=out:st=${Math.max(0, total - fade_out)}:d=${fade_out}`); } }
    if (mute) args.push('-an');
    if (fps && !['gif', 'frames'].includes(operation)) args.push('-r', String(fps));
    if (vf.length) args.push('-vf', vf.join(','));
    if (af.length && !mute) args.push('-af', af.join(','));
    if (bitrate) args.push('-b:v', String(bitrate));
    if (copy && !vf.length && !af.length) args.push('-c', 'copy');
    else if (/\.(mp4|mov|m4v)$/i.test(output) && !['extract_audio'].includes(operation)) args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...(args.includes('-an') ? [] : ['-c:a', 'aac']));
    args.push(...extra_args.map(String));
    let finalOut = safe(output);
    if (operation === 'frames') { fs.mkdirSync(finalOut.replace(/\.[^.]+$/, ''), { recursive: true }); finalOut = path.join(finalOut.replace(/\.[^.]+$/, ''), 'frame_%04d.jpg'); }
    const r = await ff([...args, finalOut], timeout);
    if (r.error) return r;
    if (operation === 'frames') { const dir = path.dirname(finalOut); return { ok: true, folder: rel(dir), frames: fs.readdirSync(dir).length }; }
    const info = await media_info({ path: rel(finalOut) }).catch(() => ({}));
    return { ok: true, output: rel(finalOut), bytes: fs.existsSync(finalOut) ? fs.statSync(finalOut).size : 0, duration: info.duration, width: info.width, height: info.height, command: 'ffmpeg ' + args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ').slice(0, 400) };
  }
  async function media_concat({ inputs = [], output, reencode }) {
    if (inputs.length < 2) return { error: 'need at least two inputs' };
    const files = inputs.map((p) => safe(p)); for (const f of files) if (!fs.existsSync(f)) return { error: 'not found: ' + rel(f) };
    const outF = safe(output || 'joined.mp4'); ensureDir(outF);
    if (!reencode) {
      const list = path.join(WS(), '.orca_concat.txt'); fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      const r = await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', outF], 600);
      try { fs.unlinkSync(list); } catch (_) {}
      if (!r.error) return { ok: true, output: rel(outF), bytes: fs.statSync(outF).size, mode: 'copy' };
    }
    const args = []; files.forEach((f) => args.push('-i', f));
    const n = files.length; const fc = files.map((_, i) => `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=48000[a${i}]`).join(';') + ';' + files.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${n}:v=1:a=1[v][a]`;
    const r = await ff([...args, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outF], 1800);
    return r.error ? r : { ok: true, output: rel(outF), bytes: fs.statSync(outF).size, mode: 'reencode' };
  }
  async function media_from_images({ images = [], folder, output = 'slideshow.mp4', seconds_per_image = 3, audio, width = 1280, height = 720, fade = 0.5 }) {
    let files = images.map((p) => safe(p));
    if (folder) { const d = safe(folder); files = fs.readdirSync(d).filter((x) => /\.(png|jpe?g|webp|bmp)$/i.test(x)).sort().map((x) => path.join(d, x)); }
    if (!files.length) return { error: 'no images' };
    const outF = safe(output); ensureDir(outF);
    const args = []; files.forEach((f) => args.push('-loop', '1', '-t', String(seconds_per_image), '-i', f));
    if (audio) args.push('-i', safe(audio));
    const n = files.length;
    const parts = files.map((_, i) => `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30${fade ? `,fade=t=in:st=0:d=${fade},fade=t=out:st=${seconds_per_image - fade}:d=${fade}` : ''}[v${i}]`).join(';');
    const fc = parts + ';' + files.map((_, i) => `[v${i}]`).join('') + `concat=n=${n}:v=1:a=0[v]`;
    args.push('-filter_complex', fc, '-map', '[v]');
    if (audio) args.push('-map', `${n}:a`, '-shortest', '-c:a', 'aac');
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outF);
    const r = await ff(args, 1800);
    return r.error ? r : { ok: true, output: rel(outF), bytes: fs.statSync(outF).size, images: n, duration_seconds: n * seconds_per_image };
  }
  async function media_subtitles({ input, srt, output, burn = true, font_size = 24 }) {
    const inF = safe(input), srtF = safe(srt); if (!fs.existsSync(inF) || !fs.existsSync(srtF)) return { error: 'input or srt not found' };
    const outF = safe(output || input.replace(/(\.[^.]+)$/, '.subtitled$1')); ensureDir(outF);
    let assF = srtF;
    if (burn && /\.srt$/i.test(srtF)) { const info = await media_info({ path: input }); assF = path.join(WS(), '.orca_subs.ass'); fs.writeFileSync(assF, assDoc({ font_size, color: 'white', position: 'bottom', box: false, width: info.width || 1280, height: info.height || 720, events: parseSrt(fs.readFileSync(srtF, 'utf8')) })); }
    const r = burn
      ? await ff(['-i', inF, '-vf', `ass='${esc(assF)}'${fontsDirArg()}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', outF], 1800)
      : await ff(['-i', inF, '-i', srtF, '-c', 'copy', '-c:s', 'mov_text', outF], 600);
    return r.error ? r : { ok: true, output: rel(outF), bytes: fs.statSync(outF).size };
  }

  const impl = { write_docx, read_docx, write_xlsx, read_xlsx, write_pptx, read_pdf, media_info, media_edit, media_concat, media_from_images, media_subtitles };
  const SCHEMAS = [
    { type: 'function', function: { name: 'write_docx', description: 'Create a Word (.docx) document. Pass `markdown` (headings #, bullets -, numbered 1., tables |a|b|, **bold**, --- page break) OR structured `blocks`. Persian/RTL is auto-detected.', parameters: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' }, markdown: { type: 'string' }, blocks: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['p', 'h1', 'h2', 'h3', 'bullets', 'numbers', 'table', 'image', 'quote', 'pagebreak'] }, text: { type: 'string' }, items: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, path: { type: 'string' } } } }, rtl: { type: 'boolean' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'read_docx', description: 'Read a Word .docx file as Markdown text.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_xlsx', description: 'Create an Excel (.xlsx) workbook. Each sheet: name + rows (first row = header, bold + filter + frozen). Cells starting with "=" are formulas (e.g. "=B2*C2"). `totals`: columns to SUM at the bottom (e.g. ["C","D"]). `numberFormats`: [{column:"C", format:"#,##0"}]. Compute numbers yourself when possible; use formulas for live sheets.', parameters: { type: 'object', properties: { path: { type: 'string' }, sheets: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, rows: { type: 'array', items: { type: 'array' } }, totals: { type: 'array', items: { type: 'string' } }, numberFormats: { type: 'array', items: { type: 'object' } }, header: { type: 'boolean' } }, required: ['rows'] } }, rtl: { type: 'boolean' } }, required: ['path', 'sheets'] } } },
    { type: 'function', function: { name: 'read_xlsx', description: 'Read an Excel .xlsx or .csv file: sheet names and rows (formulas return their cached results).', parameters: { type: 'object', properties: { path: { type: 'string' }, sheet: { type: 'string' }, max_rows: { type: 'integer' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_pptx', description: 'Create a PowerPoint (.pptx) deck with a designed theme. Title slide (title/subtitle) + slides: {title, bullets[] | text | table[][] | chart{type:bar|line|pie|doughnut, labels[], values[]}, image, notes}. Keep 3-6 bullets per slide.', parameters: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, slides: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, text: { type: 'string' }, table: { type: 'array', items: { type: 'array' } }, chart: { type: 'object' }, image: { type: 'string' }, notes: { type: 'string' } } } }, rtl: { type: 'boolean' } }, required: ['path', 'slides'] } } },
    { type: 'function', function: { name: 'read_pdf', description: 'Extract the text of a PDF file (page count + text).', parameters: { type: 'object', properties: { path: { type: 'string' }, max_chars: { type: 'integer' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'media_info', description: 'Inspect a video/audio file: duration, resolution, fps, codecs, bitrate. Use before editing.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'media_edit', description: 'Edit video/audio with the built-in ffmpeg. operation: trim (start/end or duration, "00:01:05" or seconds), convert (by output extension), resize (width/height/scale), compress (quality 18-35, lower=better), extract_audio (→mp3), remove_audio, speed (speed 0.25-4), gif (width,fps), thumbnail (start), frames (fps), text (text/position/font_size/color — burn caption/watermark), crop ("w:h:x:y"), rotate (90/180/270), volume (volume 0-3), normalize_audio, fade (fade_in/fade_out seconds), custom (extra_args). Output goes to `output` (default: <input>.<operation>.<ext>).', parameters: { type: 'object', properties: { input: { type: 'string' }, output: { type: 'string' }, operation: { type: 'string', enum: ['trim', 'convert', 'resize', 'compress', 'extract_audio', 'remove_audio', 'speed', 'gif', 'thumbnail', 'frames', 'text', 'crop', 'rotate', 'volume', 'normalize_audio', 'fade', 'custom'] }, start: { type: ['string', 'number'] }, end: { type: ['string', 'number'] }, duration: { type: ['string', 'number'] }, width: { type: 'integer' }, height: { type: 'integer' }, scale: { type: 'number' }, speed: { type: 'number' }, volume: { type: 'number' }, fps: { type: 'number' }, format: { type: 'string' }, text: { type: 'string' }, font_size: { type: 'integer' }, position: { type: 'string', enum: ['top', 'center', 'bottom'] }, color: { type: 'string' }, crop: { type: 'string' }, rotate: { type: 'integer' }, mute: { type: 'boolean' }, fade_in: { type: 'number' }, fade_out: { type: 'number' }, quality: { type: 'integer' }, bitrate: { type: 'string' }, extra_args: { type: 'array', items: { type: 'string' } } }, required: ['input', 'operation'] } } },
    { type: 'function', function: { name: 'media_concat', description: 'Join several video (or audio) files into one, in order. Fast copy when formats match, otherwise re-encodes to 1280x720.', parameters: { type: 'object', properties: { inputs: { type: 'array', items: { type: 'string' } }, output: { type: 'string' }, reencode: { type: 'boolean' } }, required: ['inputs', 'output'] } } },
    { type: 'function', function: { name: 'media_from_images', description: 'Make a slideshow video from images (list or folder) with fades and optional background audio.', parameters: { type: 'object', properties: { images: { type: 'array', items: { type: 'string' } }, folder: { type: 'string' }, output: { type: 'string' }, seconds_per_image: { type: 'number' }, audio: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' }, fade: { type: 'number' } }, required: ['output'] } } },
    { type: 'function', function: { name: 'media_subtitles', description: 'Add subtitles from an .srt file to a video: burn=true renders them into the picture, burn=false embeds a soft subtitle track (mp4).', parameters: { type: 'object', properties: { input: { type: 'string' }, srt: { type: 'string' }, output: { type: 'string' }, burn: { type: 'boolean' }, font_size: { type: 'integer' } }, required: ['input', 'srt'] } } },
  ];
  return { impl, SCHEMAS };
}

module.exports = { makeTools, findFfmpeg };
