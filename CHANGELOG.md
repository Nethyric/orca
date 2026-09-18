# Changelog

All notable changes to ORCA are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.0.4] — 2026-09-18

### Added
- **macOS and Linux builds.** Every release now ships `ORCA-Agent-<version>-mac-{x64,arm64}.{dmg,zip}` and `ORCA-Agent-<version>-linux-x64.{AppImage,tar.gz}` next to the Windows zip, built in parallel by the release workflow with one merged `SHA256SUMS`. Platform binaries (`ffmpeg`, `yt-dlp`) are bundled per target; `npm run dist:mac` / `dist:linux`; `scripts/fetch-bins.js` takes `ORCA_TARGET`/`ORCA_ARCH`.
- **Live preview** (right panel → Preview): HTML pages the agent writes open inside the app in a browser-style frame with **phone (390×844) / tablet (820×1180) / desktop** presets, rotate, reload, **full-window** mode (Esc to leave) and open-in-browser. Device frames render at real device width and scale to the panel. After `scaffold_site` or a write to `index.html` the preview opens by itself.
- **Help center** (rail → Help, `F1`, `/help`, command palette): getting started, modes and autonomy levels, slash commands and shortcuts, about/privacy/updates — in all four UI languages. The chat `/help` reply is rewritten to match.
- **Fourth built-in model — Glimmer 30B** (`glimmer`, tier *vision*): a vision-capable model that reads photos, screenshots and UI mock-ups. It is also used as the built-in **vision engine**, so `view_image` and image attachments get a real visual description out of the box (previously OCR only unless a key was added). Free-tier rate limits (5 requests/min, 200/day) are respected automatically: the pool honours `Retry-After` and daily-quota headers and rests the key until the limit clears instead of hammering it.
- Additional built-in upstreams for MiniMax M2.7 and DeepSeek V4 Flash on a second gateway — the rotation now spans two independent providers, so a single-provider outage no longer takes the built-in models down.
- **Decision engine in the provider editor**: Settings → Models → Add provider now lists *Decision engine — System One (TypeSafe)*; picking it shows what it is (typed judgments, not a chat model), pre-fills URL and model, tests the key and saves to the same setting as Settings → Agent.
- Provider catalog: the gateway used by the built-in pool is listed as a regular provider (bring your own key). For gateways that publish a public `/models` endpoint, the model picker is filled live with pricing, context and capability flags; free models are listed first. `ROUTEWAY_API_KEY` is recognised.
- `ORCA_DEBUG=1` prints one line per model call (model, host, latency, finish reason, sizes, tool calls) to stderr.

### Changed
- **Update banner** redesigned: a floating pill with an animated update glyph, download progress, close button; the installed/latest state in Settings → Updates uses the same language. On macOS and Linux the button reads *Install*; after verification the package is revealed in the file manager (Linux AppImage replaces itself in place and relaunches, like Windows).
- Updater picks the asset for the running OS **and CPU** (`mac-arm64` vs `mac-x64`, AppImage vs tar.gz) and verifies it against the merged `SHA256SUMS`.
- All outbound model/gateway requests send a product `User-Agent`; some edge filters reject bare clients with 403.
- Model catalog discovery keeps `pricing`, `capabilities` and `available` from gateway responses; unavailable models are hidden.
- Vision descriptions tolerate reasoning models (larger budget, `<think>` stripped, reasoning used when the answer was cut).

### Fixed
- Empty assistant turns are no longer sent back to strict gateways (`Invalid assistant message: provide non-whitespace content`) — the retry after an empty answer now carries a placeholder.
- `Escape` closes the full-window preview before it stops a running task.

## [0.0.3] — 2026-09-18

### Added
- **Decision engine** (optional, Settings → Agent): ORCA can consult a System One model — typed yes/no, choice and score judgments in ~0.2 s, output tokens free — for the decisions plain code makes badly: what kind of request a message is (auto-routing without the keyword list), whether a shell command is destructive (semantic review on top of the regex, escalates to an approval), whether the final answer is garbled / only a promise / in the wrong language (regenerated or completed before it is shown), how relevant each web result is (re-ranked), and which file a cut-off write was meant for. Bring your own key; it stays on the device and is never part of the vault or the repository. Every call fails open with a short timeout, so nothing depends on it. See `docs/decision-engine.md`.
- **Live capability report** in the system prompt: "what can you do?" is answered from a check of this installation (connected models, Python/Chrome/ffmpeg/yt-dlp presence, vision/image/video engines, decision engine, step limits) — concrete, grouped, honest about what is off and how to enable it — instead of a generic list.
- **`scaffold_site` tool**: a complete responsive multi-page website skeleton in one call (design tokens, shared `main.js` with nav/cart/forms/data loader, one HTML+JS per page, `data/*.js|json`, README; RTL for Persian/Arabic; page kinds inferred from titles in en/fa/ru/zh). The model then spends its output budget on real content instead of boilerplate; every placeholder is a countable `TODO` marker.
- Provider outage handling: when every built-in model answers 5xx, the sweep stops after ~15 s (instead of a minute of "busy" retries) with a clear localized message that the provider is down and how to work around it.
- Big-project playbook in the prompt: multi-page sites, shops and dashboards are scaffolded from a todo list (shared design tokens, one file per page/module, JSON data), written in ≤100-line chunks, every page verified with `browser_check`, finished with a project map.
- `GET /api/health` reports `bins.chrome` and `judge`; `GET /api/judge/status`, `POST /api/judge/test`; SSE `verdict` event and `judged` on `tool_call`/`approval`.

