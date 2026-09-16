# ORCA Gateway (Cloudflare Worker)

The desktop app ships with **no API keys**. All built‑in models go through this Worker, which holds the
real provider keys as Cloudflare **Secrets** and forwards OpenAI‑compatible requests (streaming included).

Why this design
- Keys never touch users' machines → nobody can extract them from the app.
- Add / remove / rotate keys **without releasing a new version**: edit one secret, users notice nothing.
- Free plan is enough for a hobby/community app: 100 000 requests/day, 10 ms CPU per request (a proxy uses ~1 ms).
- Dead keys (401/402/403) are auto‑disabled for 6 h and the next key takes over; 429/5xx fail over instantly.
- Per‑IP rate limit + per‑install daily budget keep one abuser from draining the pool.

## One‑time setup (5 minutes)
1. Create a free Cloudflare account → Workers & Pages.
2. `npm i -g wrangler && wrangler login`
3. `wrangler kv namespace create ORCA_KV` → paste the id into `wrangler.toml` (`kv_namespaces.id`).
4. Secrets:
   ```bash
   wrangler secret put BUILD_TOKEN   # any long random string; must match orca.config.json → buildToken
   wrangler secret put ADMIN_TOKEN   # for /admin/* endpoints
   wrangler secret put UPSTREAMS     # paste the JSON below
   ```
   `UPSTREAMS` format — several keys per model = automatic rotation & failover:
   ```json
   {
     "minimax":  [ { "id": "dahl-1", "url": "https://inference.dahl.global/v1", "key": "dahl_xxx", "model": "MiniMaxAI/MiniMax-M2.7", "maxTokens": 4096 },
                   { "id": "dahl-2", "url": "https://inference.dahl.global/v1", "key": "dahl_yyy", "model": "MiniMaxAI/MiniMax-M2.7", "maxTokens": 4096 } ],
     "deepseek": [ { "id": "dahl-1-ds", "url": "https://inference.dahl.global/v1", "key": "dahl_xxx", "model": "deepseek-ai/DeepSeek-V4-Flash-0731", "maxTokens": 4096 } ],
     "glm":      [ { "id": "tr-1", "url": "https://api.tokenrouter.com/v1", "key": "sk-xxx", "model": "z-ai/glm-5.3-free", "maxTokens": 3000 } ]
   }
   ```
5. `wrangler deploy` → you get `https://orca-gateway.<your-subdomain>.workers.dev`. Put that URL in `orca.config.json → gateway`.

## Or let GitHub do it (recommended)
Add repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `UPSTREAMS`, `BUILD_TOKEN`, `ADMIN_TOKEN`.
Every push to `gateway/**` (or manual run of the *Deploy gateway* workflow) deploys the Worker and syncs the secrets.
**Ran out of quota? Edit the `UPSTREAMS` secret on GitHub → run the workflow → done. Users never see anything.**

## Admin
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://orca-gateway.<sub>.workers.dev/admin/usage
curl -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"id":"dahl-1"}' https://…/admin/disable
curl -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"text":"New models tonight!","url":"https://…"}' https://…/admin/notice
```
