<p align="center">
  <img src="assets/logo.png" alt="ORCA" width="120">
</p>

<h1 align="center">ORCA</h1>

<p align="center">
  The open-source autonomous AI agent for your desktop. Bring any model — or none.
</p>

<p align="center">
  <a href="https://github.com/Nethyric/orca/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/Nethyric/orca?style=flat-square&color=5e6ad2"></a>
  <a href="https://github.com/Nethyric/orca/actions/workflows/release.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/Nethyric/orca/release.yml?style=flat-square"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <a href="https://github.com/Nethyric/orca/releases/latest"><img alt="Downloads" src="https://img.shields.io/github/downloads/Nethyric/orca/total?style=flat-square"></a>
</p>

<p align="center">
  <a href="#installation">Installation</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/providers.md">Providers</a> ·
  <a href="docs/api.md">API</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="docs/README.fa.md">فارسی</a>
</p>

<p align="center">
  <b>English</b> · <a href="README.ru.md">Русский</a> · <a href="README.zh.md">中文</a> · <a href="docs/README.fa.md">فارسی</a> ·
  <a href="https://nethyric.github.io/orca/">Documentation site</a>
</p>

---

ORCA is a desktop agent that plans, writes code, runs it, reads the errors and fixes them — on your machine, in your files. It ships with built-in models that work out of the box, and connects to 200+ providers or any OpenAI‑compatible endpoint with your own key.

- **Autonomous by default.** 46 real tools: shell, Node/Python, file editing, web search, HTTP, headless-browser checks, Office documents, media, OCR, image and video generation, background processes, sub‑agents. Build requests are built first, with sensible defaults — a question is asked only when something genuinely blocks the work (a bot token), and only after the code exists.
- **Any model.** Built-in models with automatic failover, plus your own providers (cloud or local). Keys never leave your device.
- **Builds whole sites.** The model writes the content — texts, items, prices, FAQ, testimonials — and `scaffold_site` renders it into a finished, modern multi-page site in one step (design tokens, dark/light, hero, cards, stats, catalog with filters and cart, validated forms, RTL when needed), then every page is verified in a headless browser. No placeholders, no half-built pages.
- **Runs what it builds.** Bots, dev servers and workers start as background processes that survive across turns, with a live log, detected ports and a Stop button in the Processes panel. Image and video generation plug into any Images API / Videos API provider (OpenAI, Routeway, Together, xAI, Sora, Replicate, fal.ai) with a Test button in Settings.
- **Knows what it can do.** Ask "what can you do?" and the answer is generated from a live capability check of your installation — connected models, present binaries, enabled engines — not from a canned list.
- **Decision engine (optional).** Plug in a System One model and ORCA gets calibrated judgments in ~0.2 s: smarter auto-routing, semantic command-risk review, verification of every answer (garbled, promised-but-not-done, wrong language), re-ranked web results.
- **Three ways to chat.** Direct, side-by-side comparison, or blind battle with a local leaderboard.
- **Checkpoints and diffs.** Every file change is snapshotted; restore any step with one click.
- **Built for long work.** Output caps are continued transparently, long pastes become files, stopped answers can be continued, and pins, notes and branches keep long chats on track.
- **Four languages.** English, Русский, 中文, فارسی — with matching typography.
- **Private.** No accounts, no telemetry. Everything is stored in a local data folder you control.

## Installation

