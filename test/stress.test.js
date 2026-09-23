'use strict';
// STRESS TEST (round 9): builds a hard multi-file project (chess movegen + exact perft suite against
// reference values) using ONLY the coding stack, plants bugs, diagnoses them via run_tests failure
// focus + failing_at, root-cause fixes, cross-file rename via code_refs + atomic multi-edit, and
// verifies the syntax guard and atomic safety. Permanent regression for the coding sections. build a hard multi-file project (chess movegen + exact perft suite) using ONLY ORCA's
// coding stack (repo_map / code_refs / edit_file multi+atomic / run_tests failing_at / related_tests).
// We play the role of the model; every change goes through the tools. Deliberate bugs are planted,
// then diagnosed via run_tests failure focus + failing_at, fixed at the root cause, refactored via
// code_refs + atomic multi-edit, and re-verified. Prints a signal report at the end.
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../src/core/config');
const WS = path.join(os.tmpdir(), 'orca-stress-ws-' + process.pid);
config.setDataDir(path.join(os.tmpdir(), 'orca-stress-data-' + process.pid));
fs.rmSync(WS, { recursive: true, force: true });
fs.mkdirSync(path.join(WS, 'src'), { recursive: true });
fs.mkdirSync(path.join(WS, 'test'), { recursive: true });
config.save({ workspace: WS });
const tools = require('../src/core/tools');
const call = (n, a) => tools.callTool(n, a);

