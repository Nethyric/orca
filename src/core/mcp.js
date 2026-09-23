'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// MCP — a minimal, dependency-free Model Context Protocol client.
// Transports: stdio (local subprocess) and Streamable HTTP (with a legacy
// HTTP+SSE fallback per the spec's backwards-compatibility guide).
// Design notes (see report/MCP-plan-fa.md): lazy spawn, quiet reconnect with
// backoff, per-tool enable toggles, a compact meta-tool for on-demand
// discovery, untrusted wrapping of every result, manifest fingerprints to
// detect silent redefinition ("rug pulls").
// ─────────────────────────────────────────────────────────────────────────────
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const PROTO = '2025-06-18';
const APP = { name: 'ORCA', version: '0.0.8' };
const conns = new Map();

const cachePath = () => path.join(config.getDataDir(), 'mcp-cache.json');
function cacheLoad() { try { return JSON.parse(fs.readFileSync(cachePath(), 'utf8')); } catch (_) { return {}; } }
function cacheSave(c) { try { fs.writeFileSync(cachePath(), JSON.stringify(c, null, 2)); } catch (_) {} }

const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
const tokEst = (tools) => Math.round(JSON.stringify(tools).length / 3);

class Conn {
  constructor(name, cfg) {
    this.name = name; this.cfg = cfg;
    this.status = 'stopped'; this.error = ''; this.tools = []; this.fingerprint = '';
    this.stderr = []; this.pollution = 0; this.restarts = 0; this._restartWindow = 0;
    this.id = 0; this.pending = new Map(); this._buf = ''; this.child = null; this.sessionId = ''; this._gen = 0;
  }
  log(d) { const s = String(d).trim(); if (!s) return; this.stderr.push(s.slice(0, 400)); if (this.stderr.length > 200) this.stderr.shift(); }
  isHttp() { return !!(this.cfg.url || this.cfg.type === 'http' || this.cfg.type === 'sse'); }

  async ensure() {
    if (this.status === 'running') return;
    if (this._starting) return this._starting;
    this._starting = this._start();
    try { await this._starting; } finally { this._starting = null; }
  }

  async _start() {
    this.status = 'starting'; this._stopping = false; this.error = ''; this._buf = ''; this.pending.forEach((p) => p.reject(new Error('restarting'))); this.pending.clear();
    try {
      if (this.isHttp()) this._httpInit(); else await this._stdioStart();
      const init = await this.request('initialize', { protocolVersion: PROTO, capabilities: {}, clientInfo: APP }, this.cfg.initTimeout || 30000);
      this.serverInfo = init.serverInfo || {}; this.proto = init.protocolVersion || PROTO;
      await this.notify('notifications/initialized', {});
      await this.refreshTools();
      this.status = 'running';
    } catch (e) {
      this.status = 'error'; this.error = this.error || String(e.message || e);
      this._failAll(this.error);
      throw e;
    }
  }

