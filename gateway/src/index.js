// ORCA Gateway — Cloudflare Worker
// -------------------------------------------------------------------------------------------------
// The desktop app has NO provider keys. It calls this Worker, which injects the real keys and forwards
// to the upstream provider (OpenAI-compatible /chat/completions, streaming passthrough).
//
// Secrets (set with `wrangler secret put` or via GitHub Actions → Cloudflare, never in git):
//   UPSTREAMS  — JSON: { "minimax": [ {"url": "https://inference.dahl.global/v1", "key": "dahl_…", "model": "MiniMaxAI/MiniMax-M2.7"} , …more keys for the same model = round-robin/failover ],
//                        "deepseek": [ … ], "glm": [ … ] }
//   BUILD_TOKEN — must equal the app's build token (orca.config.json → buildToken, or ORCA_BUILD_TOKEN at build time)
//   ADMIN_TOKEN — for /admin endpoints (usage, disable a key, set notice)
// Vars (wrangler.toml [vars]): REPO, NOTICE (optional), MIN_VERSION (optional)
// Bindings: RL (rate limiting), KV (usage counters, disabled keys, remote notice) — both free-plan friendly.
//
// Endpoints:
//   GET  /v1/health                     → { ok, models:[…] }              (app: gateway status dot)
//   GET  /v1/config                     → remote config JSON             (models, notice, minVersion, flags)
//   GET  /v1/release?ch=stable          → GitHub latest release mirror   (for users who can't reach api.github.com)
//   GET  /v1/models                     → OpenAI-style model list
//   POST /v1/chat/completions           → proxied to the upstream picked for body.model ("orca/minimax" …)
//   GET  /admin/usage, POST /admin/disable {id}, POST /admin/enable {id}, POST /admin/notice {text}   (Bearer ADMIN_TOKEN)
// -------------------------------------------------------------------------------------------------

const enc = new TextEncoder();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra } });

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

// Verify the app's signed headers. Window: ±10 minutes (clock skew tolerant). Not cryptographic secrecy —
// it filters casual abuse; real protection is per-install + per-IP rate limits and the daily budget below.
async function verifyClient(req, env, pathname) {
  const ts = req.headers.get('X-ORCA-TS') || '', inst = req.headers.get('X-ORCA-Install') || '', sig = req.headers.get('X-ORCA-Sig') || '', ver = req.headers.get('X-ORCA-Client') || '';
  if (!/^\d{9,11}$/.test(ts) || !/^[a-f0-9]{32}$/.test(inst) || !/^[a-f0-9]{64}$/.test(sig)) return { ok: false, why: 'missing client signature' };
  if (Math.abs(Date.now() / 1000 - +ts) > 600) return { ok: false, why: 'stale timestamp' };
  const expected = await hmacHex(env.BUILD_TOKEN || 'orca-public-build', `${ts}.${inst}.${pathname}`);
  if (!timingSafeEq(expected, sig)) return { ok: false, why: 'bad signature' };
  if (env.MIN_VERSION && cmpVer(ver, env.MIN_VERSION) < 0) return { ok: false, why: 'client too old — please update ORCA', status: 426 };
  return { ok: true, inst, ver };
}
function cmpVer(a, b) { const na = String(a || '0').split('.').map((x) => parseInt(x) || 0), nb = String(b || '0').split('.').map((x) => parseInt(x) || 0); for (let i = 0; i < 3; i++) if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0); return 0; }

function upstreams(env) {
  try { const u = JSON.parse(env.UPSTREAMS || '{}'); return u && typeof u === 'object' ? u : {}; } catch (_) { return {}; }
}
const dayKey = () => new Date().toISOString().slice(0, 10);

// KV helpers (optional binding — everything degrades gracefully without it)
async function kvGet(env, k) { try { return env.KV ? await env.KV.get(k) : null; } catch (_) { return null; } }
async function kvPut(env, k, v, ttl) { try { if (env.KV) await env.KV.put(k, v, ttl ? { expirationTtl: ttl } : undefined); } catch (_) {} }
async function bump(env, k, ttl = 172800) { const n = (+(await kvGet(env, k)) || 0) + 1; await kvPut(env, k, String(n), ttl); return n; }

