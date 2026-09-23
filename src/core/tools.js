'use strict';
// Real tool implementations. Everything runs on the user's machine inside the workspace.
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync, spawn } = require('child_process');
const config = require('./config');
const mcp = require('./mcp');

const isWin = process.platform === 'win32';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function WS() { return config.workspaceDir(); }
function safe(p) {
  const root = path.resolve(WS());
  const full = path.resolve(root, p || '.');
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('path escapes workspace: ' + p);
  // Symlink escape: a link inside the workspace may point anywhere, so the *real* path must stay
  // inside the real workspace root too (checked on the deepest existing ancestor for new files).
  try {
    const rootReal = fs.realpathSync(root);
    let cur = full; const rest = [];
    while (!fs.existsSync(cur)) { const b = path.basename(cur); if (!b) break; rest.unshift(b); cur = path.dirname(cur); }
    const real = path.join(fs.realpathSync(cur), ...rest);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new Error('path escapes workspace: ' + p);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return full;
}
const rel = (f) => path.relative(path.resolve(WS()), f).replace(/\\/g, '/') || '.';
// change-context (dsh-code-index style): which test files reference the file being changed?
const CODE_EXT = /\.(js|mjs|cjs|ts|tsx|py|go|rs|java)$/i;
function likelyTests(relP) {
  const base = path.basename(relP).replace(/\.[^.]+$/, '').toLowerCase();
  if (!base || base.length < 3 || /test|spec|fixture|mock|util|helper/.test(base)) return [];
  const root = WS(); const hits = []; let scanned = 0;
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'coverage', '.cache', 'target', 'out']);
  (function rec(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (skip.has(e.name) || scanned > 30 || hits.length >= 3) continue;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^(node_modules|dist|build)$/.test(e.name)) rec(fp); continue; }
      const isTestName = /(^|[./_-])(test|spec)s?\./i.test(e.name) || /^(test|tests|__tests__|spec|specs)$/i.test(path.basename(d));
      if (!isTestName || !CODE_EXT.test(e.name)) continue;
      let st; try { st = fs.statSync(fp); } catch (_) { continue; }
      if (st.size > 200000) continue;
      scanned++;
      let txt; try { txt = fs.readFileSync(fp, 'utf8'); } catch (_) { continue; }
      if (txt.toLowerCase().includes(base)) hits.push(path.relative(root, fp).replace(/\\/g, '/'));
    }
  })(root);
  return hits;
}
const strip = (x) => String(x || '').replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/\s+/g, ' ').trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- SSRF guard: agent tools must not reach loopback / link-local / private networks ----
const net = require('net');
const dns = require('dns');
function badIp(ip) {
  if (net.isIPv4(ip)) {
    const a = ip.split('.').map(Number);
    return a[0] === 127 || a[0] === 10 || a[0] === 0 || (a[0] === 169 && a[1] === 254) || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168) || (a[0] >= 224 && a[0] <= 247);
  }
  if (net.isIPv6(ip)) { const l = ip.toLowerCase(); return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:'); }
  return true;
}
async function assertExternalUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) URLs are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : await dns.promises.resolve(host).catch(() => []);
  if (!ips.length) return u; // let fetch produce the DNS error
  if (ips.some(badIp)) throw new Error('refused: internal/loopback address is not reachable from agent tools');
  return u;
}
async function fetchText(url, opts = {}, timeoutMs = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let cur = String(url);
    // follow redirects manually so every hop passes the SSRF check
    for (let hop = 0; hop < 6; hop++) {
      await assertExternalUrl(cur);
      const r = await fetch(cur, { ...opts, redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9,fa;q=0.8', ...(opts.headers || {}) }, signal: ctl.signal });
      if ([301, 302, 303, 307, 308].includes(r.status)) { const loc = r.headers.get('location'); if (!loc) return { status: r.status, text: '', ct: '' }; cur = new URL(loc, cur).href; continue; }
      return { status: r.status, text: await r.text(), ct: r.headers.get('content-type') || '' };
    }
    return { status: 310, text: 'too many redirects', ct: '' };
  } finally { clearTimeout(t); }
}

// ---------- shell ----------
// Windows: cmd.exe by default (models write `a && b`, `dir`, `type` …), PowerShell when the command
// looks like PowerShell or shell:'powershell' is requested. Both forced to UTF-8 output.
// If Node.js is not installed on the machine, a `node` shim pointing at the app's own runtime is
// put on PATH so `node script.js` always works.
let shimDir = null;
function ensureNodeShim() {
  if (shimDir !== null) return shimDir;
  shimDir = '';
  try {
    execSync(isWin ? 'where node' : 'command -v node', { stdio: 'ignore', windowsHide: true, shell: isWin ? 'cmd.exe' : '/bin/sh' });
  } catch (_) {
    if (!process.versions.electron) return shimDir;
    const dir = path.join(config.getDataDir(), 'bin');
    fs.mkdirSync(dir, { recursive: true });
    if (isWin) fs.writeFileSync(path.join(dir, 'node.cmd'), `@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${process.execPath}" %*\r\n`);
    else { const f = path.join(dir, 'node'); fs.writeFileSync(f, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`); fs.chmodSync(f, 0o755); }
    shimDir = dir;
  }
  return shimDir;
}
function childEnv() {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' };
  delete env.ELECTRON_RUN_AS_NODE;
  const shim = ensureNodeShim();
  if (shim) env.PATH = shim + path.delimiter + (env.PATH || env.Path || '');
  return env;
}
const PS_HINT = /(^|[\s;|(])(Get-|Set-|New-|Remove-|Invoke-|Write-Host|Write-Output|Select-Object|Where-Object|ForEach-Object|Start-Process|Test-Path|Out-File|Get-ChildItem|Measure-Object|Format-Table|Import-|Export-|\$env:|\$_|\$PSVersionTable|-Recurse\b|-ErrorAction)/;
function spawnSpec(command, shellPref) {
  if (!isWin) return { cmd: '/bin/bash', args: ['-lc', command], opts: {} };
  const usePS = shellPref === 'powershell' || (shellPref !== 'cmd' && PS_HINT.test(command));
  if (usePS) {
    const script = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; ' + command;
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], opts: {} };
  }
  return { cmd: 'cmd.exe', args: ['/d', '/s', '/c', `"chcp 65001>nul & ${command}"`], opts: { windowsVerbatimArguments: true } };
}
function killTree(child) {
  try { if (isWin) execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore', windowsHide: true }); else process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (__) {} }
}
// Terminal noise costs context and confuses models: drop ANSI colour codes, keep only the final
// state of \r-progress lines (npm/pip/curl bars), collapse runs of identical lines, cap the size.
function quiet(out) {
  let t = String(out || '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  t = t.split('\n').map((l) => { const i = l.lastIndexOf('\r'); return i === -1 ? l : l.slice(i + 1); }).join('\n');
  const lines = t.split('\n'); const kept = []; let rep = 0;
  for (const l of lines) { if (kept.length && l === kept[kept.length - 1] && l.trim()) { rep++; continue; } if (rep) { kept.push(`… (previous line repeated ${rep} more times)`); rep = 0; } kept.push(l); }
  if (rep) kept.push(`… (previous line repeated ${rep} more times)`);
  t = kept.join('\n').trim();
  if (!t) return '(no output)';
  return t.length > 8000 ? t.slice(0, 2500) + `\n…[${t.length - 8000} chars omitted]…\n` + t.slice(-5500) : t;
}
function runShell({ command, timeout, shell }) {
  timeout = timeout || config.load().shellTimeout || 120;
  const spec = spawnSpec(command, shell);
  return new Promise((resolve) => {
    let out = ''; let done = false;
    const child = spawn(spec.cmd, spec.args, { cwd: WS(), windowsHide: true, detached: !isWin, env: childEnv(), ...spec.opts });
    const timer = setTimeout(() => { if (!done) { done = true; killTree(child); resolve({ exit_code: 124, output: out.slice(-8000) + `\n[timed out after ${timeout}s]` }); } }, timeout * 1000);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); if (out.length > 400000) out = out.slice(-200000); });
    child.stderr.on('data', (d) => { out += d.toString('utf8'); if (out.length > 400000) out = out.slice(-200000); });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ exit_code: 1, output: String(e.message) }); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ exit_code: code ?? 0, output: quiet(out) }); } });
  });
}

let pyCache = null, pyCacheAt = 0;
// "file.js:12\n  foo(\n     ^\n\nSyntaxError: missing ) …" → "line 12: SyntaxError: missing ) …"
function fmtSyntax(msg) {
  const m = msg.match(/:(\d+)\r?\n[\s\S]*?\n\r?\n((?:Syntax|Reference|Type)Error[^\n]*)/) || msg.match(/line (\d+)[\s\S]*?((?:Syntax|Indentation|Tab)Error[^\n]*)/);
  if (m) return `line ${m[1]}: ${m[2].trim()}`;
  const line = msg.split('\n').map((l) => l.trim()).filter((l) => /Error/.test(l))[0];
  return (line || msg.trim().split('\n')[0] || 'syntax error').slice(0, 300);
}

function findPython() {
  if (pyCache !== null && Date.now() - pyCacheAt < (pyCache ? 30 : 5) * 60e3) return pyCache; // re-probe every 30 min (5 min while missing)
  pyCache = '';
  for (const py of isWin ? ['python', 'py -3', 'python3'] : ['python3', 'python']) {
    try { const o = execSync(`${py} --version`, { stdio: 'pipe', windowsHide: true, timeout: 4000, env: childEnv(), shell: isWin ? 'cmd.exe' : '/bin/sh' }).toString(); if (/Python 3/.test(o)) { pyCache = py; break; } } catch (_) {}
  }
  pyCacheAt = Date.now();
  return pyCache || null;
}

const impl = {
  run_shell: runShell,

  async run_python({ code, timeout = 90 }) {
    const py = findPython();
    if (!py) return { error: 'Python is not installed on this machine. Use run_node instead (always available).' };
    const f = path.join(WS(), '.orca_snippet.py');
    fs.writeFileSync(f, code, 'utf8');
    return runShell({ command: `${py} "${f}"`, timeout });
  },

  async run_node({ code, timeout = 90 }) {
    const f = path.join(WS(), '.orca_snippet.js');
    fs.writeFileSync(f, code, 'utf8');
    const node = process.execPath;
    const env = { ...childEnv(), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
    return new Promise((resolve) => {
      let out = ''; let done = false;
      const child = spawn(node, [f], { cwd: WS(), windowsHide: true, env });
      const timer = setTimeout(() => { if (!done) { done = true; killTree(child); resolve({ exit_code: 124, output: out.slice(-8000) + `\n[timed out after ${timeout}s]` }); } }, timeout * 1000);
      child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
      child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ exit_code: 1, output: e.message }); } });
      child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ exit_code: code ?? 0, output: quiet(out) }); } });
    });
  },

  // After every write/edit of a code file run a syntax check and report it with the result. Catches the
  // classic "wrote 200 lines with a missing brace, then ran it 3 times" loop before it starts.
  async _check(f) {
    const ext = path.extname(f).toLowerCase();
    try {
      if (ext === '.json') { try { JSON.parse(fs.readFileSync(f, 'utf8')); return { ok: true }; } catch (e) { return { ok: false, message: e.message.slice(0, 200) }; } }
      if (['.js', '.mjs', '.cjs'].includes(ext)) {
        // Security: execFileSync with an argument array — never through a shell, so a hostile
        // filename ($(...), backticks, quotes) cannot inject commands.
        const env = { ...childEnv(), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
        const opts = { stdio: 'pipe', windowsHide: true, timeout: 10000, env };
        try { execFileSync(process.execPath, ['--check', f], opts); return { ok: true }; }
        catch (e) {
          const msg = String(e.stderr || e.message || '');
          if (ext === '.js' && /import statement outside a module|Unexpected token 'export'|Cannot use import|top-level await/i.test(msg)) { // ES module in a .js file → re-check as module
            try { execFileSync(process.execPath, ['--input-type=module', '--check'], { ...opts, input: fs.readFileSync(f) }); return { ok: true }; } catch (e2) { return { ok: false, message: fmtSyntax(String(e2.stderr || e2.message || '')) }; }
          }
          return { ok: false, message: fmtSyntax(msg) };
        }
      }
      if (ext === '.py') { const py = findPython(); if (!py) return null; try { const [pyBin, ...pyArgs] = py.split(/\s+/); execFileSync(pyBin, [...pyArgs, '-m', 'py_compile', f], { stdio: 'pipe', windowsHide: true, timeout: 10000, env: childEnv() }); return { ok: true }; } catch (e) { return { ok: false, message: fmtSyntax(String(e.stderr || e.message || '')) }; } }
    } catch (_) {}
    return null;
  },

  async write_file({ path: p, content, append = false }) {
    if (!p) return { error: 'path is required' };
    if (content === undefined || content === null) return { error: 'content is missing (your arguments were cut off). Write the file in smaller parts: first call with the first ~150 lines, then further calls with append=true.' };
    const f = safe(p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const existed = fs.existsSync(f);
    const before = existed ? fs.readFileSync(f, 'utf8') : null;
    const after = append && existed ? before + content : content;
    fs.writeFileSync(f, after, 'utf8');
    const check = await impl._check(f); const rt = CODE_EXT.test(f) ? likelyTests(rel(f)) : [];
    return { ok: true, path: rel(f), bytes: Buffer.byteLength(after), lines: after.split('\n').length, created: !existed, appended: !!(append && existed), ...(check ? { syntax: check.ok ? 'ok' : 'ERROR: ' + check.message } : {}), ...(rt.length ? { related_tests: rt, verify: 'run run_tests — these test files reference the changed file' } : {}), _diff: { path: rel(f), before, after } };
  },

  async read_file({ path: p, offset = 0, limit = 400 }) {
    const f = safe(p);
    if (!fs.existsSync(f)) return { error: 'not found: ' + p };
    const st = fs.statSync(f);
    if (st.isDirectory()) return impl.list_files({ path: p });
    if (st.size > 5 * 1024 * 1024) return { error: 'file too large (>5MB)' };
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const slice = lines.slice(offset, offset + limit);
    return { path: p, total_lines: lines.length, offset, content: slice.join('\n').slice(0, 40000) };
  },

  // apply one anchored replacement (exact, or whitespace-fuzzy line-based) to a text
  applyOne(text, o, n, all, mode) {
    if (mode === 'fuzzy') {
      const norm = (x) => x.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
      const nt = norm(text), no = norm(o);
      const startLine = nt.slice(0, nt.indexOf(no)).split('\n').length - 1;
      const nLines = no.split('\n').length;
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      return [...lines.slice(0, startLine), ...String(n).replace(/\r\n/g, '\n').split('\n'), ...lines.slice(startLine + nLines)].join('\n');
    }
    return all ? text.split(o).join(n) : text.replace(o, () => n);
  },

  async edit_file({ path: p, old, new: nw, all = false, edits }) {
    const f = safe(p);
    if (!fs.existsSync(f)) return { error: 'not found: ' + p };
    if (Array.isArray(edits)) {
      // atomic multi-edit: validate EVERY anchor against the rolling text first, then apply all-or-nothing
      const before = fs.readFileSync(f, 'utf8');
      let roll = before; const prep = [];
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i] || {}; const o = String(e.old ?? ''); const n = String(e.new ?? '');
        if (!o) return { error: `edits[${i}]: "old" is required — nothing was applied (atomic)`, applied: 0 };
        let mode = 'exact';
        if (!roll.includes(o)) {
          const norm = (x) => x.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
          const nt = norm(roll), no = norm(o);
          if (!no || !nt.includes(no)) return { error: `edits[${i}]: old text not found — nothing was applied (atomic). Read the file and copy the exact text.`, applied: 0 };
          const first = nt.indexOf(no);
          if (!e.all && nt.indexOf(no, first + no.length) !== -1) return { error: `edits[${i}]: matches multiple times — set all:true on that edit or add surrounding context. Nothing was applied (atomic).`, applied: 0 };
          mode = 'fuzzy';
        }
        prep.push({ o, n, all: !!e.all, mode });
        roll = impl.applyOne(roll, o, n, !!e.all, mode);
      }
      let after = before; let replaced = 0;
      for (const q of prep) { const c = after.split(q.o).length - 1; after = impl.applyOne(after, q.o, q.n, q.all, q.mode); replaced += q.mode === 'fuzzy' ? 1 : (q.all ? c : 1); }
      fs.writeFileSync(f, after, 'utf8');
      const check = await impl._check(f); const rt = CODE_EXT.test(f) ? likelyTests(rel(f)) : [];
      return { ok: true, path: rel(f), edits: prep.length, replaced, atomic: true, ...(check ? { syntax: check.ok ? 'ok' : 'ERROR: ' + check.message } : {}), ...(rt.length ? { related_tests: rt, verify: 'run run_tests — these test files reference the changed file' } : {}), _diff: { path: rel(f), before, after } };
    }
    const t = fs.readFileSync(f, 'utf8');
    if (!t.includes(old)) {
      // fuzzy layer 1: ignore CRLF + trailing whitespace; apply a unique match line-based
      const norm = (x) => x.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
      const nt = norm(t), no = norm(old);
      if (no && nt.includes(no)) {
        const first = nt.indexOf(no), second = nt.indexOf(no, first + no.length);
        if (second !== -1) return { error: 'old text matches multiple times after whitespace normalization. Set all=true or add surrounding context.' };
        if (!all) {
          const startLine = nt.slice(0, first).split('\n').length - 1;
          const nLines = no.split('\n').length;
          const lines = t.replace(/\r\n/g, '\n').split('\n');
          const after = [...lines.slice(0, startLine), ...String(nw).replace(/\r\n/g, '\n').split('\n'), ...lines.slice(startLine + nLines)].join('\n');
          fs.writeFileSync(f, after, 'utf8');
          const check = await impl._check(f); const rt = CODE_EXT.test(f) ? likelyTests(rel(f)) : [];
          return { ok: true, path: rel(f), replaced: 1, fuzzy: 'whitespace-insensitive match (CRLF/trailing spaces ignored)', ...(check ? { syntax: check.ok ? 'ok' : 'ERROR: ' + check.message } : {}), ...(rt.length ? { related_tests: rt, verify: 'run run_tests — these test files reference the changed file' } : {}), _diff: { path: rel(f), before: t, after } };
        }
      }
      // fuzzy layer 2: fully trimmed match → indentation differs
      const trimN = (x) => x.split('\n').map((l) => l.trim()).join('\n');
      if (trimN(t).includes(trimN(old))) return { error: 'old text differs in whitespace/indentation. Copy the exact text including indentation.' };
      // closest-line hint so the model repairs its anchor fast
      const want = String(old).split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
      const lines = t.split('\n');
      let best = -1, bestScore = 0;
      if (want.length >= 8) for (let i = 0; i < lines.length; i++) { const l = lines[i].trim(); if (!l) continue; let sc = 0; for (let k = 0; k < Math.min(l.length, want.length); k++) { if (l[k] === want[k]) sc++; else break; } if (sc > bestScore) { bestScore = sc; best = i; } }
      return { error: 'old text not found in file.' + (best >= 0 && bestScore >= 8 ? ` Closest line ${best + 1}: ${lines[best].trim().slice(0, 120)}` : '') + ' Read the file again and copy the exact text.' };
    }
    const count = t.split(old).length - 1;
    const after = all ? t.split(old).join(nw) : t.replace(old, () => nw);
    fs.writeFileSync(f, after, 'utf8');
    const check = await impl._check(f); const rt = CODE_EXT.test(f) ? likelyTests(rel(f)) : [];
    return { ok: true, path: rel(f), replaced: all ? count : 1, remaining_occurrences: all ? 0 : count - 1, ...(check ? { syntax: check.ok ? 'ok' : 'ERROR: ' + check.message } : {}), ...(rt.length ? { related_tests: rt, verify: 'run run_tests — these test files reference the changed file' } : {}), _diff: { path: rel(f), before: t, after } };
  },

  async delete_file({ path: p }) {
    const f = safe(p);
    if (!fs.existsSync(f)) return { error: 'not found' };
    const st = fs.statSync(f);
    const before = st.isFile() ? fs.readFileSync(f, 'utf8') : null;
    fs.rmSync(f, { recursive: true, force: true });
    return { ok: true, deleted: rel(f), _diff: st.isFile() ? { path: rel(f), before, after: null } : undefined };
  },

  async list_files({ path: p = '.', depth = 4 }) {
    const root = safe(p);
    if (!fs.existsSync(root)) return { error: 'not found' };
    const out = [];
    const skip = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache']);
    (function walk(d, lvl) {
      if (out.length > 400 || lvl > depth) return;
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const e of ents) {
        if (skip.has(e.name) || e.name.startsWith('.orca_')) continue;
        const fp = path.join(d, e.name);
        const rel = path.relative(WS(), fp).replace(/\\/g, '/');
        if (e.isDirectory()) { out.push(rel + '/'); walk(fp, lvl + 1); }
        else { let size = 0; try { size = fs.statSync(fp).size; } catch (_) {} out.push(`${rel} (${size}B)`); }
      }
    })(root, 0);
    return { workspace: WS(), entries: out.slice(0, 400), truncated: out.length > 400 };
  },

  async search_files({ pattern, path: p = '.', glob = '', max_results = 60 }) {
    const root = safe(p);
    let re;
    try { re = new RegExp(pattern, 'i'); } catch (e) { return { error: 'bad regex: ' + e.message }; }
    const globRe = glob ? new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§§').replace(/\*/g, '[^/]*').replace(/§§/g, '.*') + '$') : null;
    const hits = [];
    const skip = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build']);
    (function walk(d) {
      if (hits.length >= max_results) return;
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const e of ents) {
        if (skip.has(e.name)) continue;
        const fp = path.join(d, e.name);
        if (e.isDirectory()) { walk(fp); continue; }
        const rel = path.relative(WS(), fp).replace(/\\/g, '/');
        if (globRe && !globRe.test(rel) && !globRe.test(e.name)) continue;
        let st; try { st = fs.statSync(fp); } catch (_) { continue; }
        if (st.size > 2 * 1024 * 1024) continue;
        let txt; try { txt = fs.readFileSync(fp, 'utf8'); } catch (_) { continue; }
        if (txt.includes('\u0000')) continue;
        const lines = txt.split('\n');
        for (let i = 0; i < lines.length && hits.length < max_results; i++) {
          if (re.test(lines[i])) hits.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 200) });
        }
      }
    })(root);
    return { matches: hits, count: hits.length };
  },

  async web_search({ query, count = 6 }) {
    count = Math.min(Math.max(+count || 6, 1), 10);
    const errors = [];
    if (config.load().braveApiKey) {
      // Official Brave Search API when a key is present — deterministic, not blocked from datacenter IPs.
      try {
        const r = await fetchText('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + count, { headers: { 'x-subscription-token': config.load().braveApiKey, accept: 'application/json' } }, 10000);
        const j = JSON.parse(r.text);
        const web = (j.web && j.web.results) || [];
        if (web.length) return { engine: 'brave-api', results: web.slice(0, count).map((x) => ({ title: x.title, url: x.url, snippet: (x.description || '').slice(0, 320) })) };
        errors.push('brave-api: 0 results');
      } catch (e) { errors.push('brave-api: ' + (e.message || e)); }
    }
    const ddg = async () => {
      let r = await fetchText('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query), {}, 12000).catch(() => null);
      if (!r || r.status !== 200) r = await fetchText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {}, 12000);
      if (r.status === 202 || r.status === 429) throw new Error('ddg ' + r.status);
      const html = r.text.replace(/<tr class=["']result-sponsored["'][\s\S]*?<\/tr>/g, '');
      const results = [];
      const re = /<a[^>]*href=["'](.*?)["'][^>]*class=["']result-link["'][^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(html)) && results.length < count) {
        let url = m[1];
        if (url.includes('uddg=')) url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
        const title = strip(m[2]);
        if (!title || url.includes('duckduckgo.com')) continue;
        results.push({ title, url });
      }
      const sn = [...html.matchAll(/class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/g)].map((x) => strip(x[1]));
      results.forEach((x, i) => { if (sn[i]) x.snippet = sn[i].slice(0, 320); });
      if (!results.length) throw new Error('ddg: 0 results');
      return { engine: 'duckduckgo', results };
    };
    const bing = async () => {
      const r = await fetchText('https://www.bing.com/search?setlang=en&q=' + encodeURIComponent(query), {}, 12000);
      const results = [];
      const re = /<li class=["']b_algo["'][\s\S]*?<h2>[\s\S]*?<a[^>]*href=["'](.*?)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>([\s\S]*?)<\/li>/g;
      let m;
      while ((m = re.exec(r.text)) && results.length < count) { if (!/^https?:/.test(m[1])) continue; results.push({ title: strip(m[2]), url: m[1], snippet: strip(m[3]).slice(0, 320) }); }
      if (!results.length) throw new Error('bing: 0 results (' + r.status + ')');
      return { engine: 'bing', results };
    };
    const brave = async () => {
      const r = await fetchText('https://search.brave.com/search?source=web&q=' + encodeURIComponent(query), {}, 12000);
      const results = [];
      const re = /<a[^>]*href=["'](https?:\/\/(?!search\.brave)[^"']+)["'][^>]*class=["'][^"']*\bresult-header\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(r.text)) && results.length < count) results.push({ title: strip(m[2]), url: m[1] });
      if (!results.length) throw new Error('brave: 0 results (' + r.status + ')');
      return { engine: 'brave', results };
    };
    const wiki = async () => {
      const r = await fetchText('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=' + count + '&srsearch=' + encodeURIComponent(query), {}, 10000);
      const j = JSON.parse(r.text);
      const results = (j.query?.search || []).map((x) => ({ title: x.title, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')), snippet: strip(x.snippet) }));
      if (!results.length) throw new Error('wiki: 0 results');
      return { engine: 'wikipedia', results, note: 'general engines unavailable; wikipedia only' };
    };
    // Race the general engines in priority order: DDG is preferred, but Bing/Brave start at the same time
    // so a slow or rate-limited DDG costs nothing. Wikipedia only if all general engines fail.
    const attempt = (fn) => fn().then((v) => ({ ok: true, v }), (e) => { errors.push(String(e.message || e)); return { ok: false }; });
    const ps = [attempt(ddg), attempt(bing), attempt(brave)];
    const settled = new Array(ps.length);
    // resolve as soon as the highest-priority engine that succeeds is known
    const winner = await new Promise((resolve) => {
      let remaining = ps.length;
      ps.forEach((pr, i) => pr.then((r) => {
        settled[i] = r; remaining--;
        for (let k = 0; k < ps.length; k++) { if (settled[k] === undefined) break; if (settled[k].ok) return resolve(settled[k].v); }
        if (remaining === 0) resolve(null);
      }));
    });
    if (winner) { if (judge.enabled()) { try { winner.results = await judge.rerank(query, winner.results); winner.reranked = true; } catch (_) {} } return { ...winner, query }; }
    const w = await attempt(wiki);
    if (w.ok) return { ...w.v, query };
    return { error: 'all search engines failed', details: errors };
  },

  async fetch_page({ url, max_chars = 16000 }) {
    try {
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const r = await fetchText(url, {}, 30000);
      if (/json/.test(r.ct)) return { url, status: r.status, untrusted: true, text: r.text.slice(0, max_chars) };
      let html = r.text;
      const title = strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
      html = html.replace(/<(script|style|noscript|svg|nav|footer|header|iframe|form)[\s\S]*?<\/\1>/gi, ' ');
      const main = (html.match(/<(article|main)[\s\S]*?<\/\1>/i) || [])[0];
      let body = main && strip(main).length > 800 ? main : html;
      body = body.replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n' + '#'.repeat(+n) + ' ').replace(/<li[^>]*>/gi, '\n• ').replace(/<(br|p|div|tr|section|article|blockquote|pre)[^>]*>/gi, '\n').replace(/<\/(td|th)>/gi, ' | ');
      const text = body.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      const links = [...html.matchAll(/<a[^>]*href=["'](https?:\/\/[^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ text: strip(m[2]).slice(0, 60), url: m[1] })).filter((l) => l.text).slice(0, 25);
      return { url, status: r.status, untrusted: true, title, text: text.slice(0, max_chars), truncated: text.length > max_chars, links };
    } catch (e) { return { error: String(e.message || e) }; }
  },

  async http_request({ url, method = 'GET', headers = {}, body }) {
    try {
      await assertExternalUrl(url);
      const r = await fetch(url, { method, redirect: 'manual', headers: { 'user-agent': UA, ...headers }, body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
      const text = await r.text();
      return { status: r.status, untrusted: true, headers: Object.fromEntries([...r.headers.entries()].slice(0, 20)), body: text.slice(0, 20000) };
    } catch (e) { return { error: e.message }; }
  },

  async remember({ note }) {
    const f = path.join(config.getDataDir(), 'memory.md');
    const line = `- [${new Date().toISOString().slice(0, 10)}] ${String(note).trim()}\n`;
    fs.appendFileSync(f, line);
    return { ok: true, saved: note };
  },

  async recall({ query = '' }) {
    const f = path.join(config.getDataDir(), 'memory.md');
    if (!fs.existsSync(f)) return { notes: [] };
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const terms = String(query || '').toLowerCase().split(/[\s,;،]+/).filter((t) => t.length > 1);
    // any-term match; if nothing matches, return the most recent notes so the model still sees memory
    const hits = terms.length ? lines.filter((l) => terms.some((t) => l.toLowerCase().includes(t))) : lines;
    return { notes: (hits.length ? hits : lines).slice(-50), matched: hits.length, total: lines.length };
  },

  async ask_user({ question, options = [] }) {
    // Handled specially by the agent loop (pauses the run); this is a fallback.
    return { note: 'question delivered to user', question, options };
  },

  // ---- background processes (bots, dev servers, workers): survive across turns, stoppable from the UI ----
  async start_process({ name, command, cwd, env, shell }) { return procs.start({ name, command, cwd: cwd ? safe(cwd) : undefined, env, shell }); },
  async process_output({ id, tail, wait_ms, wait_for_port }) { return procs.output({ id, tail, wait_ms, wait_for_port }); },
  async stop_process({ id }) { return procs.stop({ id }); },
  async list_processes() { return { processes: await procs.refreshAll() }; },
};
const procs = require('./procs').makeProcs({ spawn, spawnSpec, childEnv, killTree, WS, isWin });

// Office & media tools (Word/Excel/PowerPoint/PDF + ffmpeg video/audio editing)
const judge = require('./judge');
const office = require('./office').makeTools({ safe, rel, WS });
Object.assign(impl, office.impl);
const extras = require('./extras').makeTools({ safe, rel, WS });
Object.assign(impl, extras.impl);

const SCHEMAS = [
  { type: 'function', function: { name: 'run_shell', description: 'Run a shell command inside the workspace folder (cwd). Windows: cmd.exe by default (supports && and ||), PowerShell auto-detected or via shell:"powershell". Linux/macOS: bash. `node` is always available. Use for installing packages, git, running programs, system info.', parameters: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'integer', description: 'seconds, default 90' }, shell: { type: 'string', enum: ['auto', 'cmd', 'powershell'], description: 'Windows only' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'run_node', description: 'Execute a JavaScript (Node.js) snippet and return stdout. Always available, no install needed. Best for math, data processing, quick logic.', parameters: { type: 'object', properties: { code: { type: 'string' }, timeout: { type: 'integer' } }, required: ['code'] } } },
  { type: 'function', function: { name: 'run_python', description: 'Execute a Python 3 snippet and return stdout. Only if Python is installed; otherwise prefer run_node.', parameters: { type: 'object', properties: { code: { type: 'string' }, timeout: { type: 'integer' } }, required: ['code'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file in the workspace with full content. Parent folders are created automatically. HARD LIMIT: keep each call under ~5000 characters (≈100 lines of code, ≈50 lines of prose) — for bigger files write the first part, then continue with append=true in further calls, or split the code into several small modules.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean', description: 'true = append content to the end of the existing file instead of overwriting' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a workspace file (optionally a line range).', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', description: 'start line (0-based)' }, limit: { type: 'integer', description: 'max lines, default 400' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'edit_file', description: 'Precise edit: replace the exact text `old` with `new` in a file. `old` must match exactly (including indentation); whitespace-only drift (CRLF/trailing spaces) is tolerated. Set all=true to replace every occurrence. For several anchors in ONE file pass edits:[{old,new,all?}] instead of old/new — atomic: all anchors are validated before anything is written, so a bad anchor leaves the file untouched.', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' }, all: { type: 'boolean' }, edits: { type: 'array', description: 'atomic multi-edit for one file', items: { type: 'object', properties: { old: { type: 'string' }, new: { type: 'string' }, all: { type: 'boolean' } }, required: ['old', 'new'] } } }, required: ['path'] } } },
  { type: 'function', function: { name: 'delete_file', description: 'Delete a file or folder in the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'list_files', description: 'List files and folders in the workspace (recursive tree).', parameters: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'integer' } } } } },
  { type: 'function', function: { name: 'search_files', description: 'Grep: search file contents in the workspace with a regex. Returns file, line number and matching text.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string', description: 'e.g. *.js or src/**/*.py' }, max_results: { type: 'integer' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Search the live web. Returns titles, URLs and snippets. ALWAYS use for current events, prices, versions, news, or any fact you are not certain about. Then use fetch_page to read the best results.', parameters: { type: 'object', properties: { query: { type: 'string' }, count: { type: 'integer' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'fetch_page', description: 'Download a web page and return its readable text plus links. Use after web_search to read a result in full.', parameters: { type: 'object', properties: { url: { type: 'string' }, max_chars: { type: 'integer' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'http_request', description: 'Make a raw HTTP request (any method, headers, JSON body). Use for APIs.', parameters: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' }, headers: { type: 'object' }, body: {} }, required: ['url'] } } },
  { type: 'function', function: { name: 'remember', description: 'Save a durable note about the user or project to long-term memory (persists across conversations). Use for preferences, facts, decisions.', parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } } },
  { type: 'function', function: { name: 'recall', description: 'Search long-term memory notes.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
  { type: 'function', function: { name: 'ask_user', description: 'Pause and ask the user a clarifying question when the request is genuinely ambiguous. Provide 2-4 short options when possible. The run stops until they answer.', parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question'] } } },
  { type: 'function', function: { name: 'start_process', description: 'Start a LONG-RUNNING program in the background and keep it alive across turns: Telegram/Discord bots, dev servers (npm run dev, python -m http.server, uvicorn, flask), watchers, workers. run_shell would kill it at its timeout — use this instead for anything that must keep running. Returns an id; then call process_output (wait_ms 3000-8000) to read its first log lines and confirm it stays up. Detected TCP ports appear as preview URLs and in the Processes panel; the user can stop it there. Not for one-shot commands.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'short label shown to the user, e.g. "Telegram bot", "Dev server"' }, command: { type: 'string' }, cwd: { type: 'string', description: 'workspace-relative folder (default: workspace root)' }, env: { type: 'object', description: 'extra environment variables, e.g. {"PORT":"3000"} — put secrets in a .env file instead when the program supports it' }, shell: { type: 'string', enum: ['auto', 'cmd', 'powershell'], description: 'Windows only' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'process_output', description: 'Read the latest log lines of a background process (started with start_process) and its status/ports. wait_ms (max 20000) blocks until new output, an open port, or exit — use it right after starting something to catch crashes and confirm it is up.', parameters: { type: 'object', properties: { id: { type: 'string' }, tail: { type: 'integer', description: 'lines, default 60' }, wait_ms: { type: 'integer' }, wait_for_port: { type: 'boolean', description: 'wait until the process listens on a TCP port (dev servers)' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'stop_process', description: 'Stop a background process (whole process tree).', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'list_processes', description: 'List background processes started in this session with status, uptime and open ports.', parameters: { type: 'object', properties: {} } } },
];

const DANGEROUS = /(\b(rm\s+(-\w+\s+)*-\w*r\w*f|rm\s+(-\w+\s+)*-\w*f\w*r|rm\s+(-\w+\s+)*-\w*r\w*(\s|$)|Remove-Item[^\n]*-Recurse|del\s+\/[sq]|rmdir\s+\/s|format\s+[a-z]:|mkfs|dd\s+if=|shutdown|reboot|Restart-Computer|Stop-Computer|diskpart|reg\s+delete|git\s+push\s+(-f\b|--force\b)|git\s+reset\s+--hard|git\s+(checkout|restore)\s+(--\s+)?\.(\s|$)|git\s+clean\s+-\w*f|sudo\s+rm|chmod\s+-R\s+777\s+\/|(curl|wget)[^\n|;]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|base64\s+(-d\b|-D\b|--decode)[^\n|]*\|[^\n|]*(ba|z|da)?sh\b|find\s+[^;\n]*(-delete|-exec\b)|shutil\.rmtree|os\.system\s*\(|eval\s*\(\s*(base64|atob|exec)|Invoke-Expression|iex\s+\(|icacls[^\n]*\/grant[^\n]*Everyone|schtasks[^\n]*\/create|regsvr32[^\n]*\/s[^\n]*http|xargs[^\n]*rm\s+-rf)|\|\s*(sudo\s+)?(ba|z|da)?sh\b)/i;
const DANGEROUS_RAW = /(:\(\)\s*\{|>\s*\/(dev\/sd[a-z]?|etc\/(passwd|shadow|sudoers))|mkfs\.\w+|\.\.\/\.\.\/[^\n]*(passwd|shadow))/i;
SCHEMAS.push(...office.SCHEMAS, ...extras.SCHEMAS);

function riskOf(name, args) {
  if (mcp.isMcp(name)) return 'medium'; // unknown third-party tools always worth a confirmation in ask mode
  if (name === 'run_shell' || name === 'start_process') {
    const cmd = String(args.command || '');
    return (DANGEROUS.test(cmd) || DANGEROUS_RAW.test(cmd)) ? 'high' : 'medium';
  }
  if (name === 'stop_process' || name === 'process_output' || name === 'list_processes') return 'none';
  if (name === 'delete_file') return 'medium';
  if (name === 'run_python' || name === 'run_node') return 'low';
  if (name === 'write_file' || name === 'edit_file') return 'low';
  if (/^(write_docx|write_xlsx|write_pptx|media_)/.test(name)) return 'low';
  if (/^(social_download|social_trending|generate_image|generate_video|screenshot|browser_check|project_init|scaffold_site|task)$/.test(name)) return 'low';
  return 'none';
}

async function callTool(name, args) {
  if (mcp.isMcp(name)) return mcp.callTool(name, args); // MCP servers (see core/mcp.js)
  const fn = name.startsWith('_') ? null : impl[name]; // _helpers are not callable by the model
  if (!fn) return { error: `unknown tool ${name}` };
  try { return await fn(args || {}); } catch (e) { return { error: `${e.name}: ${e.message}` }; }
}

module.exports = { callTool, SCHEMAS, allSchemas: () => SCHEMAS.concat(mcp.schemas()), riskOf, TOOL_NAMES: Object.keys(impl).filter((n) => !n.startsWith('_')), findPython, extras, procs };