let fail = 0;
const check = (name, ok, info = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} [${name}] ${String(info).slice(0, 150)}`); };

// ── the chess engine sources (written THROUGH write_file, as the model would) ──
const BOARD_JS = `// 0..63 mailbox chess board + make/unmake
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const KIWI = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -';
const POS6 = 'r4rk1/1pp1qppp/p1np1n2/2b1p3/2B1P3/2NP1N2/PPP1QPPP/R3K2R w - -';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -';
function parseFen(fen) {
  const [pl, side, cast, ep] = fen.split(' ');
  const b = new Array(64).fill(null);
  let sq = 0;
  for (const ch of pl) {
    if (ch === '/') continue;
    if (/\\d/.test(ch)) { sq += +ch; continue; }
    const row = Math.floor(sq / 8), col = sq % 8;
    b[row * 8 + col] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
    sq++;
  }
  return { b, side, cast: cast === '-' ? '' : cast, ep: ep && ep !== '-' ? alg(ep) : -1 };
}
function alg(s) { const col = s.charCodeAt(0) - 97, row = 8 - +s[1]; return row * 8 + col; }
const rowOf = (s) => s >> 3, colOf = (s) => s & 7;
function attacked(b, sq, by) {
  const r = rowOf(sq), c = colOf(sq);
  const pr = by === 'w' ? r + 1 : r - 1; // pawns of 'by' attack toward opposite side
  for (const dc of [-1, 1]) { const rr = pr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === by + 'P') return true; }
  const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  for (const [dr, dc] of KN) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === by + 'N') return true; }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === by + 'K') return true; }
  const RAY = { R: [[1, 0], [-1, 0], [0, 1], [0, -1]], B: [[1, 1], [1, -1], [-1, 1], [-1, -1]] };
  for (const [t, dirs] of [['R', RAY.R], ['B', RAY.B]]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const p = b[rr * 8 + cc];
        if (p) { if (p === by + t || p === by + 'Q') return true; break; }
        rr += dr; cc += dc;
      }
    }
  }
  return false;
}
function kingSq(b, side) { for (let i = 0; i < 64; i++) if (b[i] === side + 'K') return i; return -1; }
function makeMove(st, m) {
  const undo = { m, cap: st.b[m.to], cast: st.cast, ep: st.ep };
  const p = st.b[m.from];
  st.b[m.to] = p; st.b[m.from] = null;
  if (m.ep) st.b[m.to + (st.side === 'w' ? 8 : -8)] = null;
  if (m.promo) st.b[m.to] = st.side + m.promo;
  if (m.castle) {
    if (m.to === 62) { st.b[61] = st.b[63]; st.b[63] = null; }
    if (m.to === 58) { st.b[59] = st.b[56]; st.b[56] = null; }
    if (m.to === 6) { st.b[5] = st.b[7]; st.b[7] = null; }
    if (m.to === 2) { st.b[3] = st.b[0]; st.b[0] = null; }
  }
  st.cast = st.cast.replace(/[KQkq]/g, (ch) => {
    if (ch === 'K' && (m.from === 60 || m.from === 63)) return '';
    if (ch === 'Q' && (m.from === 60 || m.from === 56)) return '';
    if (ch === 'k' && (m.from === 4 || m.from === 7)) return '';
    if (ch === 'q' && (m.from === 4 || m.from === 0)) return '';
    if (m.to === 63 && ch === 'K') return ''; if (m.to === 56 && ch === 'Q') return '';
    if (m.to === 7 && ch === 'k') return ''; if (m.to === 0 && ch === 'q') return '';
    return ch;
  });
  st.ep = m.dbl ? (m.from + m.to) / 2 : -1;
  st.side = st.side === 'w' ? 'b' : 'w';
  return undo;
}
function unmakeMove(st, u) {
  st.side = st.side === 'w' ? 'b' : 'w';
  const m = u.m; const p = st.b[m.to];
  st.b[m.from] = m.promo ? st.side + 'P' : p;
  st.b[m.to] = u.cap || null;
  if (m.ep) st.b[m.to + (st.side === 'w' ? 8 : -8)] = st.side === 'w' ? 'bP' : 'wP';
  if (m.castle) {
    if (m.to === 62) { st.b[63] = st.b[61]; st.b[61] = null; }
    if (m.to === 58) { st.b[56] = st.b[59]; st.b[59] = null; }
    if (m.to === 6) { st.b[7] = st.b[5]; st.b[5] = null; }
    if (m.to === 2) { st.b[0] = st.b[3]; st.b[3] = null; }
  }
  st.cast = u.cast; st.ep = u.ep;
}
module.exports = { START, KIWI, POS3, POS6, parseFen, attacked, kingSq, makeMove, unmakeMove, rowOf, colOf };
`;

const MOVEGEN_JS = `// pseudo-legal generation + legality filter
const B = require('./board');
const DIRS = { N: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]], K: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] };
const RAYS = { R: [[1, 0], [-1, 0], [0, 1], [0, -1]], B: [[1, 1], [1, -1], [-1, 1], [-1, -1]], Q: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] };
function push(ms, from, to, extra) { ms.push(Object.assign({ from, to }, extra || {})); }
function genMoves(st) {
  const ms = []; const side = st.side; const opp = side === 'w' ? 'b' : 'w';
  for (let from = 0; from < 64; from++) {
    const p = st.b[from]; if (!p || p[0] !== side) continue;
    const t = p[1], r = B.rowOf(from), c = B.colOf(from);
    if (t === 'P') {
      const dr = side === 'w' ? -1 : 1, start = side === 'w' ? 6 : 1, last = side === 'w' ? 0 : 7;
      const one = (r + dr) * 8 + c;
      if (r + dr >= 0 && r + dr < 8 && !st.b[one]) {
        if (r + dr === last) for (const pr of ['Q', 'R', 'B', 'N']) push(ms, from, one, { promo: pr });
        else push(ms, from, one);
        const two = (r + 2 * dr) * 8 + c;
        if (r === start && !st.b[two]) push(ms, from, two, { dbl: true });
      }
      for (const dc of [-1, 1]) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        const to = rr * 8 + cc; const q = st.b[to];
        if (q && q[0] === opp) { if (rr === last) for (const pr of ['Q', 'R', 'B', 'N']) push(ms, from, to, { promo: pr }); else push(ms, from, to); }
        else if (to === st.ep) push(ms, from, to, { ep: true });
      }
    } else if (t === 'N' || t === 'K') {
      for (const [dr, dc] of DIRS[t]) { const rr = r + dr, cc = c + dc; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue; const to = rr * 8 + cc; const q = st.b[to]; if (!q || q[0] === opp) push(ms, from, to); }
    } else {
      for (const [dr, dc] of (t === 'Q' ? RAYS.Q : t === 'R' ? RAYS.R : RAYS.B)) {
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const to = rr * 8 + cc; const q = st.b[to];
          if (!q) push(ms, from, to);
          else { if (q[0] === opp) push(ms, from, to); break; }
          rr += dr; cc += dc;
        }
      }
    }
  }
  // castling omitted (planted bug)
  return ms;
}
function legalMoves(st) {
  const out = [];
  for (const m of genMoves(st)) {
    if (m.castle) { out.push(m); continue; }
    const u = B.makeMove(st, m);
    if (!B.attacked(st.b, B.kingSq(st.b, st.side === 'w' ? 'b' : 'w'), st.side)) out.push(m);
    B.unmakeMove(st, u);
  }
  return out;
}
module.exports = { genMoves, legalMoves };
`;

const PERFT_JS = `const B = require('./board');
const M = require('./movegen');
function perft(st, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of M.legalMoves(st)) { const u = B.makeMove(st, m); n += perft(st, depth - 1); B.unmakeMove(st, u); }
  return n;
}
module.exports = { perft };
`;

const TEST_JS = `const assert = require('assert');
const B = require('../src/board');
const MG = require('../src/movegen'); // keep: related_tests anchor
const { perft } = require('../src/perft');
const cases = [
  ['start d1', B.START, 1, 20],
  ['start d2', B.START, 2, 400],
  ['start d3', B.START, 3, 8902],
  ['start d4', B.START, 4, 197281],
  ['pos5 d1', B.KIWI, 1, 44],
  ['pos5 d2', B.KIWI, 2, 1486],
  ['pos5 d3', B.KIWI, 3, 62379],
  ['pos3 d3', B.POS3, 3, 2812],
  ['pos3 d4', B.POS3, 4, 43238],
];
let bad = 0;
for (const [name, fen, d, want] of cases) {
  const st = B.parseFen(fen);
  const got = perft(st, d);
  if (got !== want) { bad++; console.log('FAIL ' + name + ' expected ' + want + ' got ' + got); }
  else console.log('ok ' + name + ' = ' + got);
}
assert.strictEqual(bad, 0, bad + ' perft case(s) wrong');
console.log(cases.length + ' passing');
`;

const CASTLING_FIX = `  const home = side === 'w' ? 60 : 4;
  if (st.b[home] === side + 'K' && !B.attacked(st.b, home, opp)) {
    const rk = side + 'R';
    if (st.cast.includes(side === 'w' ? 'K' : 'k') && !st.b[home + 1] && !st.b[home + 2] && st.b[home + 3] === rk && !B.attacked(st.b, home + 1, opp) && !B.attacked(st.b, home + 2, opp)) push(ms, home, home + 2, { castle: true });
    if (st.cast.includes(side === 'w' ? 'Q' : 'q') && !st.b[home - 1] && !st.b[home - 2] && st.b[home - 4] === rk && !B.attacked(st.b, home - 1, opp) && !B.attacked(st.b, home - 2, opp)) push(ms, home, home - 2, { castle: true });
  }
