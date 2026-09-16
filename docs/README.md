# ORCA documentation

ORCA is a desktop AI agent. You describe a task; it plans, calls tools (shell, files, web, browser, Office, media…), reads the results and iterates until the task is done — on your computer, inside a workspace folder you choose.

| Guide | Contents |
|---|---|
| [Setup](setup.md) | Install a release, run from source, data & workspace folders, environment variables, building, maintainer workflows |
| [Configuration](configuration.md) | Every key in `config.json`, autonomy levels, rules and persona, languages |
| [Providers](providers.md) | Built-in models, adding your own providers and models, local models, testing keys |
| [Tools](tools.md) | Reference for the 41 tools the agent can call |
| [HTTP API](api.md) | Local REST + SSE API (what the UI uses; scriptable) |
| [Vault](vault.md) | How built-in model keys are shipped, protected and rotated |
| [Troubleshooting](troubleshooting.md) | Symptoms → causes → fixes |

## How a run works

1. You send a message (optionally with files or images). Attached images are OCR'd — and described by a vision model if one is configured — so text-only models can use them.
2. ORCA picks a model: the one you selected, or **Auto** routing (heavier coding/research prompts go to the stronger built-in model, short chat to the fastest).
3. The model streams a reply. Whenever it emits a tool call, ORCA executes it, shows a step card in the UI, and feeds the result back. Risky calls wait for your approval depending on the [autonomy level](configuration.md#autonomy).
4. File edits create **checkpoints** (before/after snapshots) that you can diff and restore from the *Changes* tab.
5. If the model errors or hits a rate limit, ORCA fails over to the next built-in key/model automatically and tells you in a status line.
6. The final answer is rendered as Markdown; produced files appear under *Outputs* and in the *Files* tab, from where you can open or preview them.

## Modes

- **Direct** — one model, full tool access.
- **Side by side** — two models answer the same prompt in parallel lanes.
- **Battle** — two anonymous lanes; vote, then the names are revealed and a local leaderboard is updated.

Runs keep going in the background: you can start a new chat or open another one while a run is streaming and come back later.

## Slash commands

| Command | Effect |
|---|---|
| `/init` | Create `ORCA.md` in the workspace — project memory loaded into every future chat (like `AGENTS.md`) |
| `/compact` | Summarise the current chat's history to free context |
| `/plan` | Toggle plan mode (investigate and propose, don't modify) |
| `/help` | List commands |

## Keyboard shortcuts

`Ctrl+N` new chat · `Ctrl+K` command palette · `Ctrl+,` settings · `Ctrl+B` toggle sidebar · `Ctrl+.` toggle side panel · `Ctrl+Shift+F` search chats · `Ctrl+Shift+L` light/dark · `Ctrl+/` shortcut list · `Esc` close dialog / stop the current run · `Enter` send (configurable to `Ctrl+Enter`). On macOS use `⌘` instead of `Ctrl`.

## Where things live

| Item | Location |
|---|---|
| Desktop app data | Windows `%APPDATA%\ORCA Agent\data`, macOS `~/Library/Application Support/ORCA Agent/data`, Linux `~/.config/ORCA Agent/data` |
| Web mode data | `~/.orca` (override with `ORCA_DATA`) |
| Workspace (files the agent reads/writes) | `<data>/workspace` unless changed in Settings → General |
| Chats, checkpoints, memory | `<data>/chats.json`, `<data>/checkpoints/`, `<data>/memory.md` |
| Your provider keys | `<data>/config.json` (local only) |
