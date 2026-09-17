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

### Long answers, long inputs, interruptions

- **Output caps are invisible.** Built-in models can emit ~4k tokens per turn. When an answer is cut by that cap, ORCA asks the model to continue from exactly where it stopped and stitches the pieces — you see one answer that keeps streaming. Code fences and lists survive the seam.
- **Long pastes go to a file.** Text over ~12 000 characters is saved to `attachments/paste-<timestamp>.txt`; the model gets a preview plus the path and reads or greps the file instead of re-typing it (which is what used to make long inputs loop).
- **Nothing is lost on Stop or errors.** A stopped or failed answer keeps the text it already produced and shows **Continue** / **Retry** buttons. Answers that were streaming when the app closed are marked *interrupted* on the next start.
- **Busy providers are handled.** Rate limits (429/503) on the free built-in keys trigger key rotation, then a short backoff sweep across all models ("All models are busy — retrying in 4 s"). Garbled or looping outputs are detected and re-asked from another model.
- **Type while it works.** Messages sent while the agent is busy are queued above the composer and go out automatically when the current answer finishes.

### Staying on track in long chats

- **Pin** any message (yours or the agent's): pinned messages are re-injected into every following prompt, so decisions stay binding no matter how long the chat gets.
- **Notes** (side panel → *Notes*): a per-chat scratchpad for terminology, constraints and decisions that the agent always sees.
- **Branch** from any message to explore an alternative without losing the original thread; **Edit** a message to regenerate from that point; **Delete** to prune.
- **Project memory** (`/init` → `ORCA.md`) has sections for *Decided*, *Inferred*, *Tried and failed* and *Current state*; the agent keeps them updated so it doesn't re-explore or retry dead ends in later chats.
- The agent knows the current date and time, its maker ([Nethyric](https://github.com/Nethyric)), its version and where its source lives.

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
| `/export` | Download the chat as Markdown |
| `/model <name>` | Switch the default model |
| `/files` | Open the Files tab |
| `/new`, `/clear` | Start a new chat |

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