`;

(async () => {
  // 1) scaffold through the tools
  await call('write_file', { path: 'package.json', content: JSON.stringify({ name: 'perft-lab', version: '1.0.0', scripts: { test: 'node test/perft.test.js' } }, null, 1) + '\n' });
  await call('write_file', { path: 'src/board.js', content: BOARD_JS });
  await call('write_file', { path: 'src/movegen.js', content: MOVEGEN_JS });
  await call('write_file', { path: 'src/perft.js', content: PERFT_JS });
  await call('write_file', { path: 'test/perft.test.js', content: TEST_JS });

  // 2) orientation: query-aware repo map must surface the castling gap
  const map = tools.extras.codeMap(WS, 90, 2600, 'fix castling generation in movegen');
  check('stress-map-focus', /focus \(task-relevant/.test(map.map) && /movegen/.test((map.map.match(/focus[\s\S]{0,120}/) || [''])[0]), (map.map.match(/focus.*/) || [''])[0]);

  // 3) first run: planted bug → failures first + exact jump points
  const t1 = await call('run_tests', {});
  check('stress-fail-focus', t1.ok === false && /pos5 d1 expected 44 got 43/.test(t1.failures || ''), (t1.failures || '').split('\n').find((l) => /pos5/.test(l)) || '');
  check('stress-failing_at', (t1.failing_at || []).some((x) => /perft\.test\.js:\d+/.test(x)), JSON.stringify(t1.failing_at || []));

  // 4) locate the gap with code_refs, then root-cause fix with ONE anchored edit
  const cr = await call('code_refs', { symbol: 'genMoves' });
  check('stress-code_refs', cr.definition && /movegen\.js/.test(cr.definition.file) && cr.count >= 2, 'refs=' + cr.count);
  const e1 = await call('edit_file', { path: 'src/movegen.js', old: '  // castling omitted (planted bug)\n  return ms;', new: CASTLING_FIX + '  return ms;' });
  check('stress-fix-edit', e1.ok === true && e1.syntax === 'ok', JSON.stringify({ ok: e1.ok, syntax: e1.syntax }));
  check('stress-related_tests', (e1.related_tests || []).includes('test/perft.test.js'), JSON.stringify(e1.related_tests || []));

  // 5) re-run: all exact perft values must pass now
  const t2 = await call('run_tests', {});
  check('stress-all-pass', t2.ok === true && /9 passing/.test(t2.summary || t2.output || ''), (t2.summary || t2.output || '').slice(0, 80));

  // 6) refactor: rename legalMoves → generateLegal everywhere via code_refs + atomic multi-edit
  const cr2 = await call('code_refs', { symbol: 'legalMoves' });
  const files = [...new Set((cr2.references || []).map((r) => r.file))];
  check('stress-rename-scope', files.includes('src/movegen.js') && files.includes('src/perft.js'), files.join(','));
  const editsByFile = {};
  for (const r of cr2.references || []) (editsByFile[r.file] = editsByFile[r.file] || new Set()).add(r.text);
  let renameOk = true;
  for (const f of files) {
    const n = (cr2.references || []).filter((r) => r.file === f).length;
    const r1 = await call('edit_file', { path: f, edits: [{ old: 'legalMoves', new: 'generateLegal', all: true }] });
    if (!r1.ok || r1.replaced !== n) { renameOk = false; console.log('rename miss', f, JSON.stringify(r1).slice(0, 120)); }
  }
  const t3 = await call('run_tests', {});
  check('stress-rename-safe', renameOk && t3.ok === true, 'replaced ok=' + renameOk + ' tests ok=' + t3.ok);

  // 7) guard rails: broken syntax is caught inline and reported
  const b1 = await call('edit_file', { path: 'src/perft.js', old: 'function perft(st, depth) {', new: 'function perft(st, depth {', });
  check('stress-syntax-guard', /ERROR/.test(b1.syntax || ''), b1.syntax || '');
  const b2 = await call('edit_file', { path: 'src/perft.js', old: 'function perft(st, depth {', new: 'function perft(st, depth) {' });
  check('stress-syntax-restored', b2.ok === true && b2.syntax === 'ok', b2.syntax || '');

  // 8) atomic multi-edit safety on a real file: bad anchor → nothing written
  const before = fs.readFileSync(path.join(WS, 'src', 'board.js'), 'utf8');
  const a1 = await call('edit_file', { path: 'src/board.js', edits: [{ old: 'function alg(s) {', new: 'function alg2(s) {' }, { old: 'no-such-anchor', new: 'x' }] });
  check('stress-atomic', !!a1.error && /edits\[1\]/.test(a1.error) && fs.readFileSync(path.join(WS, 'src', 'board.js'), 'utf8') === before, (a1.error || '').slice(0, 90));

  const t4 = await call('run_tests', {});
  check('stress-final-green', t4.ok === true, '');
  console.log(fail === 0 ? 'STRESS VERDICT: CODING STACK HOLDS (all signals green)' : `STRESS VERDICT: ${fail} SIGNAL(S) LIMPING`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