async function pickUpstream(env, alias) {
  const all = upstreams(env);
  const list = all[alias] || all[alias.replace(/^orca\//, '')] || null;
  if (!list || !list.length) return null;
  const disabledRaw = await kvGet(env, 'disabled'); const disabled = new Set(disabledRaw ? JSON.parse(disabledRaw) : []);
  const live = list.map((u, i) => ({ ...u, id: u.id || `${alias}#${i}` })).filter((u) => !disabled.has(u.id));
  if (!live.length) return null;
  // rotate by minute so the load spreads over keys; failover tries the next ones
  const start = Math.floor(Date.now() / 60000) % live.length;
  return [...live.slice(start), ...live.slice(0, start)];
}

async function handleChat(req, env, ctx, client) {
  let body; try { body = await req.json(); } catch (_) { return json({ error: { message: 'invalid JSON' } }, 400); }
  const alias = String(body.model || 'orca/minimax').replace(/^orca\//, '');
  const cands = await pickUpstream(env, alias);
  if (!cands) return json({ error: { message: `model '${alias}' is not available right now`, code: 'model_unavailable' } }, 503);
  // fair use: per-install daily budget (requests) — configurable via var DAILY_BUDGET (default 400)
  const budget = +(env.DAILY_BUDGET || 400);
  const used = await bump(env, `u:${dayKey()}:${client.inst}`);
  if (used > budget) return json({ error: { message: 'daily fair-use limit reached for this install — try again tomorrow or add your own API key in Settings', code: 'budget' } }, 429);
  ctx.waitUntil(bump(env, `total:${dayKey()}`));

  let lastErr = null;
  for (const up of cands) {
    const payload = { ...body, model: up.model };
    if (up.maxTokens && (!payload.max_tokens || payload.max_tokens > up.maxTokens)) payload.max_tokens = up.maxTokens;
    try {
      const r = await fetch(up.url.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + up.key, 'content-type': 'application/json', 'HTTP-Referer': 'https://github.com/' + (env.REPO || 'Nethyric/orca'), 'X-Title': 'ORCA Agent' },
        body: JSON.stringify(payload),
      });
      if (r.status === 401 || r.status === 402 || r.status === 403) { // key dead or out of credit → auto-disable for 6h and try the next key
        ctx.waitUntil((async () => { const d = new Set(JSON.parse((await kvGet(env, 'disabled')) || '[]')); d.add(up.id); await kvPut(env, 'disabled', JSON.stringify([...d]), 21600); await bump(env, `dead:${up.id}`); })());
        lastErr = { status: r.status, text: (await r.text()).slice(0, 200) }; continue;
      }
      if (r.status === 429 || r.status >= 500) { lastErr = { status: r.status, text: (await r.text()).slice(0, 200) }; continue; }
      // stream/non-stream passthrough
      const h = new Headers(CORS); h.set('content-type', r.headers.get('content-type') || 'application/json'); h.set('x-orca-upstream', up.id);
      if (r.headers.get('content-type')?.includes('text/event-stream')) { h.set('cache-control', 'no-cache'); h.set('x-accel-buffering', 'no'); }
      return new Response(r.body, { status: r.status, headers: h });
    } catch (e) { lastErr = { status: 502, text: e.message }; }
  }
  return json({ error: { message: `all upstreams for '${alias}' failed: ${lastErr ? lastErr.status + ' ' + lastErr.text : 'unknown'}`, code: 'upstream' } }, lastErr && lastErr.status === 429 ? 429 : 503);
}

async function handleAdmin(req, env, url) {
  const auth = req.headers.get('authorization') || '';
  if (!env.ADMIN_TOKEN || auth !== 'Bearer ' + env.ADMIN_TOKEN) return json({ error: 'unauthorized' }, 401);
  const p = url.pathname;
  if (p === '/admin/usage') {
    const today = dayKey(); const out = { day: today, total: +(await kvGet(env, `total:${today}`)) || 0, disabled: JSON.parse((await kvGet(env, 'disabled')) || '[]'), models: Object.fromEntries(Object.entries(upstreams(env)).map(([k, v]) => [k, v.length])) };
    return json(out);
  }
  const body = await req.json().catch(() => ({}));
  if (p === '/admin/disable' || p === '/admin/enable') { const d = new Set(JSON.parse((await kvGet(env, 'disabled')) || '[]')); p.endsWith('disable') ? d.add(body.id) : d.delete(body.id); await kvPut(env, 'disabled', JSON.stringify([...d])); return json({ ok: true, disabled: [...d] }); }
  if (p === '/admin/notice') { await kvPut(env, 'notice', JSON.stringify(body || {})); return json({ ok: true }); }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (p === '/' ) return json({ name: 'ORCA Gateway', ok: true, docs: 'https://github.com/' + (env.REPO || 'Nethyric/orca') });
    if (p.startsWith('/admin/')) return handleAdmin(req, env, url);

    // per-IP rate limit (Workers Rate Limiting binding; optional)
    if (env.RL) { try { const { success } = await env.RL.limit({ key: req.headers.get('cf-connecting-ip') || 'x' }); if (!success) return json({ error: { message: 'rate limited' } }, 429); } catch (_) {} }

    const client = await verifyClient(req, env, p);
    if (!client.ok) return json({ error: { message: client.why, code: 'client' } }, client.status || 401);

    const models = Object.keys(upstreams(env)).map((k) => ({ id: 'orca/' + k, object: 'model', owned_by: 'orca' }));
    if (p === '/v1/health') return json({ ok: true, models: models.map((m) => m.id), version: env.MIN_VERSION || null });
    if (p === '/v1/models') return json({ object: 'list', data: models });
    if (p === '/v1/config') {
      const notice = JSON.parse((await kvGet(env, 'notice')) || 'null') || (env.NOTICE ? { text: env.NOTICE } : null);
      return json({ minVersion: env.MIN_VERSION || null, notice, models: null, flags: { gateway: true }, ts: Date.now() }, 200, { 'cache-control': 'public, max-age=300' });
    }
    if (p === '/v1/release') {
      const ch = url.searchParams.get('ch') || 'stable';
      const cache = caches.default; const ck = new Request('https://cache.orca/release/' + ch); const hit = await cache.match(ck); if (hit) return hit;
      const r = await fetch(`https://api.github.com/repos/${env.REPO || 'Nethyric/orca'}/releases/latest`, { headers: { 'user-agent': 'orca-gateway', accept: 'application/vnd.github+json' } });
      const res = json(await r.json().catch(() => ({})), r.status, { 'cache-control': 'public, max-age=600' });
      ctx.waitUntil(cache.put(ck, res.clone()));
      return res;
    }
    if (p === '/v1/chat/completions' && req.method === 'POST') return handleChat(req, env, ctx, client);
    return json({ error: { message: 'not found' } }, 404);
  },
};
