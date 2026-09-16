# Maintainer setup — GitHub + Cloudflare (≈15 minutes, all free)

This is the one-time checklist to publish ORCA under your own GitHub account with hidden API keys and auto-updates.
Users never see any of this; they just download `ORCA-Agent-x.y.z-win-x64.zip` from Releases.

```
 ┌───────────┐  signed HTTPS   ┌──────────────────────┐  provider keys   ┌────────────┐
 │ ORCA app  │ ──────────────▶ │  Cloudflare Worker   │ ───────────────▶ │ Dahl / TR  │
 │ (no keys) │ ◀────────────── │  orca-gateway        │ ◀─────────────── │ OpenRouter │
 └───────────┘  SSE stream     └──────────────────────┘                  └────────────┘
       │ every 6 h                       ▲ secrets synced by
       ▼                                 │ GitHub Actions
 GitHub Releases  ◀── Release workflow ──┘ (tag v1.5.0 → build → publish)
```

## 1 · GitHub repository
1. Create the organisation/user **Nethyric** (or use your own name) → **New repository** `orca`, Public, empty (no README).
2. On your PC:
   ```bash
   unzip ORCA-source-1.5.0.zip && cd orca
   git init -b main
   git add . && git commit -m "ORCA 1.5.0"
   git remote add origin https://github.com/Nethyric/orca.git
   git push -u origin main
   ```
   (If you used a different owner/repo name: `npm run set-repo -- Owner/repo https://orca-gateway.<sub>.workers.dev` first.)

## 2 · Cloudflare (free plan)
1. Sign up at <https://dash.cloudflare.com> → **Workers & Pages** → note your `*.workers.dev` subdomain (e.g. `nethyric.workers.dev`).
   The app expects the gateway at **`https://orca-gateway.<subdomain>.workers.dev`** — if your subdomain is not `nethyric`, edit `orca.config.json → gateway` and commit.
2. **Account ID**: Workers & Pages → Overview → right sidebar → *Account ID*.
3. **API token**: My Profile → API Tokens → *Create Token* → template **“Edit Cloudflare Workers”** → Continue → Create → copy it.

## 3 · GitHub Secrets  (repo → Settings → Secrets and variables → Actions → *New repository secret*)
| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token from step 2.3 |
| `CLOUDFLARE_ACCOUNT_ID` | account id from step 2.2 |
| `UPSTREAMS` | JSON with your provider keys (below) |
| `BUILD_TOKEN` | any long random string, e.g. `openssl rand -hex 24` |
| `ADMIN_TOKEN` | another random string (for `/admin/*` endpoints) |

`UPSTREAMS` example (several keys per model = automatic rotation + failover; `id` is just a label you will see in usage stats):
```json
{
  "minimax":  [ { "id": "dahl-a", "url": "https://inference.dahl.global/v1", "key": "dahl_XXXX", "model": "MiniMaxAI/MiniMax-M2.7", "maxTokens": 4096 },
                { "id": "dahl-b", "url": "https://inference.dahl.global/v1", "key": "dahl_YYYY", "model": "MiniMaxAI/MiniMax-M2.7", "maxTokens": 4096 } ],
  "deepseek": [ { "id": "dahl-a-ds", "url": "https://inference.dahl.global/v1", "key": "dahl_XXXX", "model": "deepseek-ai/DeepSeek-V4-Flash-0731", "maxTokens": 4096 },
                { "id": "dahl-a-glmf", "url": "https://inference.dahl.global/v1", "key": "dahl_XXXX", "model": "zai-org/GLM-5.3-Flash", "maxTokens": 4096 } ],
  "glm":      [ { "id": "dahl-a-glm", "url": "https://inference.dahl.global/v1", "key": "dahl_XXXX", "model": "zai-org/GLM-5.3-Flash", "maxTokens": 4096 },
                { "id": "tr-1", "url": "https://api.tokenrouter.com/v1", "key": "sk-XXXX", "model": "z-ai/glm-5.3-free", "maxTokens": 3000 } ]
}
```
Any OpenAI-compatible endpoint works (OpenRouter: `"url": "https://openrouter.ai/api/v1"`, `"model": "google/gemma-4-31b-it:free"`).
Model aliases the app knows: `minimax`, `deepseek`, `glm`. To add a new alias, also list it in `remote/config.json → models` (no release needed).

## 4 · Deploy the gateway
Actions → **Deploy gateway (Cloudflare Worker)** → *Run workflow*. The job creates the KV namespace, uploads the secrets and deploys.
Check: `curl https://orca-gateway.<sub>.workers.dev/v1/health` → `{"error":{"message":"missing client signature"}}` means it is up (unsigned calls are rejected on purpose).
Usage stats: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://orca-gateway.<sub>.workers.dev/admin/usage`

## 5 · First release
```bash
git tag v1.5.0 && git push --tags
```
Actions → **Release (Windows build)** runs ~6 min → Releases page gets `ORCA-Agent-1.5.0-win-x64.zip` + `SHA256SUMS`.
Share `https://github.com/Nethyric/orca/releases/latest`.

## Day-to-day
| I want to… | Do |
|---|---|
| Replace an exhausted key | Edit the `UPSTREAMS` secret → Actions → *Deploy gateway* → Run. Users notice nothing. |
| Disable one key for 6 h right now | `curl -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"id":"dahl-a"}' https://…/admin/disable` |
| Show a message inside every app | `curl -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"text":"New models tonight!","url":"https://…"}' https://…/admin/notice` or edit `remote/config.json → notice` and push |
| Force very old versions to update | set `MIN_VERSION` in `gateway/wrangler.toml` (or `remote/config.json → minVersion`) and push |
| Ship a new version | bump `version` in `package.json` → commit → `git tag vX.Y.Z && git push --tags`. Every running app shows the update banner within 6 h. |
| Change the model list without a release | edit `remote/config.json → models` (same shape as in the file) and push |

## Notes
- The app is unsigned (no code-signing certificate). Windows SmartScreen shows “Unknown publisher” once; users click *More info → Run anyway*. Buy an OV/EV cert later and add signing to `release.yml` if you want to remove that.
- Cloudflare free tier: 100 000 requests/day. One agent turn ≈ 3–10 requests. That is roughly 300–1 000 heavy daily users; the Workers Paid plan ($5/month) lifts it to 10 M.
- `BUILD_TOKEN` is embedded in the app at build time. It is a speed-bump against random scripts, not a cryptographic secret — the real protection is that provider keys never leave the Worker + rate limits + per-install budget (`DAILY_BUDGET` in `wrangler.toml`).
