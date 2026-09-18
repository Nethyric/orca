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

Pause and ask the user a clarifying question when the request is genuinely ambiguous. Provide 2-4 short options when possible. The run stops until they answer.

Risk: `none`

| Parameter | Type | Description |
|---|---|---|
| `question` * | string |  |
| `options` | array of string |  |

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

Generate a complete, responsive multi-page website skeleton in one call: `style.css` with design tokens (`:root` variables for colours, radii, shadow, font), `main.js` (mobile nav, active link, `toast()`, `loadData(name)`, a localStorage `cart`, `<form data-validate>` validation), one HTML + JS file per page with header/nav/hero/sections/footer already wired, `data/<name>.js` + `.json` content files and a README. Pages work from `file://` (no server needed). Page kinds are inferred from the title in English, Persian, Russian or Chinese (home, catalog/shop/menu, cart, contact/booking, about, dashboard) or set explicitly. Every placeholder is a `TODO` marker; the result lists how many remain per file. Persian/Arabic content switches the site to RTL with a matching font stack.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `name` * | string | Site/brand name |
| `pages` * | array | Ordered pages: `"Title"` or `{ title, file?, kind? }` with `kind` in `home` `catalog` `cart` `contact` `about` `dashboard` `generic` |
| `dir` | string | Target folder inside the workspace (default `.`) |
| `tagline` | string | Used in the hero and meta description |
| `lang` | string | Content language code (`en`, `fa`, `ru`, `zh`, …); `fa`/`ar` → `dir="rtl"` |
| `theme` | string: `dark` `light` | Default `dark` |
| `accent` | string: `indigo` `violet` `cyan` `emerald` `amber` `rose` `slate` | Accent colour |
| `overwrite` | boolean | Overwrite existing files (default: existing files are skipped and listed) |

Returns `{ dir, pages: [{ title, file, kind }], written, skipped, todo_markers, next }`.

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

Generate an image from a text prompt (free provider built in; OpenAI/Gemini-image if a key is set in Settings). Saves JPG/PNG into workspace generated/. Write prompts in English for best quality.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `prompt` * | string |  |
| `output` | string | e.g. generated/logo.png |
| `width` | integer |  |
| `height` | integer |  |
| `seed` | integer |  |
| `model` | string | flux (default) \| turbo \| gptimage … |
| `count` | integer | 1-4 |
| `negative_prompt` | string |  |

### `generate_video`

Generate a short video from a text prompt (optionally from an image). With a Replicate or fal.ai key (Settings → Agent) it uses real text-to-video models; without a key it generates AI key-frames and animates them into an MP4 with ffmpeg. Output in workspace generated/.

Risk: `low`

| Parameter | Type | Description |
|---|---|---|
| `prompt` * | string |  |
| `output` | string |  |
| `duration` | number | seconds, default 5 |
| `aspect_ratio` | string: `16:9` `9:16` `1:1` |  |
| `image` | string | optional start image path |
| `model` | string |  |

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

