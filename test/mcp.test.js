'use strict';
// Regression tests for the built-in MCP client (src/core/mcp.js).
const path = require('path');
const os = require('os');
const config = require('../src/core/config');
config.setDataDir(path.join(os.tmpdir(), 'orca-mcp-test-' + process.pid));

let fail = 0;
const check = (name, ok, info = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] ${info}`); };

(async () => {
  const FIX = path.join(__dirname, 'fixtures', 'mcp-echo.js');
  const srv = (env, extra) => ({ command: process.execPath, args: [FIX], env: env || {}, ...(extra || {}) });
  config.save({ mcpServers: {
    t: srv(),
    crash: srv({ FIX_MODE: 'crash' }),
    pollute: srv({ FIX_MODE: 'pollute' }),
    slowcfg: srv({}, { callTimeout: 1200 }),
    off: srv({}, { tools: { echo: false } }),
    compact1: srv({}, { mode: 'compact' }),
  } });
  const tools = require('../src/core/tools');
  const mcp = require('../src/core/mcp');

  // 0) warm direct-mode servers so cached schemas exist without a model run
  mcp.warm();
  await new Promise((r) => setTimeout(r, 900));

  // 1) schemas: direct tools + meta tool, per-tool toggle respected
  const names = tools.allSchemas().map((s) => s.function.name);
  check('schema-direct', names.includes('mcp__t__echo') && names.includes('mcp__t__add'), names.filter((n) => n.startsWith('mcp')).join(','));
  check('schema-meta', names.includes('mcp'));
  check('schema-toggle-off', !names.includes('mcp__off__echo'));
  check('schema-compact-hidden', !names.includes('mcp__compact1__echo'), 'compact server exposes no direct schemas');

  // 2) call through the tools registry; result is untrusted (→ S10 wrap in agent)
  const r1 = await tools.callTool('mcp__t__echo', { text: 'hello مcp' });
  check('call-echo', !r1.error && /hello/.test(r1.text || '') && r1.untrusted === true, JSON.stringify(r1).slice(0, 80));
  const r2 = await tools.callTool('mcp__t__add', { nums: [2, 3, 4] });
  check('call-add', (r2.text || '').trim() === '9', JSON.stringify(r2).slice(0, 60));

  // 3) meta tool: discovery + call
  const m1 = await tools.callTool('mcp', { action: 'list_servers' });
  check('meta-list', /t /.test(m1.result || '') && /compact1/.test(m1.result || ''), (m1.result || '').slice(0, 90));
  const m3 = await tools.callTool('mcp', { action: 'call', server: 'compact1', tool: 'add', args: { nums: [1, 1] } });
  check('meta-call', (m3.text || '').trim() === '2', JSON.stringify(m3).slice(0, 60));
  const m2 = await tools.callTool('mcp', { action: 'list_tools', server: 'compact1' });
  check('meta-list-tools-compact', !m2.error && /echo/.test(m2.result || ''), (m2.result || m2.error || '').slice(0, 60));
  const m4 = await tools.callTool('mcp', { action: 'tool_schema', server: 't', tool: 'add' });
  check('meta-schema', /nums/.test(m4.result || ''), (m4.result || '').slice(0, 50));

  // 4) disabled tool refuses
  const r3 = await tools.callTool('mcp__off__echo', { text: 'x' });
  check('toggle-refuses-call', !!r3.error && /disabled/.test(r3.error), r3.error || '');

  // 5) crash mode: transparent restart keeps calls succeeding
  let oks = 0;
  for (let i = 0; i < 4; i++) { const r = await tools.callTool('mcp__crash__echo', { text: 'c' + i }); if (!r.error) oks++; }
  check('crash-restart', oks === 4, `ok=${oks}/4`);

  // 6) stdout pollution is detected, handshake still works
  const r4 = await tools.callTool('mcp__pollute__echo', { text: 'p' });
  const snap0 = mcp.snapshot().find((x) => x.name === 'pollute');
  check('pollution-detected', snap0.pollution >= 1 && !r4.error, `pollution=${snap0.pollution}`);

  // 7) per-server callTimeout
  const r5 = await tools.callTool('mcp__slowcfg__slow', {});
  check('call-timeout', !!r5.error && /timeout/i.test(r5.error), (r5.error || '').slice(0, 60));

  // 8) rug-pull detection: fingerprint changes → approve clears the flag
  const snap1 = mcp.snapshot().find((x) => x.name === 't');
  check('fingerprint-changed', snap1.changed === true && !!snap1.fingerprint, `fp=${snap1.fingerprint}`);
  mcp.approve('t');
  check('fingerprint-approved', mcp.snapshot().find((x) => x.name === 't').changed === false);

  // 9) ENOENT diagnostic
  config.save({ mcpServers: { ghost: { command: '/nonexistent/orca-mcp-bin', args: [] } } });
  const rg = await tools.callTool('mcp__ghost__echo', { text: 'x' });
  check('enoent-diagnostic', !!rg.error && /not found|absolute path/.test(rg.error), (rg.error || '').slice(0, 90));

  // 10) shutdown kills children
  mcp.shutdownAll();
  check('shutdown', mcp.snapshot().every((s) => s.status === 'stopped' || s.status === 'error'));

  console.log(fail === 0 ? 'ALL MCP TESTS PASS' : `${fail} MCP TEST(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
