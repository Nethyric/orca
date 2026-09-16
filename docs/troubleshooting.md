# Troubleshooting

## Start-up

| Symptom | Cause | Fix |
|---|---|---|
| Windows SmartScreen blocks `ORCA.exe` | The build is not code-signed | *More info → Run anyway*. Verify the zip's SHA-256 against `SHA256SUMS` on the release page if in doubt |
| Antivirus quarantines `ffmpeg.exe` or `yt-dlp.exe` | Heuristics on bundled binaries | Restore them from quarantine or run `npm run fetch-bins` to re-download; the app works without them (media/social tools disabled) |
| Blank window | GPU driver issue with Chromium | Start once with `--disable-gpu` (`"ORCA.exe" --disable-gpu`) |
| `npm start` fails with `Electron failed to install` | Blocked download of the Electron binary | `npm install` again with a working connection, or set `ELECTRON_MIRROR` |

## Built-in models

| Symptom | Cause | Fix |
|---|---|---|
| Model list shows only *Auto* and your own providers; Settings → Models says built-in models are unavailable | No vault key in this build (source checkout) | Add a provider of your own, or export `ORCA_VAULT_KEY` (maintainers) — see [vault.md](vault.md) |
| Built-in box says *offline / cached* | GitHub and jsDelivr unreachable | The last vault is used from cache; nothing to do unless it never loaded — check the network or a proxy |
| Every built-in request fails with `HTTP 401/402` | All keys revoked or out of credit | Maintainer: update `UPSTREAMS`, run *Seal vault*. Users get the new keys within 15 minutes |
| Frequent *retrying…* / *switched to …* status lines | Rate limits (`429`) or `5xx` bursts at the upstream | Expected; ORCA rotates keys and models. Add your own provider for uninterrupted throughput |
| Answers cut off mid-way | Output cap of the built-in endpoint (4096 tokens) | ORCA auto-continues; for long documents use your own provider with a higher `maxTokens` |

## Your providers

| Symptom | Cause | Fix |
|---|---|---|
| **Test** → `401`/`403` | Wrong or revoked key, or the key cannot access that model | Re-paste the key; check the provider console |
| **Test** → `404` | Base URL missing `/v1`, or wrong model id | Use the URL the catalog filled in; press **Discover** to get exact model ids |
| **Test** → `400 … tools` / `tool_choice` | The model does not support function calling | Pick another model, or untick *tools* for it (it will then be used for chat only) |
| **Discover** returns nothing | The endpoint has no `/models` route, or requires a different auth header | Type the model id manually; for Anthropic-style APIs set the base URL to `https://api.anthropic.com` (the style is detected) |
| Local server (Ollama / LM Studio) not found | Server not running or bound to another port | Start it, then **Discover**; adjust the base URL (`http://127.0.0.1:11434/v1`, `http://127.0.0.1:1234/v1`) |

## Agent behaviour

| Symptom | Cause | Fix |
|---|---|---|
| The agent asks for approval too often | Autonomy is *Ask* | Settings → Agent → *Auto* (asks only for destructive commands) |
| A run stops with *max steps reached* | Task larger than `maxSteps` | Raise `maxSteps` or split the task; tell it to continue |
| The agent cannot see a file | It is outside the workspace | Change the workspace (Settings → General) or ask the agent to copy the file in |
| *Plan mode* refuses to edit | Plan mode is on | Reply *go* / *do it*, or toggle plan mode off |
| `browser_check` / `screenshot` say no Chrome found | Neither Chrome, Edge, Chromium nor Brave is installed | Install one; on Windows Edge is usually present already |
| OCR returns garbage for a language | Missing language data | Only `eng`, `fas`, `rus`, `chi_sim` are bundled; run `npm run fetch-bins` after a fresh checkout |
| Social downloads fail with *login required* | Instagram/X private or age-gated content | Settings → Agent → Social: set a browser name or a `cookies.txt` path |

## Updates

| Symptom | Cause | Fix |
|---|---|---|
| Banner says an update is available but download fails | GitHub blocked | Download the zip manually from the Releases page and replace the folder |
| *Hash mismatch* when applying | Corrupt download | Delete the pending update from the data folder and retry |
| No update banner although a newer release exists | Checked less than 6 h ago, or the banner was dismissed | Settings → Updates → *Check for updates* |

## Logs and data

- Web mode logs to the console it was started from.
- Desktop: `main.log` next to the data folder — `%APPDATA%\ORCA Agent\logs\` (Windows), `~/Library/Application Support/ORCA Agent/logs/` (macOS), `~/.config/ORCA Agent/logs/` (Linux). Rotated at 2 MB (`main.prev.log`).
- Resetting: delete `config.json` in the data folder (chats and checkpoints are kept), or the whole data folder for a factory reset.

## Reporting a bug

Open an issue with the ORCA version (Settings → Updates), your OS, the model that was in use, the step card that failed (copy its result) and, if relevant, the last lines of the log. Never paste API keys — mask them.
