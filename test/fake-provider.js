// Fake OpenAI-compatible SSE server to unit-test streamOnce edge cases: unterminated <think>, stream cut w/o finish, length finish.
const http = require('http');
const scenarios = {
  unterminated: { chunks: ['<think>The user asks for a tutorial. Let me plan: db.js, routes.js, server.js. Keep it thorough.', '\n\n\n# REST API with Node.js\n\nThis tutorial shows', ' how to build a REST API.\n\n## 1. Setup\n\n```js\nconst x = 1;\n```\n', ' Done.'], finish: 'stop' },
  realclose: { chunks: ['<think>Short thought', '\n\n\n# Heading looks like answer\n\nbut then', ' more thinking</think>', 'The real answer.'], finish: 'stop' },
  realclose2: { chunks: ['<think>' + 'The user asks for a tutorial. Let me plan carefully what files are needed and why. '.repeat(3), '\n\n\n# Heading looks like answer\n\nbut then', ' more thinking</think>', 'The real answer.'], finish: 'stop' },
  tiny: { chunks: ['<think>The user wants a simple list of 40 fruits with facts - no preamble. Let me just write it directly.', '\n\n', '\n', '1', '.', ' **', 'Apple', '**', ' – Apples float', ' in water.\n2. **Banana** – berries.\n'], finish: 'stop' },
  plan: { chunks: ['<think>I need to plan this.\n\n\n1. read files\n2. write code\n\nOK let me do it.</think>', 'Here is the answer.'], finish: 'stop' },
  nested: { chunks: ['<think>The user is asking a simple trivia question. I know the answer directly.', '\n\n\nParis.', '<think>\nDirect answer to a simple factual question.', ...Array.from({length: 60}, () => ' Paris. No further reasoning needed. The capital of France is Paris. Answered directly without tools. The user asked for one word.')], finish: 'length' },
  loop: { chunks: ['The answer is 42.', ...Array.from({length: 80}, () => ' The answer is 42. No further explanation is needed here.')], finish: 'length' },
  rloop: { chunks: ['<think>Simple question.', '\n\n\nParis.', ...Array.from({length: 80}, () => ' Paris. No further reasoning needed. The capital of France is Paris. Answered directly without tools. The user asked for one word.')], finish: 'length' },
  nested2: { chunks: ['<think>The user is asking a simple trivia question. I know the answer directly.', '\n\n\nParis.', '<think>\nDirect answer to a simple factual question.</think>', ...Array.from({length: 60}, () => ' Paris. No further reasoning needed. The capital of France is Paris. Answered directly without tools. The user asked for one word.')], finish: 'length' },
  cut: { chunks: ['Here is a long answer that the proxy will cut ', 'in the middle of a sentence because of a 300 s limit and'], finish: null, noDone: true },
  length: { chunks: ['Part one of the answer, ', 'ends abruptly at the token cap'], finish: 'length' },
  // the gateway hit its own time limit but reported finish_reason "stop": long answer, still inside a ``` block
  fakestop: { chunks: ['# Tutorial\n\nIntro paragraph.\n\n```js\n', ...Array.from({ length: 120 }, (_, i) => `const line${i} = doSomethingUseful(${i}); // keeps going\n`), 'const last = '], finish: 'stop' },
  // a real stop with balanced fences must stay a stop
  realstop: { chunks: ['# Tutorial\n\nIntro paragraph.\n\n```js\n', ...Array.from({ length: 120 }, (_, i) => `const line${i} = doSomethingUseful(${i}); // keeps going\n`), '```\n\nDone.'], finish: 'stop' },
  // first request lands on a crawling node (one short chunk every 400 ms); the client must re-issue and get the fast node
  slownode: { chunks: ['The fast answer', ...Array.from({ length: 30 }, (_, i) => ` word${i}`), '.'], finish: 'stop', slowFirst: 400 },
  // a runaway write_file whose arguments never end (content first, no path) — the client must cut it and salvage
  bigtool: { tool: 'write_file', argChunks: ['{"content": "# Big Tutorial\\n\\n', ...Array.from({ length: 400 }, (_, i) => `Paragraph ${i} of the tutorial with enough words to make it long and realistic.\\n`)], finish: null, noDone: true },
  // the gateway drops the stream ~90 characters into a tool call (seen live: edit_file cut after 91 chars, no finish_reason) — must surface as a stall (504), not as a "truncated" call
  cuttool: { tool: 'edit_file', argChunks: ['{"path": "cafe/index.html", "old": "TODO: features section title", "new": "ویژگی'], finish: null, noDone: true, close: true },
  // a legitimately long tool call that finishes at the token cap keeps its 'length' finish (salvage path)
  lengthtool: { tool: 'write_file', argChunks: ['{"path": "notes.md", "content": "', ...Array.from({ length: 40 }, (_, i) => `line ${i} of a document that hits the cap\\n`)], finish: 'length', close: true },
};
const hits = {};
http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => body += d); req.on('end', () => {
    const j = JSON.parse(body); const sc = scenarios[j.model] || scenarios.length;
    hits[j.model] = (hits[j.model] || 0) + 1;
    const gap = sc.slowFirst && hits[j.model] === 1 ? sc.slowFirst : 30;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    let i = 0;
    const tick = () => {
      if (sc.tool) {
        if (i === 0) res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_big', type: 'function', function: { name: sc.tool, arguments: '' } }] }, finish_reason: null }] })}\n\n`);
        if (i < sc.argChunks.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: sc.argChunks[i++] } }] }, finish_reason: null }] })}\n\n`); setTimeout(tick, 5); return; }
        if (sc.close) { if (sc.finish) res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: sc.finish }], usage: { prompt_tokens: 10, completion_tokens: 20 } })}\n\n`); if (!sc.noDone) res.write('data: [DONE]\n\n'); res.end(); return; }
        return; // never finishes (proxy would cut it after minutes)
      }
      if (i < sc.chunks.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: sc.chunks[i++] }, finish_reason: null }] })}\n\n`); setTimeout(tick, gap); }
      else { if (sc.finish) res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: sc.finish }], usage: { prompt_tokens: 10, completion_tokens: 20 } })}\n\n`); if (!sc.noDone) res.write('data: [DONE]\n\n'); res.end(); }
    };
    tick();
  });
}).listen(8791, '127.0.0.1', () => console.log('fake sse on 8791'));
