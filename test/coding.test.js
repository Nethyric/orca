'use strict';
// Regression tests for the coding-power features: repo map, run_tests, fuzzy edit_file,
// auto syntax check and the PROJECT MAP / CODING LOOP system-prompt sections.
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../src/core/config');
config.setDataDir(path.join(os.tmpdir(), 'orca-coding-test-' + process.pid));

const WS = path.join(os.tmpdir(), 'orca-coding-ws-' + process.pid);
fs.rmSync(WS, { recursive: true, force: true });
fs.mkdirSync(path.join(WS, 'src'), { recursive: true });
fs.writeFileSync(path.join(WS, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', scripts: { test: 'node test.js' } }));
fs.writeFileSync(path.join(WS, 'test.js'), "const assert = require('assert');\nassert.strictEqual(1 + 1, 2);\nconsole.log('1 passing');\n");
fs.writeFileSync(path.join(WS, 'src', 'app.js'), 'function computeTotal(items) {   \n  return items.reduce((a, b) => a + b, 0);   \n}\nclass Cart {\n  add(x) { return x; }\n}\nmodule.exports = { computeTotal, Cart };\n');
fs.writeFileSync(path.join(WS, 'src', 'util.py'), 'def parse_csv(text):\n    return text.split(",")\n\nclass Row:\n    pass\n');
fs.writeFileSync(path.join(WS, 'README.md'), '# fx\n');
config.save({ workspace: WS });

let fail = 0;
const check = (name, ok, info = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] ${info}`); };

(async () => {
  const tools = require('../src/core/tools');
  const agent = require('../src/core/agent');

  // 1) repo map: tree + symbols
  const m = tools.extras.codeMap(WS);
  check('codemap-symbols-js', /src\/app\.js: .*computeTotal, Cart/.test(m.map), (m.map.match(/src\/app\.js.*/) || [''])[0]);
  check('codemap-symbols-py', /src\/util\.py: .*parse_csv, Row/.test(m.map), (m.map.match(/src\/util\.py.*/) || [''])[0]);
  check('codemap-files', m.files >= 5, 'files=' + m.files);

  // 2) repo_map tool with path filter
  const rm = await tools.callTool('repo_map', { path: 'src' });
  check('repo_map-tool', !rm.error && /app\.js/.test(rm.map) && !/README/.test(rm.map), JSON.stringify(rm).slice(0, 60));

  // 3) system prompt carries PROJECT MAP + CODING LOOP
  const sp = agent.systemPrompt({});
  check('prompt-project-map', sp.includes('PROJECT MAP') && sp.includes('computeTotal'), '');
  check('prompt-coding-loop', sp.includes('CODING LOOP') && sp.includes('ROOT CAUSE'), '');
  check('prompt-tools-mention', sp.includes('run_tests') && sp.includes('repo_map'), '');

  // 4) run_tests detects npm test and passes
  const t1 = await tools.callTool('run_tests', {});
  check('run_tests-pass', t1.ok === true && t1.label === 'npm test', JSON.stringify(t1).slice(0, 90));

  // 5) run_tests surfaces failures first
  fs.writeFileSync(path.join(WS, 'test.js'), "const assert = require('assert');\nassert.strictEqual(2 + 2, 5, 'expected 4 got 5');\nconsole.log('not reached');\n");
  const t2 = await tools.callTool('run_tests', {});
  check('run_tests-fail-focused', t2.ok === false && /expected 4 got 5/.test(t2.failures || '') && !/not reached/.test(t2.failures || ''), JSON.stringify(t2).slice(0, 120));
  check('run_tests-hint', /root cause/.test(t2.hint || ''), '');
  check('run_tests-failing_at', (t2.failing_at || []).some((x) => /test\.js:\d+/.test(x)), JSON.stringify(t2.failing_at || []));
  fs.writeFileSync(path.join(WS, 'test.js'), "const assert = require('assert');\nassert.strictEqual(1 + 1, 2);\nconsole.log('1 passing');\n");

  // 6) edit_file fuzzy (trailing whitespace in file, clean anchor from model)
  const e1 = await tools.callTool('edit_file', { path: 'src/app.js', old: 'function computeTotal(items) {\n  return items.reduce((a, b) => a + b, 0);\n}', new: 'function computeTotal(items) {\n  return items.reduce((a, b) => a + b, 0); // sum\n}' });
  check('edit-fuzzy-applied', e1.ok === true && !!e1.fuzzy, JSON.stringify(e1).slice(0, 110));
  check('edit-fuzzy-content', fs.readFileSync(path.join(WS, 'src', 'app.js'), 'utf8').includes('// sum'), '');

  // 7) edit_file miss → closest-line hint
  const e2 = await tools.callTool('edit_file', { path: 'src/app.js', old: 'function computeTotall(items) {', new: 'x' });
  check('edit-miss-hint', !!e2.error && /Closest line 1/.test(e2.error), (e2.error || '').slice(0, 110));

  // 8) write_file syntax check still in the loop
  const w1 = await tools.callTool('write_file', { path: 'src/broken.js', content: 'function oops( {\n' });
  check('write-syntax-error', /ERROR/.test(w1.syntax || ''), w1.syntax || '');
  const w2 = await tools.callTool('write_file', { path: 'src/broken.js', content: 'function oops() { return 1; }\nmodule.exports = { oops };\n' });
  check('write-syntax-ok', w2.syntax === 'ok', w2.syntax || '');

  // 9) round 5: import-graph hubs in the repo map (src/lib imported by 2 files)
  fs.writeFileSync(path.join(WS, 'src', 'lib.js'), 'module.exports = { k: 1 };\n');
  fs.writeFileSync(path.join(WS, 'src', 'app.js'), "const L = require('./lib');\n" + fs.readFileSync(path.join(WS, 'src', 'app.js'), 'utf8'));
  fs.writeFileSync(path.join(WS, 'src', 'extra.js'), "const { k } = require('./lib');\nmodule.exports = { k };\n");
  const m2 = tools.extras.codeMap(WS);
  check('codemap-hubs', /hubs \(most-imported/.test(m2.map) && /src\/lib \(2×\)/.test(m2.map), (m2.map.match(/hubs.*/) || [''])[0]);

  // 10) round 5: atomic multi-edit — success applies both anchors in one call
  const me1 = await tools.callTool('edit_file', { path: 'src/app.js', edits: [{ old: 'class Cart {', new: 'class CartV2 {' }, { old: 'module.exports = { computeTotal, Cart };', new: 'module.exports = { computeTotal, Cart: CartV2 };' }] });
  const appSrc = fs.readFileSync(path.join(WS, 'src', 'app.js'), 'utf8');
  check('multiedit-ok', me1.ok === true && me1.replaced === 2 && me1.atomic === true && appSrc.includes('class CartV2 {') && appSrc.includes('Cart: CartV2'), JSON.stringify(me1).slice(0, 100));

  // 11) round 5: atomic multi-edit — a bad anchor leaves the file untouched
  const beforeAtomic = fs.readFileSync(path.join(WS, 'src', 'app.js'), 'utf8');
  const me2 = await tools.callTool('edit_file', { path: 'src/app.js', edits: [{ old: 'class CartV2 {', new: 'class CartX {' }, { old: 'no-such-anchor-xyz', new: 'x' }] });
  check('multiedit-atomic', !!me2.error && /edits\[1\]/.test(me2.error) && /atomic/.test(me2.error) && fs.readFileSync(path.join(WS, 'src', 'app.js'), 'utf8') === beforeAtomic, (me2.error || '').slice(0, 110));

  // 12) round 5: grep word=true matches whole words only (find refs before rename)
  fs.writeFileSync(path.join(WS, 'src', 'words.js'), 'const runner = 1;\nfunction run() { return runner; }\nmodule.exports = { run, runner };\n');
  const g1 = await tools.callTool('grep', { pattern: 'run', word: true, glob: 'src/words.js' });
  const g2 = await tools.callTool('grep', { pattern: 'run', glob: 'src/words.js' });
  check('grep-word', g1.count === 2 && g2.count === 3, `word=${g1.count} plain=${g2.count}`);

  // 13) round 6: query-aware repo map ranks task-relevant files first (aider-style personalization)
  const m3 = tools.extras.codeMap(WS, 90, 2600, 'fix computeTotal rounding in the cart');
  check('codemap-query-focus', /focus \(task-relevant/.test(m3.map) && /src\/app\.js → .*computeTotal/.test(m3.map), (m3.map.match(/focus \(task-relevant[^\n]*/) || [''])[0]);
  const rm2 = await tools.callTool('repo_map', { query: 'parse_csv rows' });
  check('repo_map-query', /focus \(task-relevant/.test(rm2.map) && /util\.py → .*parse_csv/.test(rm2.map), '');

  // 14) round 6: change-context — edit results name the test files that reference the changed file
  fs.mkdirSync(path.join(WS, 'test'), { recursive: true });
  fs.writeFileSync(path.join(WS, 'test', 'app.test.js'), "const app = require('../src/app');\nconsole.log(typeof app.computeTotal);\n");
  const e3 = await tools.callTool('edit_file', { path: 'src/app.js', old: '// sum', new: '// total sum' });
  check('edit-related-tests', e3.ok === true && Array.isArray(e3.related_tests) && e3.related_tests.includes('test/app.test.js'), JSON.stringify(e3.related_tests || []));

  // 15) round 7: code_refs — definition + every reference (safe rename/refactor planning)
  const cr = await tools.callTool('code_refs', { symbol: 'computeTotal' });
  check('code_refs-def', cr.definition && /src\/app\.js/.test(cr.definition.file) && cr.definition.kind === 'definition', JSON.stringify(cr.definition || {}));
  check('code_refs-refs', cr.count >= 3 && (cr.references || []).some((r) => /test\/app\.test\.js/.test(r.file)), 'count=' + cr.count);

  console.log(fail === 0 ? 'ALL CODING TESTS PASS' : `${fail} CODING TEST(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