  _stdioStart() {
    return new Promise((resolve, reject) => {
      const cfg = this.cfg;
      // minimal inherited environment + explicit per-server env only (least privilege)
      const env = {};
      for (const k of ['PATH', 'SYSTEMROOT', 'SystemRoot', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SHELL']) if (process.env[k] != null) env[k] = process.env[k];
      for (const [k, v] of Object.entries(cfg.env || {})) env[k] = String(v);
      let child;
      const gen = ++this._gen; // generation guard: exits of a killed child must not poison the next spawn
      try { child = spawn(cfg.command, cfg.args || [], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
      catch (e) { this.status = 'error'; this.error = String(e.message); return reject(e); }
      this.child = child;
      child.on('error', (e) => {
        if (gen !== this._gen) return;
        this.status = 'error';
        this.error = /ENOENT/.test(String(e.code)) ? `command not found: "${cfg.command}" — use an absolute path or add its folder to this server's env PATH` : String(e.message);
        this._failAll(this.error); reject(new Error(this.error));
      });
      child.stderr.on('data', (d) => this.log(d));
      child.stdout.on('data', (d) => this._onStdout(d));
      child.on('exit', (code) => {
        if (this._stopping || gen !== this._gen) return;
        this.status = 'error'; this.error = this.error || `server exited (code ${code}) — see its stderr log`;
        this._failAll(this.error); reject(new Error(this.error));
      });
      resolve();
    });
  }

  _onStdout(d) {
    this._buf += String(d);
    let i;
    while ((i = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, i).trim(); this._buf = this._buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch (_) { this.pollution++; this.log(`[orca] non-JSON on stdout (protocol pollution): ${line.slice(0, 120)}`); continue; }
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id); this.pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || ('MCP error ' + msg.error.code))); else p.resolve(msg.result);
      return;
    }
    if (msg.method) { // server→client request/notification: answer methods we don't implement with a polite error
      if (msg.id != null) this._write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `client method not supported: ${msg.method}` } }));
      else if (msg.method === 'notifications/message') this.log(JSON.stringify(msg.params || {}).slice(0, 300));
    }
  }

  _failAll(err) { this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error(err)); }); this.pending.clear(); }

  _write(line) {
    if (this.isHttp()) throw new Error('write on http transport');
    if (!this.child || this.child.stdin.destroyed) throw new Error('server stdin closed');
    this.child.stdin.write(line + '\n');
  }

  // ── HTTP (Streamable, with legacy SSE fallback) ──
  _httpInit() { this._http = true; }
  async _httpPost(payload, timeout) {
    const cfg = this.cfg;
    const hdrs = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(cfg.headers || {}) };
    if (this.sessionId) hdrs['mcp-session-id'] = this.sessionId;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeout);
    let res;
    try { res = await fetch(this._endpoint || cfg.url, { method: 'POST', headers: hdrs, body: JSON.stringify(payload), signal: ctl.signal }); }
    finally { clearTimeout(timer); }
    const sid = res.headers.get('mcp-session-id'); if (sid) this.sessionId = sid;
    if (!res.ok) {
      if (payload.method === 'initialize' && !this._legacyTried && (res.status === 404 || res.status === 405)) return this._legacySse(payload, timeout);
      throw new Error(`MCP HTTP ${res.status} on ${payload.method}`);
    }
    const ct = String(res.headers.get('content-type') || '');
    if (ct.includes('text/event-stream')) return this._parseSse(await res.text());
    return res.json();
  }
  _parseSse(text) { // collect data: frames; the JSON-RPC response is the last one carrying an id we know
    let out = null;
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      try { const msg = JSON.parse(data); if (msg.id != null || msg.method) out = msg; } catch (_) {}
    }
    if (!out) throw new Error('empty SSE response');
    return out;
  }
  async _legacySse(initPayload, timeout) { // pre-2025-03-26 transport: GET opens SSE, first event gives the POST endpoint
    this._legacyTried = true;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), Math.min(timeout, 15000));
    try {
      const res = await fetch(this.cfg.url, { method: 'GET', headers: { accept: 'text/event-stream', ...(this.cfg.headers || {}) }, signal: ctl.signal });
      if (!res.ok) throw new Error(`MCP HTTP ${res.status} on legacy SSE GET`);
      const text = await res.text();
      const m = text.match(/event:\s*endpoint\s*\ndata:\s*(\S+)/);
      if (!m) throw new Error('legacy SSE: no endpoint event');
      let ep = m[1].trim();
      if (ep.startsWith('/')) ep = new URL(ep, this.cfg.url).toString();
      this._endpoint = ep;
      return this._httpPost(initPayload, timeout);
    } finally { clearTimeout(timer); }
  }

  request(method, params, timeout = 60000) {
    const id = ++this.id;
    const payload = { jsonrpc: '2.0', id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP timeout (${Math.round(timeout / 1000)}s) on ${method}${this.pollution ? ' — note: server wrote non-JSON to stdout, which corrupts stdio transport' : ''}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
    });
    try { if (this.isHttp()) { return this._httpPost(payload, timeout).then((msg) => { this._dispatch(msg); return promise; }); } this._write(JSON.stringify(payload)); }
    catch (e) { this.pending.delete(id); return Promise.reject(e); }
    return promise;
  }
  async notify(method, params) {
    const payload = { jsonrpc: '2.0', method, params };
    if (this.isHttp()) { try { await this._httpPost(payload, 15000); } catch (_) {} } else try { this._write(JSON.stringify(payload)); } catch (_) {}
  }

  async refreshTools() {
    const tools = []; let cursor;
    do {
      const r = await this.request('tools/list', cursor ? { cursor } : {}, 30000);
      for (const t of r.tools || []) tools.push({ name: String(t.name), description: String(t.description || ''), inputSchema: t.inputSchema || { type: 'object', properties: {} } });
      cursor = r.nextCursor;
    } while (cursor);
    this.tools = tools; this.fingerprint = sha(tools);
    const c = cacheLoad(); c[this.name] = { ...(c[this.name] || {}), tools, fingerprint: this.fingerprint, at: Date.now() }; cacheSave(c);
  }

  stop() {
    this._stopping = true; this._failAll('stopped');
    if (this.child) { try { this.child.kill('SIGTERM'); } catch (_) {} const ch = this.child; setTimeout(() => { try { if (ch.exitCode == null) ch.kill('SIGKILL'); } catch (_) {} }, 3000); }
    this.child = null; this.status = 'stopped';
  }

  async call(tool, args, timeout) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.ensure();
        const r = await this.request('tools/call', { name: tool, arguments: args || {} }, timeout || this.cfg.callTimeout || 60000);
        return { ok: !r.isError, text: contentToText(r.content), untrusted: true, source: `mcp:${this.name}/${tool}` };
      } catch (e) {
        lastErr = e;
        const transient = this.status === 'error' || /exit|closed|EPIPE|abort|timeout/i.test(String(e.message));
        if (!transient) break;
        if (Date.now() - this._restartWindow > 60000) { this._restartWindow = Date.now(); this.restarts = 0; }
        if (++this.restarts > 3) break;
        this.stop(); // quiet reconnect: next loop iteration respawns on demand
      }
    }
    return { ok: false, error: `${this.error || (lastErr && lastErr.message) || 'MCP call failed'}`, untrusted: true, source: `mcp:${this.name}/${tool}` };
  }
}

