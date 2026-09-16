<p align="center"><img src="assets/logo.png" width="120" alt="ORCA"></p>
<h1 align="center">ORCA Agent</h1>
<p align="center">Autonomous multi-model AI agent for your desktop — writes, runs, searches, downloads, generates and debugs, right on your machine.<br>
<b>English</b> · <a href="docs/README.fa.md">فارسی</a> · Русский · 中文 &nbsp;|&nbsp; Windows portable &nbsp;|&nbsp; open source by <a href="https://github.com/Nethyric">Nethyric</a></p>

<p align="center">
<a href="https://github.com/Nethyric/orca/releases/latest"><img alt="Download" src="https://img.shields.io/github/v/release/Nethyric/orca?label=download&style=for-the-badge"></a>
<a href="https://github.com/Nethyric/orca/actions/workflows/release.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/Nethyric/orca/release.yml?style=for-the-badge"></a>
<a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge"></a>
</p>

## Download
**[Latest release →](https://github.com/Nethyric/orca/releases/latest)** — unzip, run `ORCA.exe`. No install, no account, no API key needed.
ORCA checks for new releases on start and offers a one-click update (Settings → Updates).

## How the free models work (no keys in the app)
The app contains **zero API keys**. Built-in models are served through **ORCA Cloud** — a tiny [Cloudflare Worker](gateway/) that holds
provider keys as encrypted secrets, rotates between several keys, auto-disables dead ones and fails over on rate limits.
Refilling quota or swapping providers is a one-line secret change — no new release, nothing visible to users.
You can also add your own providers (OpenRouter, any OpenAI-compatible endpoint) in Settings; those keys stay on your machine.

## Languages & typography
English is the default; the UI auto-detects Persian, Russian and Chinese systems. Each language ships with a tuned font:
Inter (Latin/Cyrillic, variable), Vazirmatn (Persian, RTL layout), Noto Sans SC (Simplified Chinese, subset). OCR reads English + the UI language.

## What it does
| Area | Capabilities |
|---|---|
| **Modes (Arena-style)** | Direct chat · Side-by-side (pick 2 models, run in parallel) · Battle (2 anonymous models → vote → reveal → local Elo leaderboard) |
| **Agent loop** | Streaming, up to 24 tool steps, parallel tool calls, automatic fallback MiniMax → DeepSeek → GLM, retry with backoff, Stop at any time |
| **Tools (40, all real)** | `run_shell` (cmd/PowerShell/bash) · `run_node` · `run_python` · `write_file` · `read_file` · `edit_file` · `delete_file` · `list_files` · `search_files` (grep) · `web_search` (DDG → Bing → Brave → Wikipedia) · `fetch_page` · `http_request` · `remember` / `recall` (long-term memory) · `ask_user` |
| **Safety (Cursor-style)** | Autonomy levels 🔒 Ask / ⚡ Auto (only high-risk asks) / 🚀 YOLO · risk classifier for destructive commands · **checkpoint before every file mutation** with diff view + one-click restore · Plan mode (research → numbered plan → "اجرا کنم؟") |
| **Persistence** | Every message, tool event, checkpoint and vote is written to disk immediately · full-text search across all chats · pin / delete / export Markdown · long-term memory injected into every system prompt |
| **Workspace panel** | Timeline of tool calls · file tree · live HTML preview (served from workspace, scripts + localStorage work) · in-app file editor · Changes tab with unified diffs |
| **Models** | Built-in: MiniMax M2.7, DeepSeek V4 Flash (Dahl), GLM 5.3 (TokenRouter). Add any OpenRouter model (431 listed, tool-capable filtered) or any OpenAI-compatible endpoint from Settings; per-model connection test |

## Run from source
```bash
npm i
npm run fetch-bins   # ffmpeg.exe, yt-dlp.exe, tessdata (not in git)
npm start            # Electron desktop
npm run web          # web mode → http://localhost:7860  (PORT / ORCA_DATA env)
npm run dist:win     # Windows x64 portable zip → release/ (builds on Linux, no wine)
```
Fork it: `npm run set-repo -- YourName/your-repo https://your-gateway.workers.dev` rewrites the repo/gateway everywhere.

## Releasing (maintainers)
Full walkthrough with screenshots-level detail: **[docs/SETUP.md](docs/SETUP.md)**.

1. Bump `version` in `package.json`, commit, `git tag v1.5.1 && git push --tags`.
2. The **Release** workflow builds the Windows zip, writes `SHA256SUMS` and publishes a GitHub Release. Every running ORCA sees the update within 6 h (or on next start).
3. Gateway: push to `gateway/**` or run the **Deploy gateway** workflow. Secrets `UPSTREAMS`, `BUILD_TOKEN`, `ADMIN_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` live in GitHub → Settings → Secrets.
   Out of quota? Edit `UPSTREAMS` (add/replace keys) → re-run the workflow. Done.

## Layout
```
src/main.js          Electron shell (frameless window, loopback server)
src/server.js        HTTP + SSE API, static UI, workspace file server
src/core/agent.js    agentic loop, streaming parser (<think> aware), approvals, plan mode
src/core/tools.js    tool implementations + schemas + risk classifier
src/core/store.js    chats / checkpoints / votes / search (JSON on disk)
src/core/config.js   settings, keys, model registry & fallback order
ui/                  single-page UI (vanilla JS, marked + DOMPurify + highlight.js vendored)
scripts/finish-win.js  embeds icon/version into exe (resedit) and zips the portable build
```

Data lives in `%APPDATA%\ORCA Agent\data` (Windows) or `~/.orca` (web mode): `config.json`, `chats/`, `checkpoints/`, `memory.md`, `workspace/`.


## 1.5.0 — open-source release, ORCA Cloud, 4 languages, auto-update

- **No keys in the app.** All built-in models go through the ORCA Cloud gateway (`gateway/`, Cloudflare Worker, free tier): signed requests, per-IP rate limit, per-install daily budget, key rotation, dead-key auto-disable, streaming passthrough, admin endpoints. Remote config (`/v1/config` + `remote/config.json` on GitHub) can publish notices, a minimum supported version and a new model list without a release.
- **Auto-update.** Checks GitHub Releases (with gateway mirror for blocked networks), shows an in-app banner with release notes, downloads the zip with progress, verifies `SHA256SUMS`, and swaps the portable folder on restart. Settings → Updates.
- **Languages.** English default (auto-detects fa/ru/zh), full UI + agent prompts + plan mode + slash menu in all four; per-language fonts (Inter · Vazirmatn · Noto Sans SC subset); OCR adds `rus`/`chi_sim`.
- **Repo hygiene.** GitHub Actions for release builds and gateway deploys, `scripts/fetch-bins.js` (binaries not in git), `scripts/set-repo.js`, LICENSE (MIT), SECURITY.md, issue template.

## 1.4.0 — images in, media out, deeper agent

- **Image input** — drag-drop, paste (Ctrl+V) or attach screenshots/photos/PDFs/text files. Every image is analysed on upload: size, **OCR (English + Persian, offline via tesseract.js + bundled tessdata)** and a colour/brightness palette; optional full vision through any OpenAI-compatible vision model (OpenRouter has free ones) from Settings → Agent. `view_image` tool for images already in the workspace. Thumbnails render in the thread with a lightbox.
- **Social media downloader** — `social_download` (Instagram posts/reels/profiles, TikTok no-watermark video + photo carousels + sound, X/Twitter photos & videos, YouTube/Shorts/playlists, 1800+ sites through bundled `yt-dlp` + `ffmpeg`; quality/audio-only/cookies for login-walled content) and `social_trending` (TikTok explore/For-You feed by region or search, YouTube trending/search, X trends by country, Instagram latest of a user — with one-shot `download:true`). Files land in `downloads/<platform>/` and show up as a playable **outputs gallery** under the answer.
- **Generation** — `generate_image` (free provider built in; OpenAI gpt-image / OpenRouter Gemini-image with a key; PNG/JPG honoured) and `generate_video` (Replicate / fal.ai text-to-video with a key; without a key: AI key-frames + ffmpeg motion).
- **Agent depth** — `glob`, `grep` (ripgrep-style), `todo_write` (live checklist shown in the thread), `task` (sub-agents with their own context, streamed as nested cards), `diagnostics` (syntax/type check for js/ts/py/json), `project_init` → **`ORCA.md` project memory** (auto-loaded like CLAUDE.md/AGENTS.md), **auto-compaction** of long chats (with `/compact`), slash commands (`/help /init /compact /plan /model /export /files /clear` with an autocomplete menu).
- **Fixes** — primary buttons losing their gradient on hover, slash menu closing while typing, native select arrows, chat titles polluted by attachment blocks, small-quality downloads picking the largest stream, image extension mismatch, TikTok trend regex, IG profile retries, OCR garbage filter.

## 1.3.0 — Office suite + video editing

- **Office tools** (offline, no Microsoft Office needed): `write_docx` (Word from Markdown or blocks, Persian/RTL auto), `read_docx`, `write_xlsx` (formulas, totals, number formats, frozen header, RTL), `read_xlsx` (xlsx/csv), `write_pptx` (designed 16:9 decks with bullets/tables/charts/notes, dark or light theme), `read_pdf`.
- **Media tools** with a bundled **ffmpeg** (`resources/bin/ffmpeg.exe`, gyan.dev essentials 6.1.1): `media_info`, `media_edit` (trim, convert, resize, compress, extract audio, remove audio, speed, GIF, thumbnail, frames, burned text/watermark with Persian shaping via libass + bundled Vazirmatn, crop, rotate, volume, loudness normalize, fades, custom args), `media_concat`, `media_from_images` (slideshow with fades + music), `media_subtitles` (burn or soft-embed .srt).
- Side panel previews **docx / xlsx / pptx / pdf** as rich text/tables, plays **video/audio** (HTTP range requests), and can open the file in Word/Excel/PowerPoint.
- Prompt: office requests produce real files; media edits start with `media_info`.

## 1.2.1 — agent reliability

- **Output-limit resilience**: Dahl caps each turn at ~4k output tokens. ORCA now salvages the complete lines of a cut-off `write_file`, saves them, and tells the model exactly where to continue (`append=true`); truncated tool calls no longer poison the transcript for other models (fixes GLM 400 "invalid JSON arguments").
- `write_file` gained `append`; prompt teaches the model to write ≤100-line chunks / small modules.
- Answers cut by the length limit are continued automatically (up to 2×); "all budget spent thinking" gets a brief-thinking retry.
- **Plan mode auto-exit**: a short confirmation ("اجرا کن", "yes", "go") after a plan turns Plan off and executes; a toast explains Plan mode when it blocks a write.
- Prompt: no opening questionnaires — pick defaults and build; a bare token/number reply counts as the answer; secrets go to config files, never into source.
- Shell timeout is configurable (`shellTimeout`).

## What's new in 1.2 — full UI redesign

- **Design system v3**: Linear/Claude-inspired calm dark UI (near-black canvas, frosted panels), light theme, 6 accent colors, compact density, adjustable text size — all in *Settings → Appearance* or `Ctrl Shift L`.
- **Typography**: bundled Vazirmatn (Persian), Inter Variable, JetBrains Mono. No network needed.
- **Three columns**: history rail (grouped by date, pin, rename, full-text search) · thread · side panel with Timeline / Files / Changes (diff + per-file restore) / live Preview (editable, `Ctrl S`).
- **Command palette** `Ctrl K`: every action + chat search. Shortcut cheat-sheet `Ctrl /`.
- **Composer**: Plan mode, autonomy segment (ask / auto / full-auto), attach or drag-drop files, Enter / Ctrl+Enter send key.
- **Messages**: collapsible reasoning, step cards with timings and output, code blocks with copy/download/open-in-panel, approval cards, model questions, plan actions, per-lane copy / retry / export.
- **Modes**: Chat · Compare (side-by-side) · Battle (anonymous, vote, reveal, local Elo leaderboard).
- **"ORCA" all-purpose model** is the default: it routes each message to the best model (fast for questions, strong for work) with automatic fallback when a provider is at capacity.
- **Agent settings**: reasoning effort, max steps, temperature, shell timeout, *Rules* (like Cursor rules) and *About you* persona injected into every run.
- **Data**: stats, one-click JSON backup / restore of all chats + memory, delete all.
- Desktop notifications when the window is inactive, optional completion sound.

## What's new in 1.1

- New brand: real orca mark (transparent PNG) + multi-size `.ico` (16–256) embedded in `ORCA.exe`
- UI rebuilt: cleaner hierarchy, compact model pickers, custom title bar, responsive down to 640px
- **Auto** model routing: light questions → DeepSeek (fast), real work → MiniMax (strong)
- Parallel tool execution (read-only calls concurrently; file mutations kept in order)
- Loop detector: identical failing action twice → forced change of approach
- Stall watchdog + faster fallback between providers
- Context-window fitting for long conversations (old tool outputs trimmed first)
- Web search: DDG/Bing/Brave raced in parallel (~1s), Wikipedia fallback
- Instant window with splash while the local server boots; single-instance lock
- Interrupted runs are marked `stopped` on restart (no dead spinners)
- gzip + cache headers for static assets; OpenRouter model list cached 6h
- `maxTokens` 8192 for Dahl models (bigger files in one write)
