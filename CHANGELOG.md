# Changelog

All notable changes to ORCA are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.2] — 2026-09-17

### Fixed
- The agent now answers identity questions correctly (maker Nethyric, version, GitHub repository, issue tracker, license) instantly and without tools, and knows the current date and time (with timezone).
- Long answers no longer end truncated: output-cap cuts are continued automatically and stitched into one message (fences, lists and partial lines survive the seam); a stream that dies mid-answer is resumed instead of shown half-empty.
- Very long pasted inputs (tens of kilobytes) no longer make the model loop re-typing the text: they are saved to `attachments/paste-*.txt` and processed from the file. A 33 KB paste went from >10 minutes to ~12 s.
- Degenerate outputs ("Paris.Paris.Paris…", repeated sentences, garbled tool XML in the text) are detected; repetition loops are cut early (≤900 characters instead of the full 4k token budget) and the answer is re-asked from another model when possible.
- Tool calls that some models write as XML inside the text (DeepSeek "DSML" markup) are parsed and executed instead of being shown as gibberish.
- Rate-limit handling: per-key cooldowns for 429/503, dead keys (401/402/403) rested for hours across all aliases, and a busy-sweep backoff replaces the previous "All models failed" error after a single pass. Reconnect timeouts shortened (25 s first attempt, 15 s afterwards).
- Half-streamed answers on Stop/error keep their text and offer **Continue** / **Retry**; answers interrupted by a crash are marked on next start.
- Edit/Retry on a user message ignores internal hidden turns; deleting a user message also removes its answers.
- Chat list, timeline and pins render defensively when a chat file lacks optional fields.
- Doubled opening words ("Paris.Paris. The capital…"), an answer written twice back-to-back, and process narration ("The user asked… I'll answer concisely") are removed from final answers.
- Runaway tool calls: when a model streams a huge `write_file` (content first, path last) and the gateway closes the stream after ~300 s, the arguments were unusable and the model retried the same call for 20+ minutes. The stream is now cut client-side at 24 KB, complete lines are saved to the named (or inferred) file, and the model is told to continue with `append`; tool calls are limited to ~5 000 characters each.
- A gateway time-limit reported as a normal `stop` (long answer ending inside an open code block or mid-sentence after ~5 min) is treated as a cut and continued automatically.

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
