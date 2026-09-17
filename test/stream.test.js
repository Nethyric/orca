'use strict';
// Stream-parser edge cases against a fake OpenAI-compatible provider (test/fake-provider.js):
// dropped </think>, nested <think>, runaway repetition, stream cut without finish_reason, length cap.
// Run: node test/stream.test.js
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const config = require('../src/core/config');
config.setDataDir(path.join(require('os').tmpdir(), 'orca-test-data'));
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'agent.js'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', '__filename', src + '\nmodule.exports.streamOnce = streamOnce; module.exports.joinContinuation = joinContinuation; module.exports.cutRepetition = cutRepetition;')(
  m, m.exports, (p) => require(p.startsWith('.') ? path.resolve(__dirname, '..', 'src', 'core', p) : p), path.resolve(__dirname, '..', 'src', 'core'), 'agent.js');
const { streamOnce, joinContinuation, cutRepetition } = m.exports;

const expect = { nested: 'Paris.', nested2: 'Paris.', rloop: 'Paris.', loop: 'The answer is 42.', plan: 'Here is the answer.', realclose: 'The real answer.', realclose2: 'The real answer.', cut: null, length: null, tiny: null, unterminated: null };
(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'fake-provider.js')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  let fail = 0;
  try {
    for (const sc of Object.keys(expect)) {
      const events = []; let live = '';
      const r = await streamOnce({ baseUrl: 'http://127.0.0.1:8791', apiKey: 'x', model: sc, maxTokens: 100 }, [{ role: 'user', content: 'hi' }], (d) => { events.push(d.type); if (d.type === 'content') live += d.text; if (d.type === 'reset') live = ''; }, null, false, 0.5);
      const ok = (!expect[sc] || r.content.trim() === expect[sc]) && live.trim() === r.content.trim() && (sc !== 'cut' || r.finish === 'cut') && (sc !== 'length' || r.finish === 'length');
      if (!ok) fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'} [${sc}] finish=${r.finish} looped=${!!r.looped} content=${JSON.stringify(r.content.slice(0, 40))}`);
    }
    const joins = [
      ['Now tests.\n\n```javascript\nconst { app } =', '```javascript\nconst { app } = require(\'../server\');\n', 'Now tests.\n\n```javascript\nconst { app } = require(\'../server\');\n'],
      ['Start the server', ' with `node server.js`.', 'Start the server with `node server.js`.'],
      ['The fox jumps over the lazy dog and keeps', ' over the lazy dog and keeps running.', 'The fox jumps over the lazy dog and keeps running.'],
      ['Line one\nLine two is here and it goes on', 'Line two is here and it goes on and finishes.', 'Line one\nLine two is here and it goes on and finishes.'],
    ];
    for (const [a, b, want] of joins) { const got = joinContinuation(a, b); const ok = got === want; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} join ${JSON.stringify(got.slice(-50))}`); }
    const cuts = [['Paris.' + ' Paris. No further reasoning needed. The user asked for one word.'.repeat(40), 'Paris.'], ['Plan:\n1. Read\n' + '2. Run tests\n2. Run tests\n'.repeat(50), 'Plan:\n1. Read\n2. Run tests'], ['Unique prose, nothing repeated.', 'Unique prose, nothing repeated.']];
    for (const [a, want] of cuts) { const got = cutRepetition(a); const ok = got === want; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} cut ${JSON.stringify(got.slice(0, 50))}`); }
  } finally { srv.kill(); }
  console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
