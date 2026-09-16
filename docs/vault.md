# Built-in models & the vault

ORCA ships with built-in models that work with zero setup. The provider keys behind them are **not** in the repository, **not** in the release archive in clear text, and can be rotated by the maintainer at any time without a release and without users noticing.

## Design

```
UPSTREAMS secret (GitHub)  ──Seal vault workflow──▶  remote/vault.json  (ciphertext, committed)
                                                            │
      app private key (baked by CI into src/build-info.json) ▼
ORCA app  ── every 15 min: raw.githubusercontent → jsDelivr → release asset → local cache ──▶ decrypt in memory
          ── per request: pick a live key for the alias, rotate, cool down on 401/402/403/429/5xx, fail over
```

- **Encryption**: `x25519-hkdf-sha256-aes256gcm`. A fresh ephemeral X25519 key is generated per seal; the shared secret is derived with HKDF-SHA256 and used as an AES-256-GCM key. The vault file contains `{v, alg, epk, iv, ct, tag, issued, aliases}` — no plaintext fields other than alias names.
- **Public key** lives in `orca.config.json` (`vaultPublicKey`). It only allows *sealing*. Anyone can run the seal script against it; only the app can open the result.
- **Private key** is a GitHub Actions secret (`ORCA_VAULT_KEY`). `scripts/bake.js` writes it into `src/build-info.json` during CI builds. That file is git-ignored and never committed.
- **Rotation** = change the `UPSTREAMS` secret, run the *Seal vault* workflow. Every running app fetches the new file within 15 minutes (or immediately on the next failed request). Old keys can be revoked at the provider right away.
- **Resilience**: three download sources plus a local cache (`<data>/vault.cache`), so a network hiccup or a blocked GitHub domain does not stop the app.

## Threat model, honestly

A determined user who owns a release build can extract the private key from the binary and decrypt the vault — that is unavoidable for any client-side secret; it is the same trade-off every desktop app with built-in cloud access makes. What the design gives you:

- nothing sensitive in git history or in plain sight inside the zip;
- instant, silent rotation when a key is abused or exhausted;
- per-key health tracking so a dead key never degrades the user experience;
- your own users' keys are unrelated to this mechanism and never leave their device.

Treat built-in keys as low-value, rate-limited credentials and rotate them routinely.

## `UPSTREAMS` format

The secret is a JSON object keyed by **alias**. Each alias maps to an ordered list of upstreams; the app rotates between them minute by minute and fails over on errors.

```json
{
  "minimax": [
    { "id": "a-mm", "url": "https://api.example.com/v1", "key": "sk-…", "model": "vendor/model-id", "maxTokens": 4096 }
  ],
  "deepseek": [
    { "id": "a-ds", "url": "https://api.example.com/v1", "key": "sk-…", "model": "vendor/other-model" },
    { "id": "b-ds", "url": "https://api.other.com/v1",   "key": "sk-…", "model": "other/model", "headers": { "X-Org": "…" } }
  ],
  "glm": [ … ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | no | Stable identifier for health tracking (defaults to the key) |
| `url` | yes | OpenAI-compatible base URL (`/chat/completions` is appended) |
| `key` | yes | Bearer token |
| `model` | yes | Model id sent to that endpoint |
| `maxTokens` | no | Output cap for this endpoint |
| `headers` | no | Extra request headers |

Optionally wrap it as `{ "upstreams": {...}, "models": [...], "notice": "...", "minVersion": "0.0.1" }` to also publish a model list, a notice banner, or a minimum supported version.

The aliases `minimax`, `deepseek` and `glm` correspond to the built-in model entries (`orca/minimax`, `orca/deepseek`, `orca/glm` in `src/core/config.js`). Add more aliases together with matching entries there if you want more built-in models.

## CLI

```bash
npm run vault:keygen -- --write        # new key pair; writes the public key into orca.config.json
npm run vault:check  < upstreams.json  # validates the JSON and pings every upstream once
npm run vault:seal   < upstreams.json  # writes remote/vault.json
ORCA_VAULT_KEY=… node scripts/vault.js open remote/vault.json   # decrypts (maintainer only)
```

## Status in the app

`GET /api/vault` (and Settings → Models → *Built-in models* box) shows whether the vault is enabled, where it was fetched from, when it was issued, the alias names and the number of live keys — never the keys themselves.

If the app has no private key (source checkout without `ORCA_VAULT_KEY`), built-in models are hidden and the box explains that you should add your own provider.
