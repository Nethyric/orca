'use strict';
// Minimal, dependency-free ZIP extractor used by the self-updater (Windows/macOS packages).
// Supports: stored + deflate entries, ZIP64 archives, directory entries, Unix modes and symlinks
// (electron-builder's macOS zips contain framework symlinks), UTF-8 names. Rejects paths that would
// escape the destination. Large entries are streamed, never buffered in memory.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const SIG_EOCD = 0x06054b50, SIG_EOCD64_LOC = 0x07064b50, SIG_EOCD64 = 0x06064b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;

function readAt(fd, pos, len) { const b = Buffer.alloc(len); let off = 0; while (off < len) { const n = fs.readSync(fd, b, off, len - off, pos + off); if (!n) break; off += n; } return b.subarray(0, off); }

// Central directory → [{ name, method, csize, usize, offset, mode, isDir, isSymlink, mtime }]
function readEntries(zipPath) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557 + 20);
    const tail = readAt(fd, size - tailLen, tailLen);
    let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === SIG_EOCD) { e = i; break; }
    if (e < 0) throw new Error('not a zip file (no end-of-central-directory record)');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) { // ZIP64
      const l = e - 20;
      if (l >= 0 && tail.readUInt32LE(l) === SIG_EOCD64_LOC) {
        const rec = readAt(fd, Number(tail.readBigUInt64LE(l + 8)), 56);
        if (rec.readUInt32LE(0) !== SIG_EOCD64) throw new Error('bad zip64 record');
        count = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdOff = Number(rec.readBigUInt64LE(48));
      }
    }
    const cd = readAt(fd, cdOff, cdSize);
    const out = []; let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== SIG_CEN) throw new Error('corrupt central directory');
      const madeBy = cd.readUInt16LE(p + 4) >> 8, flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
      const dosTime = cd.readUInt16LE(p + 12), dosDate = cd.readUInt16LE(p + 14);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nLen = cd.readUInt16LE(p + 28), xLen = cd.readUInt16LE(p + 30), cLen = cd.readUInt16LE(p + 32);
      const extAttr = cd.readUInt32LE(p + 38); let offset = cd.readUInt32LE(p + 42);
      const rawName = cd.subarray(p + 46, p + 46 + nLen);
      const name = rawName.toString('utf8'); void flags; // electron-builder always writes UTF-8 names
      const extra = cd.subarray(p + 46 + nLen, p + 46 + nLen + xLen);
      for (let q = 0; q + 4 <= extra.length;) { // zip64 extended information
        const id = extra.readUInt16LE(q), len = extra.readUInt16LE(q + 2); let r = q + 4;
        if (id === 0x0001) { if (usize === 0xFFFFFFFF && r + 8 <= q + 4 + len) { usize = Number(extra.readBigUInt64LE(r)); r += 8; } if (csize === 0xFFFFFFFF && r + 8 <= q + 4 + len) { csize = Number(extra.readBigUInt64LE(r)); r += 8; } if (offset === 0xFFFFFFFF && r + 8 <= q + 4 + len) { offset = Number(extra.readBigUInt64LE(r)); } }
        q += 4 + len;
      }
      const unix = madeBy === 3 || madeBy === 19 || madeBy === 7; // Unix, OS X, Macintosh
      const mode = unix ? (extAttr >>> 16) & 0xFFFF : 0;
      const isDir = name.endsWith('/') || (unix && (mode & 0xF000) === 0x4000) || (!unix && (extAttr & 0x10) !== 0);
      const isSymlink = unix && (mode & 0xF000) === 0xA000;
      const mtime = new Date(1980 + (dosDate >> 9), ((dosDate >> 5) & 15) - 1, dosDate & 31, dosTime >> 11, (dosTime >> 5) & 63, (dosTime & 31) * 2);
      out.push({ name, method, csize, usize, offset, mode: mode & 0o7777, isDir, isSymlink, mtime });
      p += 46 + nLen + xLen + cLen;
    }
    return out;
  } finally { fs.closeSync(fd); }
}

function safeJoin(dest, name) {
  const rel = name.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = rel.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) throw new Error('zip entry escapes destination: ' + name);
  const full = path.join(dest, ...parts);
  const root = path.resolve(dest) + path.sep;
  if (!(path.resolve(full) + path.sep).startsWith(root)) throw new Error('zip entry escapes destination: ' + name);
  return full;
}

// Extract everything under dest. onProgress({ done, total, name }) after each entry. Returns { files, dirs, symlinks, bytes }.
async function extract(zipPath, dest, { onProgress, signal } = {}) {
  const entries = readEntries(zipPath);
  fs.mkdirSync(dest, { recursive: true });
  const fd = fs.openSync(zipPath, 'r');
  const stat = { files: 0, dirs: 0, symlinks: 0, bytes: 0 };
  const links = [];
  try {
    for (let i = 0; i < entries.length; i++) {
      if (signal && signal.aborted) throw new Error('cancelled');
      const en = entries[i];
      const full = safeJoin(dest, en.name);
      if (en.isDir) { fs.mkdirSync(full, { recursive: true }); stat.dirs++; }
      else {
        // local header: name/extra lengths there may differ from the central directory
        const lh = readAt(fd, en.offset, 30);
        if (lh.readUInt32LE(0) !== SIG_LOC) throw new Error('corrupt local header for ' + en.name);
        const start = en.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
        if (en.method !== 0 && en.method !== 8) throw new Error(`unsupported compression method ${en.method} for ${en.name}`);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        if (en.isSymlink) { // target is the entry content (small) — created after files so targets exist
          const raw = readAt(fd, start, en.csize);
          const target = (en.method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
          links.push({ full, target }); stat.symlinks++;
        } else {
          if (en.csize === 0) fs.writeFileSync(full, '', { mode: en.mode ? (en.mode & 0o777) || 0o644 : undefined });
          else {
            const src = fs.createReadStream(zipPath, { start, end: start + en.csize - 1 });
            const out = fs.createWriteStream(full, { mode: en.mode ? (en.mode & 0o777) || 0o644 : undefined });
            if (en.method === 8) await pipeline(src, zlib.createInflateRaw(), out); else await pipeline(src, out);
          }
          const got = fs.statSync(full).size;
          if (got !== en.usize) throw new Error(`size mismatch for ${en.name}: ${got} != ${en.usize}`);
          if (en.mode && process.platform !== 'win32') { try { fs.chmodSync(full, en.mode & 0o777); } catch (_) {} }
          try { fs.utimesSync(full, en.mtime, en.mtime); } catch (_) {}
          stat.files++; stat.bytes += got;
        }
      }
      if (onProgress) onProgress({ done: i + 1, total: entries.length, name: en.name });
    }
    for (const l of links) { try { fs.rmSync(l.full, { force: true }); } catch (_) {} try { fs.symlinkSync(l.target, l.full); } catch (e) { if (process.platform !== 'win32') throw e; fs.writeFileSync(l.full, l.target); } }
  } finally { fs.closeSync(fd); }
  return stat;
}

module.exports = { readEntries, extract };