Download the build for your system from [Releases](https://github.com/Nethyric/orca/releases/latest):

| Platform | File | Run |
|---|---|---|
| Windows 10/11 x64 | `ORCA-Agent-<version>-win-x64.zip` | extract, run `ORCA.exe` (portable, no admin rights) |
| macOS 12+ (Apple Silicon) | `ORCA-Agent-<version>-mac-arm64.dmg` / `.zip` | drag to Applications; first launch: right-click → Open |
| macOS 12+ (Intel) | `ORCA-Agent-<version>-mac-x64.dmg` / `.zip` | same |
| Linux x64 | `ORCA-Agent-<version>-linux-x64.AppImage` / `.tar.gz` / `.deb` | `chmod +x` and run, or `sudo apt install ./ORCA-Agent-*.deb` |

Builds are not code-signed; `SHA256SUMS` is attached to every release. The app updates itself: it checks the release channel, downloads the package for your OS/CPU in the background (resumable, mirrors when GitHub is blocked), verifies the SHA-256 and installs it on restart — no browser needed (Settings → Updates).

**From source** (Windows, macOS, Linux):

```bash
git clone https://github.com/Nethyric/orca.git
cd orca
npm install
npm start          # desktop app
npm run web        # or: browser UI at http://localhost:7860
```

> [!TIP]
> Built-in models work immediately in release builds. A source checkout has no vault key, so add a provider in **Settings → Models** (or set `ORCA_VAULT_KEY` if you are the maintainer). See [docs/setup.md](docs/setup.md).

## MCP (Model Context Protocol)

ORCA ships a minimal, dependency-free MCP client: connect external tool servers from Settings → MCP
(or paste a Claude Desktop `mcpServers` config as-is). Both transports are supported — `stdio`
(local subprocess) and Streamable HTTP (with a legacy SSE fallback). Servers spawn lazily and
reconnect quietly; every result is treated as untrusted content, tool manifests are fingerprinted
to detect silent redefinition, and each tool can be toggled per server. Use `compact` mode to keep
a server's schemas out of the context until the agent discovers them on demand.

## Providers

Open **Settings → Models → Add provider**, pick a provider from the catalog (or *Custom* for any OpenAI-compatible URL), paste a key, press **Discover** to list its models, **Test**, **Save**. Keys are stored only in your local `config.json`.

Anthropic-style and OpenAI-style APIs are both supported, as are local servers (Ollama, LM Studio, vLLM, llama.cpp). Full guide: [docs/providers.md](docs/providers.md).

## Documentation

| | |
|---|---|
| **[Documentation site](https://nethyric.github.io/orca/)** | The same guides, rendered — with search and dark mode |
| [Overview](docs/README.md) | What ORCA is, how a run works, the UI |
| [Setup](docs/setup.md) | Install, build from source, data folder, environment variables |
| [Configuration](docs/configuration.md) | Every `config.json` key, rules, persona, autonomy |
| [Providers](docs/providers.md) | Adding providers and models, local models, troubleshooting keys |
| [Tools](docs/tools.md) | Reference for all 46 agent tools |
| [HTTP API](docs/api.md) | The local REST + SSE API used by the UI (and usable by scripts) |
| [Built-in models & the vault](docs/vault.md) | How built-in keys are shipped, rotated and protected |
| [Decision engine](docs/decision-engine.md) | Optional System One model for routing, command-risk review, answer verification and search re-ranking |
| [MCP](docs/mcp.md) | Connecting external tool servers (stdio / HTTP, presets, security) |
| [Updates & releases](docs/updates.md) | How self-update works, the release feed, manual installs |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and fixes |
| [Security](SECURITY.md) | Threat model, reporting |

## Building ORCA

```bash
npm run fetch-bins   # ffmpeg, yt-dlp, OCR data (not in git)
npm run dist:win     # release/ORCA-Agent-<version>-win-x64.zip
npm run dist:mac     # release/ORCA-Agent-<version>-mac-{x64,arm64}.{zip,dmg}   (on macOS)
npm run dist:linux   # release/ORCA-Agent-<version>-linux-x64.{AppImage,tar.gz,deb}
```

Releases are built by GitHub Actions on every `v*` tag. Maintainers: see [docs/setup.md#maintainers](docs/setup.md#maintainers) for the release and key-rotation workflows.

## Contributing

Issues and pull requests are welcome. Please read [SECURITY.md](SECURITY.md) before reporting anything key-related, and open a [bug report](.github/ISSUE_TEMPLATE/bug.yml) with the ORCA version and the log excerpt.

## License

[MIT](LICENSE) © Nethyric
