# Decision engine

ORCA can consult a **System One model** — a model that returns typed judgments
(a probability, a choice with a distribution, a score) instead of generating text —
for the small decisions that plain code makes badly and a large language model makes
slowly. It is optional: without a key every decision falls back to the built-in
heuristics, and every call fails open, so a chat is never blocked by it.

The reference implementation is TypeSafe's `POST /v1/systemone` API (model `jev-latest`);
any endpoint that speaks the same request/response shape works.

## What it is used for

| Decision | Question asked | Effect |
|---|---|---|
| **Request routing** (`auto` model) | *What kind of work does this message require?* → `light` / `build` / `research` / `long_text` | `light` → the fast model; everything else → the strong model. Replaces the keyword list, which misses "make the buttons blue" and over-triggers on words like "test". Falls back to the keyword router below confidence 0.55. |
| **Command-risk review** | *Could running this command destroy data, harm the system, leak secrets or do something irreversible remotely?* | A `run_shell` call the regex rated `medium` is escalated to `high` (→ approval in `auto` autonomy) when the probability is ≥ 0.7. Catches `curl … \| sudo bash`, `git checkout -- .`, pipes to remote hosts. Skipped in `yolo`. |
| **Answer verification** | *Is the answer garbled? Does it only promise work? Does it ask the user something? Is it in the wrong language?* | Before the final answer is shown: garbled (≥ 0.85) → regenerated once; a promise with nothing done (≥ 0.8) → the agent is told to do the work; wrong language (≥ 0.85) → rewritten in the user's language. At most two nudges per run; never for sub-agents or plan mode. |
| **Search re-ranking** | *How relevant is each result to the query?* (one question per result, one request) | `web_search` results are re-ordered by relevance and clear misses are dropped (at least 3 kept). |
| **Salvage naming** | *Which of the files mentioned in the conversation is this content for?* | When a huge `write_file` is cut before its `path` arrives and several files were mentioned, the right one is chosen (confidence ≥ 0.6) instead of the first match. |

Every call carries a 2.5–4 s timeout. Failures, rate limits (`429`/`529`) and a rejected
key put the engine on a short cooldown; nothing is retried in a loop.

## Setup

**Settings → Agent → Decision engine**: paste the key, optionally change the base URL
(default `https://api.typesafe.ai/v1`) and model (default `jev-latest`), press **Test**.
The test sends one request (`rm -rf /` → destructive probability) and shows latency
and the model version that answered.

Configuration record (`config.json`):

```json
"judge": { "enabled": true, "apiKey": "…", "baseUrl": "", "model": "" }
```

Environment fallbacks: `ORCA_JUDGE_KEY` or `TYPESAFE_API_KEY` are used when no key is
saved in the config. The key is stored only on the device, never in the vault, never in
the repository, and `GET /api/config` returns it masked.

## API surface

| Route | Purpose |
|---|---|
| `GET /api/health` → `judge` | `{ configured, enabled, model, cooling, stats: { calls, ok, failed, inputTokens, outputTokens, avgMs, lastError } }` |
| `GET /api/judge/status` | Same object |
| `POST /api/judge/test` `{ apiKey?, baseUrl?, model? }` | One live request with the given (or stored) credentials → `{ ok, ms, model, sample }` |

SSE additions on a run: the `verdict` event `{ garbage, promise, done, langMismatch }`
(probabilities, 0–1) after the answer check, and `judged` (destructive probability) on
`tool_call` / `approval` events when the risk was escalated.

## Cost and limits

The reference model charges per **input** token only (≈ $0.04 per million); output
tokens are free. A typical chat turn spends 300–1,500 input tokens across all
decisions — roughly a hundredth of a cent. Context is 64k tokens per request; inputs are
truncated accordingly (messages 2,000 chars, answers 6,000 chars, commands 3,000 chars).

## Measured behaviour

Evaluation with `jev-1.13.0` (September 2026), 84 requests, median latency 0.16 s,
p95 0.36 s, 20 parallel requests in 1.2 s, 25k-token state in 0.38 s:

| Task | Accuracy |
|---|---|
| Request routing, 20 mixed English/Persian messages | 20 / 20 |
| Destructive-command detection, 16 commands | 14 / 16 (missed `git checkout -- .` at 0.07 and a secret-exfiltration pipe at 0.34) |
| Task-completion / asks-user judgment, 7 cases (en + fa) | 7 / 7 |
| Garbled-answer detection (digit runs, glued duplicates, leaked tags, repetition; en + fa) | 8 / 8 |
| Language detection (fa/en/ru/zh/other) | 7 / 7 |
| Search re-ranking (5 candidates) | top-2 correct |
| Salvage path selection | 2 / 2, confidence 1.0 |

Known limits of System One models: they do not generate text, count, do arithmetic or
compare dates reliably; instructions are read literally; English is the primary
language (Persian worked well in these tests, but verify on your own content). Keep
the arithmetic in code and the judgment narrow.

## Module

`src/core/judge.js` — `enabled()`, `status()`, `ask(state, questions, opts)`,
`intent(message, recent)`, `commandRisk(command, cwd)`, `answerCheck({ request, answer, actions })`,
`rerank(query, results)`, `pickPath({ conversation, contentHead, candidates })`, `test(creds)`.
