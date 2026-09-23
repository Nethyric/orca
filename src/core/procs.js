'use strict';
// Long-running processes started by the agent (bots, dev servers, watchers, workers).
// run_shell kills anything that outlives its timeout; these survive across turns, keep a rolling log,
// expose the TCP ports they open (so the Preview panel can show a dev server), can be stopped from the
// UI, and are all killed when ORCA exits. Nothing here survives an app restart on purpose.
const net = require('net');

const MAX_LOG = 96 * 1024;   // bytes kept per process
const MAX_DONE = 20;         // finished entries kept for post-mortem reads

function makeProcs({ spawn, spawnSpec, childEnv, killTree, WS, isWin }) {
  const procs = new Map();
  let seq = 0;
  let onChange = () => {};

  const summary = (p) => ({ id: p.id, name: p.name, command: p.command, cwd: p.cwd, pid: p.pid, status: p.status, code: p.code, signal: p.signal, startedAt: p.startedAt, exitedAt: p.exitedAt || null, uptimeMs: (p.exitedAt || Date.now()) - p.startedAt, ports: p.ports.slice(), logBytes: p.log.length });
  const notify = (p) => { try { onChange(summary(p)); } catch (_) {} };

  function append(p, chunk) {
    p.log += chunk;
    if (p.log.length > MAX_LOG) p.log = p.log.slice(-MAX_LOG);
    p.lastOutputAt = Date.now();
    // ports mentioned in the output ("http://localhost:3000", "port 8080", ":5000") are verified later
    const re = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]|\bport\s*[:=]?\s*)(?::?)(\d{2,5})\b/gi; let m;
    while ((m = re.exec(chunk))) { const n = +m[1]; if (n >= 80 && n <= 65535 && !p.candidates.includes(n)) p.candidates.push(n); }
    for (const w of p.waiters.splice(0)) w();
  }
  const tail = (p, lines) => { const arr = p.log.split('\n'); return arr.slice(-Math.max(1, lines)).join('\n'); };

  function isOpen(port, timeoutMs = 400) {
    return new Promise((resolve) => {
      const s = net.connect({ port, host: '127.0.0.1' });
      const done = (v) => { try { s.destroy(); } catch (_) {} resolve(v); };
      s.setTimeout(timeoutMs, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false));
    });
  }
  async function refreshPorts(p) {
    if (p.status !== 'running') { p.ports = []; return p.ports; }
    const open = [];
    for (const port of p.candidates.slice(-8)) if (await isOpen(port)) open.push(port);
    if (open.join() !== p.ports.join()) { p.ports = open; notify(p); }
    return p.ports;
  }

  function prune() {
    const done = [...procs.values()].filter((p) => p.status !== 'running').sort((a, b) => a.exitedAt - b.exitedAt);
    while (done.length > MAX_DONE) procs.delete(done.shift().id);
  }

  function start({ name, command, cwd, env = {}, shell }) {
    if (!command || !String(command).trim()) return { error: 'command is required' };
    const running = [...procs.values()].filter((p) => p.status === 'running');
    if (running.length >= 12) return { error: 'too many running processes (12). Stop one with stop_process first.', running: running.map(summary) };
    const dup = running.find((p) => p.command === command && p.cwd === (cwd || WS()));
    if (dup) return { ...summary(dup), note: 'already running with the same command — reusing it (stop_process it first if you need a fresh start)', log_tail: tail(dup, 30) };
    const spec = spawnSpec(String(command), shell);
    const dir = cwd || WS();
    const id = 'p' + (++seq).toString(36) + Date.now().toString(36).slice(-3);
    // Only plain variable names, and never the ones that change how loaders/shells/interpreters
    // behave (LD_PRELOAD, NODE_OPTIONS, BASH_ENV, PATH, …) — those would let the env block alone
    // execute code outside the approval flow.
    const ENV_DENY = /^(LD_|DYLD_|NODE_OPTIONS|BASH_ENV|^ENV$|SHELL|PATH|HOMEPATH|HOME|USER|PYTHONSTARTUP|PYTHONPATH|PERL5OPT|RUBYOPT|ELECTRON_RUN_AS_NODE|SUDO_COMMAND|PROMPT_COMMAND|PS4|IFS|CDPATH|GCONV_PATH|GETCONF_DIR)/i;
    const safeEnv = {}; for (const [k, v] of Object.entries(env || {})) if (/^[A-Z_][A-Z0-9_]*$/i.test(k) && !ENV_DENY.test(k)) safeEnv[k] = String(v);
    let child;
    try { child = spawn(spec.cmd, spec.args, { cwd: dir, windowsHide: true, detached: !isWin, env: { ...childEnv(), ...safeEnv, PYTHONUNBUFFERED: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'], ...spec.opts }); }
    catch (e) { return { error: 'spawn failed: ' + e.message }; }
    const p = { id, name: String(name || command).slice(0, 60), command: String(command), cwd: dir, pid: child.pid, status: 'running', code: null, signal: null, startedAt: Date.now(), exitedAt: 0, lastOutputAt: 0, log: '', candidates: [], ports: [], waiters: [], child };
    // ports named in the command itself (--port 3000, -p 8080, PORT=5000, http.server 8000) are candidates too
    for (const m of String(command).matchAll(/(?:--?port(?:=|\s+)|-p\s*|PORT=|http\.server\s+|:)(\d{4,5})\b/gi)) { const n = +m[1]; if (n >= 1024 && n <= 65535 && !p.candidates.includes(n)) p.candidates.push(n); }
    procs.set(id, p);
    child.stdout.on('data', (d) => append(p, d.toString('utf8')));
    child.stderr.on('data', (d) => append(p, d.toString('utf8')));
    child.on('error', (e) => { append(p, `\n[spawn error] ${e.message}\n`); });
    child.on('close', (code, signal) => { p.status = code === 0 ? 'exited' : (signal || p.stopping ? 'stopped' : 'failed'); p.code = code; p.signal = signal || null; p.exitedAt = Date.now(); p.ports = []; for (const w of p.waiters.splice(0)) w(); notify(p); prune(); });
    notify(p);
    return { ...summary(p), note: 'started in the background. Call process_output (wait_ms 3000-8000) to read its first log lines and see whether it stays up; stop_process to end it.' };
  }

  // Read the log tail. wait_ms: block until new output, a port opens, or the process exits (max 20 s) — the normal
  // way to check a freshly started server or bot without polling.
  async function output({ id, tail: n = 60, wait_ms = 0, wait_for_port = false }) {
    const p = procs.get(id); if (!p) return { error: 'unknown process ' + id, running: list().filter((x) => x.status === 'running') };
    const deadline = Date.now() + Math.min(Math.max(+wait_ms || 0, 0), 20000);
    const mark = p.log.length;
    while (Date.now() < deadline && p.status === 'running') {
      await refreshPorts(p);
      if (wait_for_port ? p.ports.length : (p.log.length !== mark && !wait_for_port)) break;
      const left = deadline - Date.now(); if (left <= 0) break;
      await new Promise((r) => { const t = setTimeout(r, Math.min(left, 700)); p.waiters.push(() => { clearTimeout(t); r(); }); });
      if (!wait_for_port && p.log.length !== mark) { await new Promise((r) => setTimeout(r, 400)); break; } // let the burst finish
    }
    await refreshPorts(p);
    const out = { ...summary(p), log_tail: tail(p, n) || '(no output yet)' };
    if (p.status === 'stopped') out.note = 'stopped on request.';
    else if (p.status !== 'running') out.note = `process ended with exit code ${p.code}${p.signal ? ' (' + p.signal + ')' : ''}. ${p.code ? 'Read the log above, fix the cause, then start it again.' : ''}`.trim();
    else if (!p.log.trim()) out.note = 'running, silent so far (buffered output? set PYTHONUNBUFFERED=1 / print(flush=True), or the program simply logs nothing on start).';
    if (p.ports.length) out.preview = p.ports.map((x) => `http://localhost:${x}`);
    return out;
  }
  function stop({ id }) {
    const p = procs.get(id); if (!p) return { error: 'unknown process ' + id };
    if (p.status !== 'running') return { ...summary(p), note: 'already ended' };
    p.stopping = true; killTree(p.child);
    return { ...summary(p), note: 'stop signal sent' };
  }
  function list() { return [...procs.values()].sort((a, b) => b.startedAt - a.startedAt).map(summary); }
  function get(id) { const p = procs.get(id); return p ? { ...summary(p), log: p.log } : null; }
  function killAll() { for (const p of procs.values()) if (p.status === 'running') { p.stopping = true; try { killTree(p.child); } catch (_) {} } }
  function setOnChange(fn) { onChange = typeof fn === 'function' ? fn : () => {}; }
  // The ports of a running process may open a while after its last log line: poll lazily from the UI route.
  async function refreshAll() { for (const p of procs.values()) if (p.status === 'running') await refreshPorts(p); return list(); }

  process.once('exit', killAll);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) { try { process.once(sig, () => { killAll(); setTimeout(() => process.exit(0), 150); }); } catch (_) {} }

  return { start, output, stop, list, get, killAll, setOnChange, refreshAll };
}

module.exports = { makeProcs };
