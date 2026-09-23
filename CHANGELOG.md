# Changelog

All notable changes to ORCA are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] — 2026-09-23

### Added
- **Windows installer and single-file portable build.** Releases now ship `ORCA-Setup-<version>-win-x64.exe` (per-user NSIS installer, install folder of your choice) and `ORCA-<version>-win-x64-portable.exe` (one file, runs from anywhere), next to the zip for automated and legacy installs.
- **Kind-aware self-update on Windows.** Installed builds download the next installer and apply it silently on restart; the portable exe replaces its own file and relaunches; legacy folder installs keep the proven folder swap. Every path remains SHA-256 verified against `SHA256SUMS`.

### Changed
- Windows packages are built on a native Windows runner, so icons and version resources are embedded by the toolchain itself. macOS and Linux pipelines are unchanged.

## [0.0.9] — 2026-09-23

### Added
- **MCP (Model Context Protocol) client.** Connect external tool servers from Settings → MCP over `stdio` or Streamable HTTP (with a legacy SSE fallback), import a Claude Desktop `mcpServers` config as-is, or add a ready-made preset (Filesystem, Fetch, Git, GitHub, Memory, Brave Search, Playwright, Hugging Face) in one click. Servers spawn lazily, reconnect quietly, expose per-tool toggles, and can run in `compact` mode so their schemas stay out of the context until needed. Tool manifests are fingerprinted to detect silent redefinition, and every MCP result is treated as untrusted content.
- **Documentation website** at [nethyric.github.io/orca](https://nethyric.github.io/orca/), published automatically from this repository.
- New guides: [MCP](docs/mcp.md) and [Updates & releases](docs/updates.md).
- `.deb` package for Linux x64, alongside the AppImage and tar.gz.

### Changed
- **Editing tools are now atomic and precise.** `edit_file` matches with whitespace-tolerant fuzzy search, applies multi-file edits all-or-nothing, verifies syntax after every write (and restores the file if the result does not parse), reports `code_refs` and `failing_at` for tests, and discovers `related_tests` for the files it touches. `grep` supports whole-word matching, and the repository map focuses the model on the symbols that matter.
- **The coding loop** plans first, edits in small verified steps, runs the project's tests after changes, and keeps going until they pass.
- **Provider editor rebuilt** around a searchable, themed picker with real provider branding (logo, base URL, get-a-key link, model discovery, connection test); custom providers can carry their own logo via a URL, with a monogram fallback.
- **Single brand mark per message**, shown everywhere models appear (chat, model picker, provider list, settings).
- Copy/paste now works across every text surface of the UI (code blocks, diffs, tool results, chat), and live edits render as professional diff cards.
- The language setting lives in exactly one place (Settings → General) with a segmented control for English, فارسی, Русский and 中文.
- Release pipeline: macOS builds are produced per architecture (x64 and arm64) with matching bundled binaries, and release notes are generated from this changelog.

### Tests
- New suites: `mcp.test.js` (client, presets, transport fallback), `coding.test.js` (edit engine, multi-edit atomicity, test discovery), `stress.test.js` (an end-to-end engineering exercise: ORCA builds and debugs a chess engine to exact perft counts through its real coding stack). Full chain: 8 suites, all green.

## [0.0.8] — 2026-09-19

### Security
- **Isolated preview origin.** The Live Preview no longer runs agent-generated HTML on the app's own origin. Previews are served from a dedicated loopback port that exposes **only static workspace files** — no `/api`, no injected token, nothing else. A previewed page can therefore no longer read `window.__ORCA_TOKEN__` or call the local API (previously, a crafted page opened in the preview could take over the agent: write files, read all chats and config, plant memory). If the preview origin is unavailable, the UI falls back to a locked-down sandbox without `allow-same-origin`.
- **No shell in the syntax check.** The post-write diagnostics ran `execSync` through a shell with the (model-controlled) file name interpolated — a filename like `x$(cmd).js` executed arbitrary commands, and `write_file` needs no confirmation in `auto` mode. The check now uses `execFileSync` with argument arrays (no shell).
- **Updates require a trusted checksum.** A package for which no external SHA-256 could be obtained is now **refused outright** instead of being marked "ready (unverified)". `SHA256SUMS` is only fetched from the official release source — public mirrors may still carry the (verified) bytes, but can never define what counts as valid; release discovery via mirrors was removed for the same reason.
- **Sub-agents can no longer bypass approvals.** The delegated `task` sub-agent previously ran at full autonomy regardless of the user's autonomy setting. High-risk calls inside a sub-agent are now denied outright (a sub-agent cannot ask the user), the decision engine's command-risk review applies to sub-agents as well, and starting a `task` in `auto` mode asks for one confirmation like `run_shell`.
- **Stronger command-risk denylist.** Catches `rm -r -f` / `rm -fr` flag splits, `git push -f`, `find … -exec`, any `… | sh` pipe, and `base64 -d … | sh`, without flagging benign commands (`git push origin main`, `echo … | sha256sum`, …).
- **pptx reader stays in the workspace.** `GET /api/workspace/office` for `.pptx` now validates the path against the workspace like every other read tool (it previously allowed `../../` traversal).
- **Request bodies are size-capped** (50 MB) on the local API.

### Added
- `test/hardening.test.js` — regression tests for every fix above (filename injection, pptx traversal, sub-agent policy, denylist shapes, preview-origin isolation), wired into `npm test`.

## [0.0.7] — 2026-09-18

### Security
- **The local API is now authenticated.** Every `/api/*` request must carry a per-install token (random 64-hex, stored `0600` in the data folder) as `x-orca-token`, `Authorization: Bearer`, or `?token=` (for the event stream). The token is injected into the served page, so the app UI is unchanged. A malicious website open in the user's browser can no longer read chats, config, or run the agent.
- **Wildcard CORS removed.** Responses no longer send `Access-Control-Allow-Origin: *`, and the `OPTIONS` preflight answers with no allow-headers, so browsers block every cross-origin call. Cross-origin requests (a foreign `Origin`) and non-loopback `Host` headers (DNS rebinding) are answered with `403`. Loopback `Origin`s (the app itself) still work.
- **Safer default autonomy.** New installs start in `ask` mode, and existing installs are reset to `ask` once (a later explicit choice is respected). In `auto` mode, `run_shell`/`start_process` commands now still require one confirmation unless the user approved that exact command for the session — a new **“Allow for this session”** button does exactly that.
- **Prompt-injection guard.** The system prompt tells the model that content from `web_search`, `fetch_page`, `http_request`, and files is untrusted data, never instructions; those tool results are also marked `untrusted`.
- **Vault upstream allow-list.** A new `vault.json` can no longer redirect model traffic to an unknown host even if the repository is compromised; only known provider hosts (and localhost) are accepted, others are dropped with a warning.
- **Stronger shell risk triage.** The denylist now also catches `curl|wget … | sh`, `find -delete`, `os.system`, `shutil.rmtree`, `eval(base64…)`, `Invoke-Expression`, `icacls … Everyone`, `schtasks /create`, `regsvr32 /s http…`, `xargs rm -rf`, and redirects into `/etc/passwd|shadow|sudoers` or `/dev/sd*`.

### Added
- **Official Brave Search API support.** Set `braveApiKey` in the config and `web_search` uses the stable `api.search.brave.com` API instead of scraping (scraping remains the fallback).
- **`test/security.test.js`** — 11 regression checks for the token, CORS, rebinding, and token injection, wired into `npm test`.

## [0.0.6] — 2026-09-18

### Changed
- **Self-update that needs no browser and no GitHub.** The updater was rebuilt end to end:
  - **Install on every platform inside the app.** Windows swaps the portable folder and relaunches (PowerShell helper with `cmd` fallback; robocopy when a rename is refused; the previous folder is restored if the swap fails). **macOS now replaces the `.app` bundle in place** (built-in zip reader that keeps symlinks and modes, quarantine flag cleared, app reopened) instead of revealing the download. Linux AppImage replaces itself; **Linux tar.gz now swaps the app folder** and relaunches. User data lives in the data folder and is never touched.
  - **Resumable, mirrored, verified downloads.** Interrupted downloads continue with `Range`; when `github.com` does not answer, public mirrors are tried (every byte is still checked against the release's SHA-256 digest / `SHA256SUMS`, so a mirror cannot substitute a file); a stalled connection (no bytes for 45 s) moves on to the next source; a mismatching file is discarded with a clear message. **Cancel** keeps the partial file.
  - **Background download.** With *Download updates in the background* (default on, packaged builds only) the new version is fetched and verified while you work; the banner then only asks for **Restart & install**. A package downloaded in a previous session is recognised on start.
  - **Honest states everywhere.** Banner and Settings → Updates share one state machine: available → downloading (MB, speed, ETA, *via mirror*) → verifying → downloaded · verified → installing → restarting, plus *download failed* / *install failed* with **Retry** and *Open download page* as a last resort. The next start shows *Updated to ORCA x.y.z* — or that the update could not be installed and the previous version was kept. Release notes are the version's CHANGELOG section (the release body used to be a bare compare link).
  - **Works when the GitHub API is blocked or rate-limited**: the release is discovered through the `latest` redirect and `SHA256SUMS` (also via mirrors); notes come from `CHANGELOG.md` via raw/jsDelivr.
  - Source checkouts and web mode (`npm start`, `node src/server.js`) are detected (`kind: dev`): the package is downloaded, verified and revealed; the UI says so instead of promising a one-click install.
  - A second **Restart & install** click while the first is running no longer launches a second helper; a damaged pending package is detected before anything is touched.
- Routes: `GET /api/update` gained `kind`, `inApp`, `install`, `pending`, `lastInstall`, `download.speed/eta/mirror/phase/verified`; new `POST /api/update/cancel`; `POST /api/update/apply` reports install progress over SSE; `POST /api/update/simulate` accepts `state`. Config: `autoDownload`.
- Tests: `node test/update.test.js` — zip reader (stored/deflate, modes, symlinks, zip-slip), cancel/resume/mirror/verify against a local range-capable server, Windows swap script under real PowerShell, Linux folder swap with real relaunch, damaged/mismatching packages. `npm test` runs it.


## [0.0.5] — 2026-09-18

### Added
- **Background processes.** New tools `start_process`, `process_output`, `stop_process`, `list_processes`: bots, dev servers, watchers and workers now keep running after the agent's turn ends (previously `run_shell` killed them at its timeout). Each process keeps a rolling log, its announced TCP ports are probed and shown as links, and the new **Processes** tab in the right panel lists them with status, uptime, log and a **Stop** button. Everything is killed when ORCA exits. Routes `GET /api/procs`, `GET /api/procs/:id`, `POST /api/procs/:id/stop`; SSE event `proc`.
- **Build-first workflow for bots and services.** "Build a Telegram bot" now produces the complete project (handlers, `requirements.txt`/`package.json`, `.env.example`, `.gitignore`, README, syntax-checked) with sensible defaults, and only then asks for the one thing that is really needed — the token — with two options. When the token arrives it is written to `.env`, dependencies are installed, the bot is started as a background process and its first seconds of log are checked before the agent reports it live.
- **Interrogation guard.** On a build request, an `ask_user` or a plain-text list of questions sent before any work has been done is not shown to the user; the model is told once to decide the defaults itself and build. A real blocker is still asked for after the code exists. Works with every model, no decision engine required.
- **`scaffold_site` v2 — finished sites, not skeletons.** The model passes real content per section (hero, features, stats, steps, catalog/menu with items and prices, gallery, testimonials, pricing, FAQ, CTA, about/text, team, contact/booking forms, cart, dashboard) and gets back complete, modern pages: gradient hero with accent words, glass header, feature cards, animated counters, catalog with category chips + search + cart, validated forms, FAQ accordions, dark/light toggle, reveal-on-scroll, full RTL, per-language UI strings and fonts. Header, navigation and footer are rendered from `data/site.js`, so pages can be added or rewritten in later calls and navigation stays consistent. Section types are inferred when omitted; Persian/Arabic-digit prices are normalised for the cart. The result reports `complete: true` when no placeholder remains; the agent's build rule now requires it and a `browser_check` of every page.
- **Image generation providers.** `generate_image` uses any OpenAI-compatible Images API — OpenAI `gpt-image-1`, gateways with FLUX 2 / Seedream / Imagen / Ideogram / Recraft, Together, xAI, DeepInfra … — including **image editing and inpainting** (`image`, `mask`) via `/images/edits`, `quality`, and a model datalist in Settings. *Auto* picks the first provider you added that is a known image-capable gateway, otherwise the free built-in service. Authentication/billing errors from an explicitly chosen provider are reported instead of silently falling back; the free service's rate limits are backed off properly.
- **Video generation providers.** `generate_video` supports the **OpenAI Videos API (Sora 2 / Sora 2 Pro)** — create, poll, download, text-to-video and image-to-video, any compatible base URL — next to Replicate and fal.ai; *Auto* uses an OpenAI provider from your list when present. Without any key the key-frame animation fallback remains and is labelled as such.
- **Test buttons** for image and video generation in Settings → Agent: generate one small sample with the values in the form (nothing is saved), show provider, model, latency and open the file. Route `POST /api/gen/test`.
- **Decision engine add flow** (Settings → Models → Add provider → Decision engine): four-step how-to in the editor, *Add & activate* button that **verifies the key before saving** (an invalid key is reported inline, nothing is stored), then opens Settings → Agent with the switch on; honest status line (*paste your key first* / *key saved* / *active — checking every run*); filter, discover and manual-add controls are hidden in judge mode; the empty "Add" button in the manual model row now explains itself and Enter adds.
- Model tiers in Settings → Models are translated (*strongest — reasoning & code*, *fastest*, *backup*, *sees images*) instead of showing raw keys.
- Help center: a "Bots & servers" section in all four languages.

### Changed
- System prompt: build defaults and the bots/services workflow; the BIG PROJECTS rule now asks for real content first and one `scaffold_site` call, then verification of every page; "what can you do?" mentions background processes.
- Bot/`telegram`/`discord` requests route to the strong model in auto mode.
- `videoGen` gained `baseUrl`; `imageGen.provider` accepts `builtin` explicitly (`''` now means *auto*).

### Fixed
- Sites generated from title-only page lists no longer contain `TODO` placeholders; incremental `scaffold_site` calls keep the other pages' navigation.
- Duplicate `id` on the manual-add row of the provider editor.


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