function contentToText(content) {
  const out = [];
  for (const c of content || []) {
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'text') out.push(String(c.text || ''));
    else if (c.type === 'image') out.push(`[image ${c.mimeType || ''} omitted, ${(String(c.data || '').length * 0.75) | 0} bytes]`);
    else if (c.type === 'resource') out.push(typeof c.resource?.text === 'string' ? c.resource.text : `[resource ${c.resource?.uri || ''}]`);
    else if (c.type === 'resource_link') out.push(`[resource ${c.uri || ''} ${c.description || ''}]`);
  }
  return out.join('\n').slice(0, 60000);
}

// ─────────────────────────── manager ───────────────────────────
const defs = () => { const c = config.load(); return (c.mcpServers && typeof c.mcpServers === 'object') ? c.mcpServers : {}; };
const conn = (name) => { if (!conns.has(name)) conns.set(name, new Conn(name, defs()[name] || {})); const k = conns.get(name); k.cfg = defs()[name] || k.cfg; return k; };
const enabled = () => Object.entries(defs()).filter(([, c]) => c && c.enabled !== false);

function cachedTools(name) { const c = cacheLoad()[name]; return c ? c.tools || [] : []; }
function approvedFp(name) { const c = cacheLoad()[name]; return c ? c.approvedFingerprint || '' : ''; }

function serverTools(name) { // tools the model may see from one server (respecting per-tool toggles)
  const cfg = defs()[name]; if (!cfg || cfg.enabled === false) return [];
  const k = conns.get(name);
  const tools = (k && k.tools.length ? k.tools : cachedTools(name));
  const off = cfg.tools || {};
  return tools.filter((t) => off[t.name] !== false);
}

function schemas() {
  const out = [];
  const list = enabled();
  if (!list.length) return out;
  // direct-mode servers contribute their tool schemas (live or cached — no spawn needed)
  for (const [name, cfg] of list) {
    if (cfg.mode === 'compact') continue;
    for (const t of serverTools(name)) out.push({
      type: 'function',
      function: {
        name: `mcp__${name}__${t.name}`,
        description: `[mcp:${name}] ${t.description}`.slice(0, 1500),
        parameters: t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} },
      },
    });
  }
  // the compact meta-tool: on-demand discovery, ~fixed small context cost
  out.push({
    type: 'function',
    function: {
      name: 'mcp',
      description: 'Discover and call tools provided by connected MCP servers. actions: list_servers → names+modes; list_tools(server) → that server\'s tools; tool_schema(server, tool) → full parameter schema; call(server, tool, args) → run the tool. Prefer servers\' direct tools when they are already listed; use this for servers in compact mode.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list_servers', 'list_tools', 'tool_schema', 'call'] },
          server: { type: 'string', description: 'server name (for list_tools/tool_schema/call)' },
          tool: { type: 'string', description: 'tool name (for tool_schema/call)' },
          args: { type: 'object', description: 'arguments object (for call)' },
        },
        required: ['action'],
      },
    },
  });
  return out;
}

