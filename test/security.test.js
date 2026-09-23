'use strict';
// Regression tests for the local-API hardening:
//   1. every /api/* request needs the per-install token (header or ?token=),
//   2. no wildcard CORS anywhere; cross-origin requests are rejected,
//   3. the Host header must be loopback when bound to loopback (DNS rebinding),
//   4. the token is injected into the served index.html so the real UI works.
const http = require('http');
const path = require('path');
const os = require('os');

const DATA = path.join(os.tmpdir(), 'orca-sec-test-' + process.pid);
const config = require('../src/core/config');
config.setDataDir(DATA);

let fail = 0;
const check = (name, ok, info = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] ${info}`); };

const req = (port, pathname, opts = {}) => new Promise((resolve) => {
  const u = new URL(pathname, `http://127.0.0.1:${port}`);
  const r = http.request({ host: '127.0.0.1', port, path: u.pathname + u.search, method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
    let b = ''; res.on('data', (d) => (b += d));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  if (opts.body) r.write(opts.body);
  r.on('error', (e) => resolve({ status: 0, headers: {}, body: String(e.message) }));
  r.end();
});

(async () => {
  const { listen } = require('../src/server');
  const { server, port } = await listen(0, '127.0.0.1');
  const TOKEN = config.apiToken();

  // 1) no token → 401
  const a = await req(port, '/api/chats');
  check('no-token-rejected', a.status === 401, `status=${a.status}`);

  // 2) wrong token → 401
  const b = await req(port, '/api/chats', { headers: { 'x-orca-token': 'f'.repeat(64) } });
  check('wrong-token-rejected', b.status === 401, `status=${b.status}`);

  // 3) valid token via header → 200
  const c = await req(port, '/api/chats', { headers: { 'x-orca-token': TOKEN } });
  check('token-header-ok', c.status === 200, `status=${c.status}`);

  // 4) valid token via Authorization → 200
  const d = await req(port, '/api/chats', { headers: { authorization: 'Bearer ' + TOKEN } });
  check('token-bearer-ok', d.status === 200, `status=${d.status}`);

  // 5) the token in a query string is accepted ONLY on the SSE endpoint (EventSource cannot set
  //    headers); everywhere else it is refused so it cannot leak into logs/history/Referer.
  const e = await req(port, '/api/chats?token=' + TOKEN);
  check('token-query-refused-off-sse', e.status === 401, `status=${e.status}`);
  const e2 = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/events?token=' + TOKEN, method: 'GET' }, (res) => { resolve({ status: res.statusCode }); res.destroy(); });
    r.on('error', () => resolve({ status: 0 })); r.end();
  });
  check('token-query-ok-on-sse', e2.status === 200, `status=${e2.status}`);

  // 6) cross-origin with a valid token → 403
  const f = await req(port, '/api/chats', { headers: { origin: 'https://evil.example', 'x-orca-token': TOKEN } });
  check('cross-origin-blocked', f.status === 403, `status=${f.status}`);

  // 7) same-origin (loopback) Origin is allowed → 200
  const g = await req(port, '/api/chats', { headers: { origin: `http://127.0.0.1:${port}`, 'x-orca-token': TOKEN } });
  check('loopback-origin-ok', g.status === 200, `status=${g.status}`);

  // 8) OPTIONS preflight → 204 with NO access-control-allow-* headers
  const h = await req(port, '/api/send', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-orca-token' } });
  const acao = Object.keys(h.headers).filter((k) => k.toLowerCase().startsWith('access-control-allow')).length;
  check('preflight-no-cors', h.status === 204 && acao === 0, `status=${h.status} allow-headers=${acao}`);

  // 9) no ACAO on a normal API response either
  const i = await req(port, '/api/chats', { headers: { 'x-orca-token': TOKEN } });
  check('api-no-acao', !('access-control-allow-origin' in i.headers), 'no wildcard CORS on API responses');

  // 10) DNS rebinding: Host header pointing elsewhere → 403
  const j = await req(port, '/api/chats', { headers: { host: 'evil.example', 'x-orca-token': TOKEN } });
  check('rebind-host-blocked', j.status === 403, `status=${j.status}`);

  // 11) a loopback browser gets the token embedded (and as an HttpOnly cookie) so the real UI works
  const k = await req(port, '/');
  check('token-injected-loopback', k.status === 200 && k.body.includes(`window.__ORCA_TOKEN__='${TOKEN}'`), `status=${k.status} injected=${k.body.includes(TOKEN)}`);
  check('token-cookie-httponly', String(k.headers['set-cookie'] || '').includes('HttpOnly') && String(k.headers['set-cookie'] || '').includes('SameSite=Strict'), String(k.headers['set-cookie'] || ''));
  // 11b) on a 0.0.0.0 bind a peer's Host must NOT receive the embedded token (S1)
  const lan = await listen(0, '0.0.0.0');
  const k2 = await req(lan.port, '/', { headers: { host: '192.168.1.20:' + lan.port } });
  check('token-not-injected-for-lan', k2.status === 200 && k2.body.includes("window.__ORCA_TOKEN__=''") && !k2.body.includes(TOKEN), `status=${k2.status} leaked=${k2.body.includes(TOKEN)}`);
  // …while the owner on loopback still gets it from the same server
  const k3 = await req(lan.port, '/', { headers: { host: 'localhost:' + lan.port } });
  check('token-injected-for-owner-on-lan-bind', k3.status === 200 && k3.body.includes(TOKEN), `status=${k3.status}`);
  try { lan.server.close(); } catch (_) {}

  try { server.close(); } catch (_) {}
  console.log(fail === 0 ? 'ALL SECURITY TESTS PASS' : `${fail} SECURITY TEST(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
