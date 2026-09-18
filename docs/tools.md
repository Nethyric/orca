# Tools

The agent can call the tools below. Every call is shown in the chat as a step card (arguments, duration, result) and, where files change, produces a checkpoint. Risk levels drive the approval prompts described in [configuration.md#autonomy](configuration.md#autonomy): `none` never asks, `low` asks in *Ask* mode, `medium` asks in *Ask* mode, `high` asks in *Ask* and *Auto*. `run_shell` is `medium` normally and `high` when the command matches a destructive pattern.

All paths are relative to the workspace unless absolute. Tools cannot touch files outside the workspace, except `run_shell` (which runs with your user's permissions — that is what the risk levels are for).

Parameters marked `*` are required.

## Execution

### `run_shell`

Run a shell command inside the workspace folder (cwd). Windows: cmd.exe by default (supports && and ||), PowerShell auto-detected or via shell:"powershell". Linux/macOS: bash. `node` is always available. Use for installing packages, git, running programs, system info.

Risk: `medium`

| Parameter | Type | Description |
|---|---|---|
| `command` * | string |  |
| `timeout` | integer | seconds, default 90 |
| `shell` | string: `auto` `cmd` `powershell` | Windows only |

### `run_node`

Execute a JavaScript (Node.js) snippet and return stdout. Always available, no install needed. Best for math, data processing, quick logic.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `code` * | string |  |
| `timeout` | integer |  |

### `run_python`

Execute a Python 3 snippet and return stdout. Only if Python is installed; otherwise prefer run_node.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `code` * | string |  |
| `timeout` | integer |  |

### `diagnostics`

Syntax-check JS/Python/JSON files (whole workspace or a path) and list problems with line numbers. Run after writing code.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `path` | string |  |

## Files

### `read_file`

Read a workspace file (optionally a line range).

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `offset` | integer | start line (0-based) |
| `limit` | integer | max lines, default 400 |

### `write_file`

Create or overwrite a file in the workspace with full content. Parent folders are created automatically. HARD LIMIT: keep each call under ~5000 characters (≈100 lines of code, ≈50 lines of prose) — for bigger files write the first part, then continue with append=true in further calls, or split the code into several small modules.

If a model streams a bigger call anyway, ORCA cuts the stream at 24 KB of arguments, saves every complete line it received (to the given path, or — when the model sent `content` before `path` — to a file named after the request or the first heading) and tells the model to continue with `append: true`.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `content` * | string |  |
| `append` | boolean | true = append content to the end of the existing file instead of overwriting |

### `edit_file`

Precise edit: replace the exact text `old` with `new` in a file. `old` must match exactly (including indentation). Set all=true to replace every occurrence.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `old` * | string |  |
| `new` * | string |  |
| `all` | boolean |  |

### `delete_file`

Delete a file or folder in the workspace.

Risk: `medium`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |

### `list_files`

List files and folders in the workspace (recursive tree).

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `path` | string |  |
| `depth` | integer |  |

### `glob`

Find files by glob pattern (e.g. **/*.py, src/**/*.test.js), newest first.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `pattern` * | string |  |
| `path` | string |  |
| `limit` | integer |  |

### `grep`

Fast regex search across file contents with optional glob filter and context lines. Prefer this over run_shell grep.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `pattern` * | string |  |
| `path` | string |  |
| `glob` | string |  |
| `context` | integer |  |
| `max_results` | integer |  |
| `case_sensitive` | boolean |  |

### `search_files`

Grep: search file contents in the workspace with a regex. Returns file, line number and matching text.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `pattern` * | string |  |
| `path` | string |  |
| `glob` | string | e.g. *.js or src/**/*.py |
| `max_results` | integer |  |

## Web

### `web_search`

Search the live web. Returns titles, URLs and snippets. ALWAYS use for current events, prices, versions, news, or any fact you are not certain about. Then use fetch_page to read the best results.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `query` * | string |  |
| `count` | integer |  |

### `fetch_page`

Download a web page and return its readable text plus links. Use after web_search to read a result in full.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `url` * | string |  |
| `max_chars` | integer |  |

### `http_request`

Make a raw HTTP request (any method, headers, JSON body). Use for APIs.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `url` * | string |  |
| `method` | string |  |
| `headers` | object |  |
| `body` | any |  |

## Browser & vision

### `browser_check`

Load a local HTML file (workspace path) or URL in headless Chrome and report runtime problems: uncaught exceptions, console.error/warn, unhandled promise rejections, broken images, plus page info (title, text excerpt, canvas count) and a screenshot. Optional `keys` (e.g. ["ArrowRight","ArrowRight"," "]) are pressed before the screenshot so games/apps advance. ALWAYS run this after building or changing a web page/app/game, fix every error, re-run until ok:true.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `url` * | string | workspace path like site/index.html or an http(s) URL |
| `keys` | array of string | key names to press in order (KeyboardEvent.key values) |
| `wait_ms` | number | time to let the page run before reporting (default 2500) |
| `width` | number |  |
| `height` | number |  |
| `output` | string | screenshot path (default screenshots/check.png) |

### `screenshot`

Render a URL or local HTML file in headless Chrome/Edge, save a PNG and OCR it — verify web pages you built.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `url` * | string |  |
| `output` | string |  |
| `width` | integer |  |
| `height` | integer |  |
| `full_page` | boolean |  |

### `view_image`

Look at an image (workspace path, absolute path or URL): returns size/format, text read by OCR (English + Persian), and — when a vision model is configured — a full visual description. Use for screenshots, error images, UI mockups, photos the user attached (they are saved under attachments/).

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `question` | string | what to look for |
| `ocr` | boolean |  |
| `languages` | array of string | tesseract langs, default ["eng","fas"] |

### `ocr_image`

Extract text from an image with the built-in OCR engine (no model needed). Languages: eng, fas, rus, chi_sim (default: English + the UI language). Use view_image instead when you also need a visual description.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `languages` | array of string |  |

## Planning, memory & delegation

### `todo_write`

Create/update the visible task checklist for this job (shown live to the user). Call it at the start of multi-step work with all steps, then mark each step in_progress/done as you go. merge=true updates individual items.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `todos` * | array of object |  |
| `merge` | boolean |  |

### `todo_read`

Read the current task checklist.

Risk: `none`

_No parameters._

### `task`

Delegate a self-contained sub-task to a sub-agent with its own fresh context (e.g. "research X and report", "explore the codebase and summarize the architecture", "write and test module Y"). It has the same tools and returns a final report. Use for parallelizable or context-heavy work; call several in one turn to run them in parallel.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `description` * | string | 3-6 word label |
| `prompt` * | string | complete, self-contained instructions |
| `model` | string |  |
| `max_steps` | integer |  |

### `ask_user`

Pause and ask the user one clarifying question with 2-4 short options. The run stops until they answer; the reply arrives as the next user message.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `question` * | string |  |
| `options` | array of string |  |

**Interrogation guard.** On a build request ("build a Telegram bot", "make me a site") a question is only allowed *after* work has been done. An `ask_user` — or a plain-text list of questions — sent before the first successful write/run is not shown to the user; the model gets a tool error telling it to pick sensible defaults and build first (once per run). A genuine blocker such as a bot token is asked for after the code exists. The guard is skipped for sub-agents, plan mode, long specifications (> 1500 characters) and replies to an earlier question.

## Background processes

Long-running programs — bots, dev servers, watchers, workers. `run_shell` kills anything that outlives its timeout; these survive across turns, keep a rolling 96 KB log, expose the TCP ports they open and can be stopped from the **Processes** panel (right side). They are killed when ORCA exits; nothing is restarted automatically.

### `start_process`

Start a program in the background and return immediately with an `id`. The same command in the same folder is not started twice (the running entry is returned instead). Limit: 12 running processes.

Risk: `medium` (`high` when the command matches the dangerous-command list)

| Parameter | Type | Description |
|---|---|---|
| `command` * | string |  |
| `name` | string | Short label shown to the user, e.g. `Telegram bot` |
| `cwd` | string | Workspace-relative folder (default: workspace root) |
| `env` | object | Extra environment variables; secrets belong in a `.env` file when the program supports it |
| `shell` | string: `auto` `cmd` `powershell` | Windows only |

Returns `{ id, name, command, cwd, pid, status, ports, startedAt, note }`. Ports named in the command (`--port 3000`, `http.server 8000`) or printed in the output (`http://localhost:5173`) are probed and listed once they accept connections; the Processes panel shows them as links and the preview can open them.

### `process_output`

Latest log lines plus status. `wait_ms` (max 20 000) blocks until new output, an open port (`wait_for_port: true`) or exit — the normal way to check a freshly started server or bot without polling.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `id` * | string |  |
| `tail` | integer | Lines, default 60 |
| `wait_ms` | integer |  |
| `wait_for_port` | boolean |  |

Returns `{ …summary, log_tail, preview?: ["http://localhost:3000"], note? }` — `note` explains a crash (`exit code 1 — read the log, fix, start again`) or a silent process (buffered output).

### `stop_process`

Stops the whole process tree. Risk: `none`. `{ id }`

### `list_processes`

All processes of this session with status, uptime, ports. Risk: `none`.

HTTP: `GET /api/procs`, `GET /api/procs/:id` (full log), `POST /api/procs/:id/stop`; SSE event `proc` on every status change.

### `remember`

Save a durable note about the user or project to long-term memory (persists across conversations). Use for preferences, facts, decisions.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `note` * | string |  |

### `recall`

Search long-term memory notes.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `query` | string |  |

### `project_init`

Create ORCA.md project memory in the workspace (like AGENTS.md/CLAUDE.md): scanned structure + sections for commands, conventions, decisions. Then fill it in with edit_file. It is loaded automatically in every future chat.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `overwrite` | boolean |  |

### `scaffold_site`

Build a complete, modern multi-page website in one call — no build step, works from `file://` and any static host. The caller supplies the **real content per section**; the tool renders finished pages, so there are no `TODO` placeholders to chase afterwards.

Generated files: `style.css` (design tokens in `:root`, dark/light themes with a toggle, responsive grid, RTL-aware, reveal animations), `main.js` (header/nav/footer rendered from `data/site.js`, inline SVG icon set, theme toggle, mobile menu, `toast()`, `loadData()`, `fmtPrice()`, localStorage cart, form validation, counters, back-to-top), one `<page>.html` + `<page>.js` per page, `data/site.js` (site name, page list, footer), `data/<items>.js|json` for catalogs, `README.md`.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `name` * | string | Site/brand name |
| `pages` * | array | `"Title"` or `{ title, file?, kind?, description?, nav?, sections?, items?, records? }` |
| `dir` | string | Target folder inside the workspace (default `.`) |
| `tagline` | string | Hero fallback and meta description |
| `lang` | string | `en`, `fa`, `ru`, `zh`, `ar` … — UI strings (buttons, form messages, footer) follow it; `fa`/`ar`/`he`/`ur` → `dir="rtl"` |
| `theme` | string: `dark` `light` | Default `dark` |
| `accent` | string: `indigo` `violet` `cyan` `emerald` `amber` `rose` `slate` `gold` `teal` | Accent colour |
| `currency` | string | Shown with numeric prices, e.g. `تومان`, `$`, `€` |
| `logoText` | string | 1-2 letters for the logo mark |
| `footer` | object | `{ about, address, phone, email, hours, social: [{ name, url }], note }` |
| `overwrite` | boolean | Rewrite files that already exist (pages that come with `sections` are always rewritten) |

**Section types** (`pages[].sections[]`, each `{ type, … }`; `alt: true` tints the background, `id` adds an anchor):

| `type` | Fields |
|---|---|
| `hero` | `badge`, `title` (wrap words in `**…**` for the gradient accent), `subtitle`, `primary {label, href}`, `secondary`, `trust []`, `image` or `icon` (split layout) |
| `features` / `services` | `eyebrow`, `title`, `lead`, `items [{ icon | image, title, text, href }]` |
| `stats` | `items [{ value, label }]` — numbers count up on scroll |
| `steps` | `items [{ title, text }]` — numbered |
| `catalog` / `menu` / `products` / `portfolio` / `courses` | `title`, `lead`, `items [{ name, category, price, description, emoji | image, href }]`, `cart: false` to hide the add buttons. Renders category chips, search, add-to-cart. Prices like `۱,۲۰۰,۰۰۰` or `1.200.000 تومان` are normalised to numbers |
| `gallery` | `items [{ image, caption }]` |
| `testimonials` | `items [{ name, role, quote, rating }]` |
| `pricing` | `items [{ name, price, period, text, features [], featured, cta }]` |
| `faq` | `items [{ q, a }]` |
| `cta` | `title`, `text`, `primary` |
| `about` / `text` | `title`, `paragraphs []`, `image` or `icon` (two-column) |
| `team` | `items [{ name, role, bio }]` |
| `contact` / `booking` / `order` | `title`, `lead`, `fields [{ name, label, type, required, minlength, options }]`, `info { address, phone, email, hours }`, `map` (embed URL), `submit`, `success` |
| `cart` | shopping-cart page (quantities, total, checkout to localStorage) |
| `dashboard` | `records []` → KPI cards + table |
| `html` | `html` — raw block |

A section without `type` is inferred from its shape (a `quote` → testimonials, `price` → catalog, `q`/`a` → FAQ …). Pages given only as titles receive sensible default sections in the site language. Calling the tool again with the same `dir` and a subset of pages rewrites just those pages and keeps navigation consistent across the site.

Returns `{ dir, pages: [{ title, file, kind }], written, skipped, todo_markers, complete, next }` — `complete` is `true` when no `TODO` marker remains.

## Office documents

### `write_docx`

Create a Word (.docx) document. Pass `markdown` (headings #, bullets -, numbered 1., tables |a|b|, **bold**, --- page break) OR structured `blocks`. Persian/RTL is auto-detected.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `title` | string |  |
| `markdown` | string |  |
| `blocks` | array of object |  |
| `rtl` | boolean |  |

### `read_docx`

Read a Word .docx file as Markdown text.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |

### `write_xlsx`

Create an Excel (.xlsx) workbook. Each sheet: name + rows (first row = header, bold + filter + frozen). Cells starting with "=" are formulas (e.g. "=B2*C2"). `totals`: columns to SUM at the bottom (e.g. ["C","D"]). `numberFormats`: [{column:"C", format:"#,##0"}]. Compute numbers yourself when possible; use formulas for live sheets.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `sheets` * | array of object |  |
| `rtl` | boolean |  |

### `read_xlsx`

Read an Excel .xlsx or .csv file: sheet names and rows (formulas return their cached results).

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `sheet` | string |  |
| `max_rows` | integer |  |

### `write_pptx`

Create a PowerPoint (.pptx) deck with a designed theme. Title slide (title/subtitle) + slides: {title, bullets[] | text | table[][] | chart{type:bar|line|pie|doughnut, labels[], values[]}, image, notes}. Keep 3-6 bullets per slide.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `title` | string |  |
| `subtitle` | string |  |
| `theme` | string: `dark` `light` |  |
| `slides` * | array of object |  |
| `rtl` | boolean |  |

### `read_pdf`

Extract the text of a PDF file (page count + text).

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |
| `max_chars` | integer |  |

## Media

### `media_info`

Inspect a video/audio file: duration, resolution, fps, codecs, bitrate. Use before editing.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `path` * | string |  |

### `media_edit`

Edit video/audio with the built-in ffmpeg. operation: trim (start/end or duration, "00:01:05" or seconds), convert (by output extension), resize (width/height/scale), compress (quality 18-35, lower=better), extract_audio (→mp3), remove_audio, speed (speed 0.25-4), gif (width,fps), thumbnail (start), frames (fps), text (text/position/font_size/color — burn caption/watermark), crop ("w:h:x:y"), rotate (90/180/270), volume (volume 0-3), normalize_audio, fade (fade_in/fade_out seconds), custom (extra_args). Output goes to `output` (default: <input>.<operation>.<ext>).

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `input` * | string |  |
| `output` | string |  |
| `operation` * | string: `trim` `convert` `resize` `compress` `extract_audio` `remove_audio` `speed` `gif` `thumbnail` `frames` `text` `crop` `rotate` `volume` `normalize_audio` `fade` `custom` |  |
| `start` | string \| number |  |
| `end` | string \| number |  |
| `duration` | string \| number |  |
| `width` | integer |  |
| `height` | integer |  |
| `scale` | number |  |
| `speed` | number |  |
| `volume` | number |  |
| `fps` | number |  |
| `format` | string |  |
| `text` | string |  |
| `font_size` | integer |  |
| `position` | string: `top` `center` `bottom` |  |
| `color` | string |  |
| `crop` | string |  |
| `rotate` | integer |  |
| `mute` | boolean |  |
| `fade_in` | number |  |
| `fade_out` | number |  |
| `quality` | integer |  |
| `bitrate` | string |  |
| `extra_args` | array of string |  |

### `media_concat`

Join several video (or audio) files into one, in order. Fast copy when formats match, otherwise re-encodes to 1280x720.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `inputs` * | array of string |  |
| `output` * | string |  |
| `reencode` | boolean |  |

### `media_from_images`

Make a slideshow video from images (list or folder) with fades and optional background audio.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `images` | array of string |  |
| `folder` | string |  |
| `output` * | string |  |
| `seconds_per_image` | number |  |
| `audio` | string |  |
| `width` | integer |  |
| `height` | integer |  |
| `fade` | number |  |

### `media_subtitles`

Add subtitles from an .srt file to a video: burn=true renders them into the picture, burn=false embeds a soft subtitle track (mp4).

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `input` * | string |  |
| `srt` * | string |  |
| `output` | string |  |
| `burn` | boolean |  |
| `font_size` | integer |  |

## Generation & social

### `generate_image`

Generate — or edit — an image from a text prompt. Provider resolution:

1. **Settings → Agent → Image generation** when set: *Images API* (any OpenAI-compatible `/images/generations` — OpenAI `gpt-image-1`, a gateway with FLUX 2 / Seedream / Imagen / Ideogram / Recraft, Together, xAI, DeepInfra …), a provider from your list, or *Built-in*.
2. *Auto* (default): the first provider you added whose base URL is a known image-capable gateway, otherwise the free built-in service.

Editing (`image`, optional `mask`) needs an Images API provider. Authentication/billing errors from a provider you chose explicitly are reported, never silently swapped for the free service. Files are saved under `generated/` and the result states the provider and model that actually produced them.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `prompt` * | string | English prompts give the best results |
| `output` | string | e.g. `generated/logo.png` |
| `width`, `height` | integer | Default 1024 × 1024 |
| `seed` | integer |  |
| `model` | string | Provider model id (`flux-2-flash`, `gpt-image-1`, `seedream-v4` …); built-in: `flux` \| `turbo` |
| `count` | integer | 1-4 |
| `negative_prompt` | string |  |
| `quality` | string | `low` \| `medium` \| `high` \| `auto` (Images API) |
| `image` | string | Source image to edit (workspace path) |
| `mask` | string | PNG mask for inpainting (transparent = edit here) |

Returns `{ ok, provider, model, files: [{ path, bytes }], prompt, note? }`.

### `generate_video`

Generate a short video from a text prompt, optionally from a start image. With a provider configured in **Settings → Agent → Video generation** — **OpenAI Sora** through the Videos API (`POST /videos` → poll → `/videos/{id}/content`; any compatible base URL), **Replicate** (model predictions) or **fal.ai** (queue) — it produces real text-to-video. *Auto* uses an OpenAI provider from your list when present. Without any key ORCA generates AI key-frames and animates them into an MP4 with ffmpeg (Ken Burns + crossfade) and says so in `note`; the result always names the provider that produced the file.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `prompt` * | string |  |
| `output` | string |  |
| `duration` | number | Seconds, default 5 (Sora: 4-20) |
| `aspect_ratio` | string: `16:9` `9:16` `1:1` |  |
| `image` | string | Optional start image path |
| `model` | string | `sora-2` \| `sora-2-pro` \| a Replicate/fal model id |

Returns `{ ok, provider, model, files: [{ path, bytes }], duration, note? }`; queued jobs return `{ pending: true, id }` when `wait` is false.

### `social_download`

Download videos/photos/audio from Instagram (posts, reels, profiles → latest posts), TikTok (no watermark, photo carousels + sound), X/Twitter (photos + videos), YouTube (videos, Shorts, playlists) and 1800+ other sites. Saves into workspace downloads/<platform>/. For login-walled content pass cookies (browser name or cookies.txt path).

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `url` * | string |  |
| `output_dir` | string | default downloads |
| `quality` | string | best \| 1080 \| 720 \| small |
| `audio_only` | boolean |  |
| `no_watermark` | boolean |  |
| `cookies` | string | "chrome"\|"firefox"\|"edge" or path to cookies.txt |
| `max_items` | integer | max items for playlists/profiles/carousels |

### `social_trending`

Get what is trending right now: TikTok explore/For-You feed (public, by region) or TikTok search; YouTube trending or search; X/Twitter trends; Instagram latest posts of a username. Set download=true to also download the top items.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `platform` | string: `tiktok` `youtube` `x` `instagram` |  |
| `region` | string | US, GB, DE, IR, TR, … (X: country name) |
| `count` | integer |  |
| `query` | string | search keywords (tiktok/youtube) or username (instagram) |
| `download` | boolean |  |
| `max_download` | integer |  |
| `output_dir` | string |  |

