'use strict';
// Minimal stdio MCP server used by test/mcp.test.js. Modes via FIX_MODE env:
//   crash   → exit(3) after answering 2 tool calls
//   pollute → writes a non-JSON banner to stdout at boot (protocol pollution)
//   (none)  → well-behaved echo/add/slow server
const MODE = process.env.FIX_MODE || '';
if (MODE === 'pollute') process.stdout.write('Hello from a buggy server banner!\n');

let calls = 0;
let buf = '';
process.stdin.on('data', (d) => {
  buf += String(d);
  let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
});
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
function handle(line) {
  let m; try { m = JSON.parse(line); } catch (_) { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo-fixture', version: '1.0' } } });
  if (m.method === 'notifications/initialized') return;
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [
    { name: 'echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'add', description: 'Add numbers', inputSchema: { type: 'object', properties: { nums: { type: 'array', items: { type: 'number' } } }, required: ['nums'] } },
    { name: 'slow', description: 'Sleeps ~5s then answers', inputSchema: { type: 'object', properties: {} } },
  ] } });
  if (m.method === 'tools/call') {
    calls++;
    const a = m.params.arguments || {};
    const done = (content) => {
      send({ jsonrpc: '2.0', id: m.id, result: { content, isError: false } });
      if (MODE === 'crash' && calls >= 2) setTimeout(() => process.exit(3), 30);
    };
    if (m.params.name === 'echo') return done([{ type: 'text', text: String(a.text || '') }]);
    if (m.params.name === 'add') return done([{ type: 'text', text: String((a.nums || []).reduce((x, y) => x + y, 0)) }]);
    if (m.params.name === 'slow') return setTimeout(() => done([{ type: 'text', text: 'slept' }]), 5000);
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'unknown tool' }], isError: true } });
  }
  if (m.id != null) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unsupported' } });
}
process.on('SIGTERM', () => process.exit(0));
