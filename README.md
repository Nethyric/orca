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
  <a href="docs/README.fa.md">فارسی</a>
</p>

---

ORCA is a desktop agent that plans, writes code, runs it, reads the errors and fixes them — on your machine, in your files. It ships with built-in models that work out of the box, and connects to 200+ providers or any OpenAI‑compatible endpoint with your own key.

- **Autonomous by default.** 41 real tools: shell, Node/Python, file editing, web search, HTTP, headless-browser checks, Office documents, media, OCR, image and video generation, sub‑agents.
- **Any model.** Built-in models with automatic failover, plus your own providers (cloud or local). Keys never leave your device.
- **Three ways to chat.** Direct, side-by-side comparison, or blind battle with a local leaderboard.
- **Checkpoints and diffs.** Every file change is snapshotted; restore any step with one click.
- **Four languages.** English, Русский, 中文, فارسی — with matching typography.
- **Private.** No accounts, no telemetry. Everything is stored in a local data folder you control.

## Installation

**Windows (portable)** — download the latest zip from [Releases](https://github.com/Nethyric/orca/releases/latest), extract it, run `ORCA.exe`. No installer, no admin rights.

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

## Providers

Open **Settings → Models → Add provider**, pick a provider from the catalog (or *Custom* for any OpenAI-compatible URL), paste a key, press **Discover** to list its models, **Test**, **Save**. Keys are stored only in your local `config.json`.

Anthropic-style and OpenAI-style APIs are both supported, as are local servers (Ollama, LM Studio, vLLM, llama.cpp). Full guide: [docs/providers.md](docs/providers.md).

## Documentation

| | |
|---|---|
| [Overview](docs/README.md) | What ORCA is, how a run works, the UI |
| [Setup](docs/setup.md) | Install, build from source, data folder, environment variables |
| [Configuration](docs/configuration.md) | Every `config.json` key, rules, persona, autonomy |
| [Providers](docs/providers.md) | Adding providers and models, local models, troubleshooting keys |
| [Tools](docs/tools.md) | Reference for all 41 agent tools |
| [HTTP API](docs/api.md) | The local REST + SSE API used by the UI (and usable by scripts) |
| [Built-in models & the vault](docs/vault.md) | How built-in keys are shipped, rotated and protected |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and fixes |
| [Security](SECURITY.md) | Threat model, reporting |

## Building ORCA

```bash
npm run fetch-bins   # ffmpeg, yt-dlp, OCR data (not in git)
npm run dist:win     # release/ORCA-Agent-<version>-win-x64.zip
```

Releases are built by GitHub Actions on every `v*` tag. Maintainers: see [docs/setup.md#maintainers](docs/setup.md#maintainers) for the release and key-rotation workflows.

## Contributing

Issues and pull requests are welcome. Please read [SECURITY.md](SECURITY.md) before reporting anything key-related, and open a [bug report](.github/ISSUE_TEMPLATE/bug.yml) with the ORCA version and the log excerpt.

## License

[MIT](LICENSE) © Nethyric
