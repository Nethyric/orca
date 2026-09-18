# Configuration

All settings live in `<data>/config.json` and are editable in **Settings** (`Ctrl+,`) or through `GET/POST /api/config` (partial patches are merged). Unknown keys are preserved.

## Models

| Key | Type / values | Default | Description |
|---|---|---|---|
| `defaultModel` | `"auto"` \| `"minimax"` \| `"deepseek"` \| `"glm"` \| `"<providerId>/<modelId>"` | `"auto"` | Model preselected for new chats |
| `compareModels` | `[key, key]` | `["minimax","deepseek"]` | Default pair for *Side by side* and *Battle* |
| `providers` | object | `{}` | Your providers and their models — see [providers.md](providers.md#configuration-record) |
| `customModels` | array | `[]` | Legacy (pre-0.0.1) flat model list; still honoured, migrate to `providers` |

## Agent behaviour

| Key | Values | Default | Description |
|---|---|---|---|
| `autonomy` | `"ask"` \| `"auto"` \| `"yolo"` | `"auto"` | See [Autonomy](#autonomy) |
| `maxSteps` | number | `40` | Maximum tool-call rounds per run before the agent must answer |
| `temperature` | `0`–`1.5` | `0.5` | Sampling temperature |
| `reasoningEffort` | `"low"` \| `"medium"` \| `"high"` | `"medium"` | Hint appended to the system prompt (think longer / answer faster) |
| `shellTimeout` | seconds | `120` | Default timeout for `run_shell` |
| `rules` | string | `""` | Standing instructions appended to every system prompt (project conventions, language, style) |
| `persona` | string | `""` | Short profile of you (name, role, preferences) |
| `workspace` | path | `""` (= `<data>/workspace`) | Folder all file tools operate in. Point it at your project |

### Autonomy

Each tool call is classified: `none` (read-only: reading files, searching, web), `low` (writing files, running snippets, generating media), `medium` (shell commands, deleting files) or `high` (destructive shell patterns such as `rm -rf`, `format`, `shutdown`, registry edits).

| Level | Asks before |
|---|---|
| `ask` | every call above `none` |
| `auto` | `high` only |
| `yolo` | never |

Approvals appear inline in the chat (*Allow*, *Allow all for this run*, *Deny*). Sub-agents always run with `yolo` inside the parent's approval scope. Plan mode denies every mutating tool regardless of level.

### Rules and persona

`rules` is the place for things you would otherwise repeat: "always TypeScript", "answer in German", "never install packages without asking", "use pnpm". They are injected into every chat, after ORCA's own instructions. `persona` is a short description of you so answers fit (job, stack, preferences).

Project-specific memory goes into `ORCA.md` at the workspace root (`/init` creates it); it is loaded automatically when present. Facts the agent learns with the `remember` tool land in `<data>/memory.md` and are searchable with `recall`; edit that file from Settings → Data.

## Media & vision

| Key | Description |
|---|---|
| `vision` | `{ provider, model, baseUrl, apiKey }` — `provider: ""` = auto (first provider with an image-capable model), `"<providerId>"`, or `"custom"` with `baseUrl` + `apiKey` |
| `imageGen` | `{ provider, baseUrl, apiKey, model }` — `""` auto (a provider you added with an Images API, else built-in), `"builtin"` free service, `"openai"` any `/images/generations` API (base URL + key + model), or `"<providerId>"` (its Images API, or a chat model with image output) |
| `videoGen` | `{ provider, baseUrl, apiKey, model }` — `""` auto (OpenAI provider → Sora, else key-frame animation), `"openai"` Videos API (Sora / compatible), `"replicate"` prediction API, `"fal"` queue API, or `"<providerId>"` |
| `cookiesFile` / `cookiesBrowser` | For login-walled social downloads: path to a `cookies.txt` or a browser name (`chrome`, `firefox`, `edge`) |
| `judge` | `{ enabled, apiKey, baseUrl, model }` — optional [decision engine](decision-engine.md) (System One API; default URL `https://api.typesafe.ai/v1`, model `jev-latest`). Env fallbacks `ORCA_JUDGE_KEY`, `TYPESAFE_API_KEY` |

## Interface

| Key | Values | Default |
|---|---|---|
| `lang` | `"en"` \| `"ru"` \| `"zh"` \| `"fa"` | `"en"` (OS language detected on first run) |
| `theme` | `"dark"` \| `"light"` \| `"system"` | `"dark"` |
| `accent` | `"indigo"` \| `"violet"` \| `"cyan"` \| `"emerald"` \| `"amber"` \| `"rose"` | `"indigo"` |
| `fontSize` | px | `14` |
| `density` | `"comfortable"` \| `"compact"` | `"comfortable"` |
| `showReasoning` | boolean | `true` — stream the model's reasoning while it thinks |
| `sendKey` | `"enter"` \| `"ctrlEnter"` | `"enter"` |
| `sound`, `notifications` | boolean | `false`, `true` |

Fonts: Inter for Latin and Cyrillic, Vazirmatn for Persian (RTL layout), Noto Sans SC for Chinese, JetBrains Mono for code. Switching `lang` re-renders the UI immediately and tells the agent to answer in that language unless you write in another.

## Updates

| Key | Description |
|---|---|
| `autoUpdate` | Check GitHub Releases on start and every 6 hours (default `true`) |
| `dismissedUpdate` | Version whose banner you dismissed |

`orca.config.json` in the app folder holds the build identity: `name`, `company`, `repo` (used for the update check and vault sources), `homepage`, `updateChannel`, `defaultLanguage`, `vaultPublicKey`. Forks change it with `npm run set-repo -- Owner/repo`.

## Example

```json
{
  "lang": "en",
  "defaultModel": "auto",
  "autonomy": "auto",
  "maxSteps": 60,
  "workspace": "D:/code/my-app",
  "rules": "Use TypeScript and pnpm. Run the tests after every change. Keep answers short.",
  "persona": "Backend engineer, Windows 11, prefers PowerShell.",
  "providers": {
    "groq": { "name": "Groq", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "gsk_…", "models": [ { "id": "llama-3.3-70b-versatile", "toolCall": true } ] }
  }
}
```