async function ensureTools(name) { // connect on demand so compact/never-warmed servers become discoverable
  const k = conn(name);
  if (!serverTools(name).length && defs()[name] && defs()[name].enabled !== false) { try { await k.ensure(); } catch (_) {} }
  return serverTools(name);
}
async function meta(args) {
  const a = args || {};
  if (a.action === 'list_servers') return { result: enabled().map(([n, c]) => `${n} (${c.mode || 'direct'}, ${serverTools(n).length} tools)`).join('\n') || 'no MCP servers configured', untrusted: true, source: 'mcp:meta' };
  if (a.action === 'list_tools') { const t = await ensureTools(a.server || ''); if (!t.length) return { error: `no tools for server "${a.server}" (disabled, unreachable, or unknown)` }; return { result: t.map((x) => `${x.name}: ${x.description.slice(0, 200)}`).join('\n'), untrusted: true, source: `mcp:${a.server}` }; }
  if (a.action === 'tool_schema') { const t = (await ensureTools(a.server || '')).find((x) => x.name === a.tool); return t ? { result: JSON.stringify(t.inputSchema), untrusted: true, source: `mcp:${a.server}` } : { error: `unknown tool ${a.tool} on ${a.server}` }; }
  if (a.action === 'call') return callTool(`mcp__${a.server}__${a.tool}`, a.args || {});
  return { error: 'unknown action' };
}

async function callTool(name, args) {
  if (name === 'mcp') return meta(args);
  if (!name.startsWith('mcp__')) return { error: 'not an mcp tool' };
  const rest = name.slice(5);
  const i = rest.indexOf('__');
  if (i < 0) return { error: `bad mcp tool name ${name}` };
  const server = rest.slice(0, i); const tool = rest.slice(i + 2);
  const cfg = defs()[server];
  if (!cfg || cfg.enabled === false) return { error: `MCP server "${server}" is not enabled` };
  const k = conn(server);
  if (!serverTools(server).some((t) => t.name === tool)) {
    try { await k.ensure(); } catch (_) { return { error: k.error || `cannot start MCP server "${server}"`, untrusted: true, source: `mcp:${server}` }; }
    if (!serverTools(server).some((t) => t.name === tool)) return { error: `tool "${tool}" is disabled or unknown on server "${server}"` };
  }
  return k.call(tool, args);
}

function snapshot() {
  return Object.entries(defs()).map(([name, cfg]) => {
    const k = conns.get(name);
    const live = k && k.tools.length ? k.tools : cachedTools(name);
    const fp = k && k.fingerprint ? k.fingerprint : (cacheLoad()[name] || {}).fingerprint || '';
    return {
      name, type: cfg.url || cfg.type === 'http' || cfg.type === 'sse' ? 'http' : 'stdio',
      command: cfg.command || '', url: cfg.url || '', enabled: cfg.enabled !== false, mode: cfg.mode === 'compact' ? 'compact' : 'direct',
      status: k ? k.status : 'stopped', error: k ? k.error : '', restarts: k ? k.restarts : 0,
      tools: live.map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 400), enabled: (cfg.tools || {})[t.name] !== false, schema: t.inputSchema })),
      tokEst: tokEst(live), fingerprint: fp, changed: !!fp && fp !== approvedFp(name),
      pollution: k ? k.pollution : 0,
    };
  });
}

const logs = (name) => (conns.get(name)?.stderr || []).slice(-120);
const restart = (name) => { conn(name).stop(); return conn(name).ensure().then(() => true).catch(() => false); };
const stop = (name) => { conn(name).stop(); return true; };
const approve = (name) => { const c = cacheLoad(); const fp = (c[name] || {}).fingerprint || conns.get(name)?.fingerprint || ''; if (!fp) return false; c[name] = { ...(c[name] || {}), approvedFingerprint: fp }; cacheSave(c); return true; };
const warm = () => { for (const [name, cfg] of enabled()) { if (cfg.mode === 'compact') continue; const k = conn(name); if (!k.tools.length && !cachedTools(name).length) k.ensure().catch(() => {}); } };
const shutdownAll = () => { for (const k of conns.values()) k.stop(); };

module.exports = { schemas, callTool, snapshot, logs, restart, stop, approve, warm, shutdownAll, riskOf: () => 'medium', isMcp: (n) => n === 'mcp' || String(n).startsWith('mcp__') };
