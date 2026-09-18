# HTTP API

ORCA's UI talks to a small local HTTP server. The same API is available to your own scripts.

- **Desktop app**: the server listens on `127.0.0.1` on a random port (visible in Settings → Data → *Stats*, or in the window title's dev tools).
- **Web mode** (`npm run web`): `http://127.0.0.1:7860` by default; `PORT` and `HOST` change that.

There is **no authentication**. Anything that can reach the port can run tools with your user's permissions — keep it on loopback (default) or put an authenticating reverse proxy in front.

All request and response bodies are JSON (`content-type: application/json`) unless stated otherwise. Errors use the shape `{ "error": "message" }` with an appropriate status (`400`, `404`, `413`); a few operational endpoints return `200` with `ok:false` so the UI can show the reason inline — this is noted per endpoint. CORS is open (`access-control-allow-origin: *`).

## Contents

- [Health & version](#health--version)
- [Chats](#chats)
- [Sending messages & runs](#sending-messages--runs)
- [Events (SSE)](#events-sse)
- [Approvals, questions & stopping](#approvals-questions--stopping)
- [Uploads & workspace files](#uploads--workspace-files)
- [Checkpoints](#checkpoints)
- [Configuration](#configuration)
- [Providers & models](#providers--models)
- [Vault](#vault)
- [Memory, todos & search](#memory-todos--search)
- [Backup & stats](#backup--stats)
- [Updates](#updates)

---

## Health & version

### `GET /api/health`

```json
{ "ok": true, "version": "0.0.2", "builtin": true, "vault": true, "repo": "Nethyric/orca",
  "tools": ["run_shell", "…"], "electron": false,
  "bins": { "ffmpeg": true, "ytdlp": true, "chrome": true }, "vision": false,
  "judge": { "configured": false, "enabled": false, "model": "jev-latest", "cooling": false, "stats": { "calls": 0, "ok": 0, "failed": 0, "inputTokens": 0, "outputTokens": 0, "avgMs": 0, "lastError": "" } } }
```

`builtin` — the build carries a vault key; `vault` — the vault was fetched and decrypted; `vision` — a vision model is configured; `bins.chrome` — a Chromium browser for `browser_check`/`screenshot` was found; `judge` — state of the optional [decision engine](decision-engine.md).

## Chats

A **chat** is `{ id, title, mode, model, models, createdAt, updatedAt, pinned, notes, tags[], forkedFrom?, messages[], votes[] }`. A **message** is `{ id, role: "user" | "assistant", content, ts, model?, modelKey?, lane?, runId?, status?, events?[], usage?, tookMs?, pinned?, partial?, interrupted?, error?, hidden?, pastedPath? }`. Assistant messages keep their run's event log (`events[] = { event, data, ts }`) so the UI can replay tool cards.

- `status` is `running`, `done`, `question`, `stopped` or `error`. A stopped/errored message with text keeps it (`partial: true`) so the UI can offer **Continue**.
- `hidden: true` marks internal user turns (e.g. the "continue" instruction) that the UI shows as a small note instead of a bubble.
- `pastedPath` is set when a very long paste (> 12 000 characters) was saved to `attachments/paste-<timestamp>.txt` and only a preview was sent inline.
- `usage` may carry `estimated: true` when the provider sent no usage chunk; `tookMs` is wall-clock time from the message creation to its final answer.

| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/chats` | — | `{ chats: [ { id, title, mode, model, models, pinned, tags, hasNotes, pins, forked, createdAt, updatedAt, count, preview } ] }` (index only; pinned first, then newest) |
| `POST /api/chats` | `{ mode?: "direct"|"side"|"battle", title? }` | the created chat |
| `GET /api/chats/:id` | — | the full chat, or `404` |
| `POST /api/chats/:id` | partial chat, e.g. `{ title }`, `{ pinned: true }`, `{ notes: "…" }` or `{ tags: [ … ] }` | the updated chat |
| `POST /api/chats/:id/messages/:mid` | `{ pinned: boolean }` | `{ ok, pinned }` — pin/unpin a message (pinned messages are re-injected into the prompt so they stay binding) |
| `DELETE /api/chats/:id/messages/:mid` | — | `{ ok }` — deletes that message (and, for a user message, the answers it produced) |
| `POST /api/chats/:id/fork` | `{ messageId, title? }` | the new chat: a copy of the conversation up to and including `messageId` (`forkedFrom: { chatId, messageId }`) |
| `GET /api/chats/:id/pinned` | — | `{ pinned: [ { id, role, text, ts } ] }` |
| `DELETE /api/chats/:id` | — | `{ ok: true }` |
| `DELETE /api/chats/all` | — | `{ deleted: n }` |
| `GET /api/chats/:id/export` | — | `text/markdown` attachment |
| `POST /api/chats/:id/vote` | `{ runId, a, b, winner: "a"|"b"|"tie"|"both_bad" }` (`a`/`b` = model labels of the two lanes) | `{ ok, leaderboard }` |
| `GET /api/leaderboard` | — | `{ rows: [ { key, label, wins, losses, ties, elo } ] }` |
| `GET /api/search?q=` | — | `{ hits: [ { chatId, title, msgId, snippet, ts } ] }` |
| `POST /api/compact` | `{ chatId }` | `{ ok, chars, before }` — summarises the history into a brief (`ok:false` + `error` on failure) |

## Sending messages & runs

### `POST /api/send`

```json
{
  "chatId": "mu41…",
  "text": "Build a snake game in games/snake/",
  "mode": "direct",
  "model": "auto",
  "models": ["minimax", "deepseek"],
  "planMode": false,
  "autonomy": "auto",
  "regenerateFrom": null,
  "images": ["attachments/shot.png"],
  "lang": "en"
}
```

| Field | Description |
|---|---|
| `chatId` * | Target chat (create one first) |
| `text` * | User message. Attached files are referenced inline as `<attached_file path="…">…</attached_file>` / `<attached_image path="…"/>` blocks produced by the upload endpoint |
| `mode` | `direct` (one lane) or `side` / `battle` (two lanes). Defaults to `direct` |
| `model` | Model key for `direct`: `auto`, a built-in key, or `<providerId>/<modelId>` |
| `models` | Two keys for `side`/`battle`; falls back to `compareModels` |
| `planMode` | Investigate and propose only; mutating tools are refused |
| `autonomy` | Overrides the configured level for this run |
| `regenerateFrom` | Message id: truncate the chat after it and regenerate |
| `continueFrom` | Id of a stopped/errored assistant message: resume that answer from where it stopped (no `text` needed). The instruction is stored as a `hidden` user turn |
| `webMode` | `true` forces research first (web_search → fetch_page) and answers with inline sources |
| `images` | Workspace paths of images to attach (pre-analysed on upload) |
| `lang` | UI language hint (`en`, `fa`, …) |

Response:

```json
{ "runId": "mu41p1e0rz7bf5", "lanes": [ { "runId": "mu41p1e0rz7bf5", "msgId": "…", "lane": "" } ], "models": ["minimax"] }
```

`lanes` has two entries for `side`/`battle` (`runId` suffixed `:a` / `:b`). Slash commands (`/init`, `/compact`, `/plan`, `/help`) are handled synchronously and answer with `{ runId: null, local: true, msgId, text }`.

The run itself is asynchronous: subscribe to [`/api/events`](#events-sse) before or right after sending and filter by `runId`.

## Events (SSE)

### `GET /api/events`

A single `text/event-stream` carrying every run's events. Each message is `data: <json>` where the JSON is `{ runId, event, data }` (`runId` is the lane run id, e.g. `abc:a`). Keep-alive comments are sent every 20 s.

| `event` | `data` | Meaning |
|---|---|---|
| `status` | `{ text, kind: "thinking"|"retry"|"fallback"|"compact"|"tools", step? }` | Progress line. `retry` also covers busy sweeps ("All models are busy — retrying in 4 s") |
| `delta` | `{ type: "content"|"reasoning"|"reset", text? }` | Streaming tokens; `reset` clears what was streamed (retry/failover) |
| `thought_done` | `{ text }` | Final reasoning text for the step |
| `tool_call` | `{ id, name, args, risk, judged? }` | A tool is about to run (`judged` = destructive probability when the [decision engine](decision-engine.md) escalated the risk) |
| `approval` | `{ id, name, args, risk, judged? }` | Waiting for [`POST /api/approve`](#approvals-questions--stopping) |
| `tool_result` | `{ id, name, ok, ms, result, truncated }` | Tool finished (`result` is a string, max 4000 chars) |
| `checkpoint` | `{ id, path, ts, created, deleted, before, after }` | A file change was snapshotted (`before`/`after` are the full contents, `null` when the file did not exist / was deleted) |
| `files` | `{ tool, files: [path] }` | Output files produced by a tool |
| `todos` | `{ todos: [ { id, text, status } ] }` | Live checklist |
| `sub_event` | `{ runId, event, data }` | Event from a sub-agent (`task` tool) |
| `usage` | `{ prompt_tokens, completion_tokens, estimated? }` | Cumulative token usage (`estimated` when the provider sent none) |
| `question` | `{ id, question, options }` | The agent asks you something; reply with a normal `POST /api/send` |
| `compacted` | `{}` | History was compacted mid-run |
| `verdict` | `{ garbage, promise, done, langMismatch }` | Decision-engine check of the answer (probabilities 0–1); only when the engine is enabled |
| `final` | `{ text, model, modelKey, usage }` | Final answer. Long answers that hit the provider's output cap are continued automatically and stitched — the client only ever sees one `final` |
| `error` | `{ text }` | Fatal error for this lane |
| `stopped` | `{}` | Stopped by the user |
| `done` | `{}` | Lane finished (always last) |
| `title` | `{ chatId, title }` | Auto-generated chat title (no `runId`) |
| `update` | update state (see [Updates](#updates)) | Update check / download progress (no `runId`) |

Minimal client:

```js
const es = new EventSource('http://127.0.0.1:7860/api/events');
es.onmessage = (e) => { const { runId, event, data } = JSON.parse(e.data); if (event === 'final') console.log(data.text); };
const chat = await (await fetch('http://127.0.0.1:7860/api/chats', { method: 'POST', body: '{}' })).json();
await fetch('http://127.0.0.1:7860/api/send', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chatId: chat.id, text: 'List the 5 largest files in the workspace', autonomy: 'yolo' }) });
```

## Approvals, questions & stopping

| Method & path | Body | Response |
|---|---|---|
| `POST /api/approve` | `{ runId, callId, decision: "allow"|"allow_all"|"deny" }` | `{ ok }` — answers an `approval` event; `allow_all` approves the rest of this run |
| `POST /api/stop` | `{ runIds: [ … ] }` or `{ runId }` | `{ stopped: n }` |

Questions from the `ask_user` tool end the run (`final` with `status: "question"` on the message); answer by sending the next message in the same chat.

## Uploads & workspace files

| Method & path | Body / query | Response |
|---|---|---|
| `POST /api/upload?name=<file>` | raw bytes (any `content-type`) | `{ ok, path, bytes, kind: "image"|"file", analysis?, text? }` — saved under `attachments/`; images get `analysis` (`{ width, height, ocr_text, ocr_confidence, vision?, palette }`), small text files return `text` |
| `GET /api/workspace/files?path=` | — | `{ workspace, entries: ["dir/", "dir/file.ext (1234B)", …], truncated }` (depth 6) |
| `GET /api/workspace/file?path=` | — | `{ path, total_lines, offset, content }` (first 5000 lines) |
| `POST /api/workspace/file` | `{ path, content }` | write result (creates a checkpoint) |
| `GET /api/workspace/office?path=` | — | `.docx` / `.xlsx` / `.pptx` / `.pdf` rendered to `{ markdown }` for preview (`{ error }` if unsupported) |
| `GET /ws/<path>` | — | static file from the workspace (with correct `content-type`; used for previews and built sites) |

## Checkpoints

Every mutating file tool records a before/after snapshot.

| Method & path | Body | Response |
|---|---|---|
| `GET /api/chats/:id/checkpoints` | — | `{ checkpoints: [ { id, path, ts, runId, created, deleted } ] }` (oldest first) |
| `POST /api/checkpoints/:ckId` | `{ direction: "before"|"after" }` | restores that file → `{ ok, path, action: "restored"|"deleted" }` or `{ error }` |
| `GET /api/checkpoints/:ckId/diff` | — | `{ id, chatId, runId, path, before, after, ts }` — full contents for diffing |

## Configuration

### `GET /api/config`

Returns the public view of the configuration: everything in `config.json` with secrets masked (`apiKey: "sk-1…ab12"`, plus `keySet: true|false`), and computed fields:

```json
{
  "lang": "en", "defaultModel": "auto", "autonomy": "auto", "…": "…",
  "providers": { "groq": { "name": "Groq", "baseUrl": "…", "apiKey": "gsk_…9f2a", "keySet": true, "models": [ … ] } },
  "models": [ { "key": "auto", "label": "ORCA", "tier": "auto", "builtin": true },
              { "key": "minimax", "label": "MiniMax M2.7", "vendor": "MiniMax", "tier": "strong", "builtin": true, "ready": true },
              { "key": "groq/llama-3.3-70b-versatile", "label": "llama-3.3-70b-versatile", "vendor": "Groq", "builtin": false, "ready": true } ],
  "builtin": true, "version": "0.0.2", "dataDir": "…", "workspaceDir": "…",
  "app": { "name": "ORCA", "company": "Nethyric", "repo": "Nethyric/orca", "homepage": "…" }
}
```

### `POST /api/config`

Partial patch, merged into the current configuration; returns the new public view. Rules:

- Top-level scalars replace; `providers` is merged per id — send `{ "providers": { "groq": null } }` to delete one.
- Provider records: `{ name?, baseUrl, apiKey?, api?, models: [ { id, name?, maxTokens?, toolCall?, reasoning?, attachment? } ] }`. Omit `apiKey` (or send the masked value) to keep the stored key.
- `vision` / `imageGen` / `videoGen` are merged field-by-field with the same key-keeping rule.

All keys are documented in [configuration.md](configuration.md).

## Providers & models

| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/providers/catalog[?refresh=1]` | — | `{ providers: [ { id, name, api, env, count, local, anthropic } ], featured: [ids] }` — the models.dev catalog plus local servers and `custom`, cached for 24 h |
| `GET /api/providers/models?id=<providerId>` | — | `{ api, models: [ { id, name, reasoning, toolCall, attachment, context, output, free } ] }` — catalog models for a provider |
| `POST /api/providers/discover` | `{ baseUrl, apiKey?, api?, id? }` | `{ models: [ { id, name } ], error? }` — asks the endpoint's `/models`. With `id` of a saved provider, its stored key/URL are used when omitted |
| `POST /api/models/test` | `{ key }` **or** `{ baseUrl, apiKey, model, api? }` | `{ ok: true, ms, sample }` or `{ ok: false, status, error, ms }` — a one-token round trip through a configured model key or an arbitrary endpoint |

## Vault

### `GET /api/vault[?refresh=1]`

```json
{ "enabled": true, "ok": true, "source": "https://raw.githubusercontent.com/…/remote/vault.json",
  "fetchedAt": 1789559349816, "issued": "2026-09-16T10:00:00Z", "aliases": ["minimax", "deepseek", "glm"], "keys": 5, "error": "", "disabled": [] }
```

Never returns key material. `refresh=1` forces a re-fetch. See [vault.md](vault.md).

## Decision engine

| Route | Body | Result |
|---|---|---|
| `GET /api/judge/status` | — | `{ configured, enabled, model, cooling, stats }` |
| `POST /api/judge/test` | `{ apiKey?, baseUrl?, model? }` (omitted values fall back to the stored config) | `{ ok, ms, model, sample }` or `{ ok: false, status, error }` |

See [decision-engine.md](decision-engine.md).

## Memory, todos & search

| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/memory` | — | `{ text }` — contents of `memory.md` |
| `POST /api/memory` | `{ text }` | `{ ok }` |
| `GET /api/todos?chatId=` | — | `{ todos: [ { id, text, status: "pending"|"in_progress"|"done" } ] }` |
| `GET /api/search?q=` | — | full-text search over chats |

## Backup & stats

| Method & path | Body | Response |
|---|---|---|
| `GET /api/stats` | — | `{ chats, messages, checkpoints, bytes }` |
| `GET /api/backup` | — | `{ version: 1, exportedAt, chats: [full chats], memory }` |
| `POST /api/backup` | the object above | `{ imported: n }` — restores chats (ids preserved) and memory |

## Updates

| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/update[?force=1]` | — | `{ available, version, latest, url, notes, asset: { name, url, size }, sums, minVersion, mustUpdate, error, checkedAt, download: { …progress }, vault, remote, repo, channel }` |
| `POST /api/update/download` | — | `{ ok }` — progress arrives as `update` SSE events (`{ download: { percent, bytes, total, ready, error } }`) |
| `POST /api/update/apply` | — | `{ restarting: true }` — verifies the hash, swaps the app folder, exits so the launcher restarts (`400` with `error` if not ready) |
| `POST /api/update/dismiss` | `{ version }` | `{ ok }` |
| `POST /api/update/simulate` | `{ version?, notes? }` | dev only (`ORCA_DEV=1`): broadcasts a fake update event |

Update checks call `https://api.github.com/repos/<repo>/releases/latest` (unauthenticated, 60 requests/hour per IP) at most once per 6 hours unless `force=1`.