### Changed
- Auto mode turns **Web mode** on by itself for research-type questions (news, "is X released yet", prices, comparisons, anything that needs today's facts), so the answer is searched and sourced without flipping the toggle.
- `git checkout -- …`, `git restore`, `git reset --hard`, `git clean -f` and similar tree-rewriting git commands count as destructive (approval in Ask and Auto modes), like `rm -rf`.
- Step budget stretches for big builds: while the recent steps keep writing files successfully, the limit grows (up to twice) instead of stopping a multi-page site halfway.
- The language check never rewrites an answer when the user's rules, persona or notes ask for a specific language.

### Fixed
- A model call can no longer hang a step for minutes: hard 90 s budget per call, 15 s connect timeout on retry sweeps, and models that go silent count toward outage detection.
- A stream that the provider drops a few characters into a tool call is retried on the next key/model instead of being reported to the model as a "truncated call" it then repeats.

## [0.0.2] — 2026-09-17

### Fixed
- The agent now answers identity questions correctly (maker Nethyric, version, GitHub repository, issue tracker, license) instantly and without tools, and knows the current date and time (with timezone).
- Long answers no longer end truncated: output-cap cuts are continued automatically and stitched into one message (fences, lists and partial lines survive the seam); a stream that dies mid-answer is resumed instead of shown half-empty.
- Very long pasted inputs (tens of kilobytes) no longer make the model loop re-typing the text: they are saved to `attachments/paste-*.txt` and processed from the file. A 33 KB paste went from >10 minutes to ~12 s.
- Degenerate outputs ("Paris.Paris.Paris…", repeated sentences, a bare run of digits, garbled tool XML in the text) are detected; repetition loops are cut early (≤900 characters instead of the full 4k token budget) and the answer is re-asked from another model when possible.
- Tool calls that some models write as XML inside the text (DeepSeek "DSML" markup) are parsed and executed instead of being shown as gibberish.
- Rate-limit handling: per-key cooldowns for 429/503, dead keys (401/402/403) rested for hours across all aliases, and a busy-sweep backoff replaces the previous "All models failed" error after a single pass. Reconnect timeouts shortened (25 s first attempt, 15 s afterwards).
- Half-streamed answers on Stop/error keep their text and offer **Continue** / **Retry**; answers interrupted by a crash are marked on next start.
- Edit/Retry on a user message ignores internal hidden turns; deleting a user message also removes its answers.
- Chat list, timeline and pins render defensively when a chat file lacks optional fields.
- Doubled opening words ("Paris.Paris. The capital…"), an answer written twice back-to-back, and process narration ("The user asked… I'll answer concisely") are removed from final answers.
- Runaway tool calls: when a model streams a huge `write_file` (content first, path last) and the gateway closes the stream after ~300 s, the arguments were unusable and the model retried the same call for 20+ minutes. The stream is now cut client-side at 24 KB, complete lines are saved to the named (or inferred) file, and the model is told to continue with `append`; tool calls are limited to ~5 000 characters each.
- A gateway time-limit reported as a normal `stop` (long answer ending inside an open code block or mid-sentence after ~5 min) is treated as a cut and continued automatically.
- Slow pool nodes: about one built-in request in four used to land on a node streaming ~13 tokens/s (a 4k-token answer took 5 minutes). The first seconds of every built-in stream are measured and a crawling request is re-issued once, which almost always lands on a fast node (80–150 tokens/s).
- A cut `write_file` whose `path` never arrived is saved under the file name the conversation asked for (e.g. "save it as docs/x.md"), and a cut continuation with `append: true` is appended, never overwritten.

### Added
- **Pin messages** — pinned messages are re-injected into every following prompt so decisions stay binding.
- **Per-chat notes** panel that the agent always sees.
- **Branch** a chat from any message; **delete** single messages.
- **Message queue** — type while the agent works; queued messages are sent when the current answer finishes.
- **Web mode** toggle — research first, answer with inline sources.
- **Syntax check after every write/edit** (`node --check`, `py_compile`, `JSON.parse`) reported to the model with the tool result.
- **Project memory** template with *Decided / Inferred / Tried and failed / Current state* sections and prompt rules to keep it current.
- Elapsed time and token usage per answer; `~` marks estimated usage.
- Very long answers fold with a **Show more** bar; streaming render rate adapts to the answer length; code highlighting runs once, at the end.
- Loop guard for identical successful tool calls; quieter status lines (one per model per reason).
- Test suite: `node test/stream.test.js` (fake SSE provider exercising unterminated thinking, cuts, fake stops, runaway tool calls, loops, nested tags).
- Three more built-in keys in the vault.

### API
- `POST /api/send` accepts `continueFrom` and `webMode`.
- New: `POST|DELETE /api/chats/:id/messages/:mid`, `POST /api/chats/:id/fork`, `GET /api/chats/:id/pinned`, `POST /api/chats/:id { notes, tags }`.
- Messages carry `tookMs`, `pinned`, `partial`, `interrupted`, `hidden`, `pastedPath`; `usage` may carry `estimated`.

## [0.0.1] — 2026-09-16

First public release.
