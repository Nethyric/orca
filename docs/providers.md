# Providers and models

ORCA talks to two kinds of models:

| | Built-in | Your providers |
|---|---|---|
| Setup | none | Settings → Models → **Add provider** |
| Keys | shipped in a sealed vault, rotated by the maintainer ([details](vault.md)) | stored only in your local `config.json` |
| Selection key | `minimax`, `deepseek`, `glm`, or `auto` | `<providerId>/<modelId>` |
| Failover | automatic across keys and models | none (the model you picked is used) |

Any model can be chosen per chat from the model picker; **Auto** routes each message to the most suitable built-in model.

## Adding a provider

1. **Settings → Models → Add provider.**
2. Pick a provider from the catalog (the list comes from [models.dev](https://models.dev) — 200+ entries — plus local servers and *Custom*). Popular ones are pinned at the top; the rest are searchable.
3. The base URL is filled in for you. For *Custom* or a self-hosted server type it yourself (`https://host/v1`).
4. Paste your API key (`Show` toggles visibility; `Get a key ↗` opens the provider's console). Local servers need no key.
5. **Discover** asks the endpoint for `/models` and lists what your key can access; otherwise the catalog list is shown. Tick the models you want; each shows capability chips (*tools*, *reasoning*, *images*) and context size when known. You can also type a model id manually.
6. **Test** sends a one-token request through the first selected model and reports latency or the exact error.
7. **Save.** The models appear in the picker as `Provider · Model`; the first one can be set as the default.

Editing or removing a provider is done from the same list. Removing a provider removes its models from the picker and forgets its key.

## Supported API styles

| Style | Detected by | Notes |
|---|---|---|
| OpenAI-compatible (`/chat/completions`) | default | Streaming, tools, JSON — works for the vast majority of vendors and for local servers |
| Anthropic Messages API | base URL `api.anthropic.com` or `api: "anthropic"` in the provider record | Streaming, tool use, thinking blocks |

Providers whose native SDK is not OpenAI-compatible are listed in the catalog with their OpenAI-compatible base (for example Google's `…/v1beta/openai/`). If a vendor offers only a proprietary API with no compatible endpoint, put an OpenAI-compatible proxy in front of it and add that as *Custom*.

## Local models

| Server | Base URL | Key |
|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | none |
| LM Studio | `http://127.0.0.1:1234/v1` | none |
| vLLM / llama.cpp / text-generation-webui | whatever you started them with, ending in `/v1` | usually none |

Choose *Ollama* or *LM Studio* from the catalog (or *Custom*), press **Discover** to list the models the server has loaded, select, save. Tool calling needs a model that supports it (most 7B+ instruct models do); ORCA falls back to plain text when a model returns no tool calls.

## Configuration record

What **Save** writes to `config.json` (you can also edit or script it via `POST /api/config`):

```json
{
  "providers": {
    "openrouter": {
      "name": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-…",
      "models": [
        { "id": "anthropic/claude-sonnet-4", "name": "Claude Sonnet 4", "toolCall": true, "reasoning": true, "attachment": true, "maxTokens": 16000 }
      ]
    },
    "my-server": {
      "name": "Lab box",
      "baseUrl": "http://10.0.0.5:8000/v1",
      "apiKey": "",
      "models": [ { "id": "qwen2.5-coder-32b", "toolCall": true } ]
    }
  },
  "defaultModel": "openrouter/anthropic/claude-sonnet-4"
}
```

| Field | Meaning |
|---|---|
| `name` | Display name |
| `baseUrl` | API base, without a trailing slash |
| `apiKey` | Bearer token (`x-api-key` for Anthropic); empty for local servers |
| `api` | Optional: `"anthropic"` to force the Anthropic style |
| `models[].id` | Model id as the endpoint expects it |
| `models[].name` | Optional label |
| `models[].maxTokens` | Output cap sent as `max_tokens` (default 8192) |
| `models[].toolCall` / `reasoning` / `attachment` | Capability flags (from the catalog; `attachment` marks vision-capable models used for *Auto* vision) |

Setting a provider to `null` in a `POST /api/config` patch deletes it.

## Vision, image and video generation

*Settings → Agent* has three sections that reuse your providers. Each has a **Test** button that generates one tiny sample with the values in the form (nothing is saved until you press Save) and shows the provider, model, latency and the file.

- **Vision model** — describes attached images and screenshots. *Auto* picks the first configured provider that has a model flagged `attachment`; or choose a provider (optionally a specific model id) or a custom endpoint. The built-in vision model works without a key.
- **Image generation**
  - *Auto* (default) — the first provider you added whose base URL is a known image-capable gateway (OpenAI, Routeway, Together, xAI, DeepInfra, OpenRouter, Fireworks, fal, Runware); otherwise the built-in free service.
  - *Built-in (free)* — no key, text-to-image only.
  - *Images API* — any OpenAI-compatible `/images/generations` + `/images/edits`: base URL, key, model. Examples: `https://api.openai.com/v1` + `gpt-image-1`; `https://api.routeway.ai/v1` + `flux-2-flash` / `seedream-v4` / `imagen-4` / `ideogram-v3-turbo` / `recraft-v4`; `https://api.together.xyz/v1` + `black-forest-labs/FLUX.1-schnell`; `https://api.x.ai/v1` + `grok-2-image`.
  - *One of your providers* — uses its key and base URL; give a model id. If the provider has no Images API, a chat model that returns images (`modalities: ["image","text"]`, Gemini-image class) is used.
  - Image *editing* requires an Images API provider. When the provider you selected rejects the key or has no credit, the tool reports it instead of quietly falling back.
- **Video generation**
  - *Auto* — an OpenAI provider in your list → Sora through the Videos API; otherwise AI key-frames animated with ffmpeg (clearly labelled as such).
  - *Videos API (OpenAI Sora / compatible)* — base URL (default `https://api.openai.com/v1`), key, model `sora-2` or `sora-2-pro`; sizes 1280×720 / 720×1280 / 1024×1024, 4-20 s, optional start image.
  - *Prediction API (Replicate)* — key + model such as `wan-video/wan-2.2-t2v-fast`.
  - *Queue API (fal.ai)* — key + model such as `fal-ai/minimax/hailuo-02/standard/text-to-video` or `fal-ai/kling-video/v2.5-turbo/pro/text-to-video`.

Configuration records: `imageGen { provider: '' | 'builtin' | 'openai' | <providerId>, baseUrl, apiKey, model }` and `videoGen { provider: '' | 'openai' | 'replicate' | 'fal' | <providerId>, baseUrl, apiKey, model }` in `config.json`; keys are masked in `GET /api/config` and kept when a POST omits them. `POST /api/gen/test { kind: 'image'|'video', provider, model, baseUrl, apiKey? }` runs the same test as the button.

## Testing and troubleshooting keys

- **Test** in the editor and `POST /api/models/test` return the HTTP status and the first 300 characters of the provider's error body — quota, wrong model id and wrong base URL are all recognisable from it.
- `401/403` — wrong or revoked key, or the key lacks access to that model. `404` — wrong base URL (most need `/v1`) or model id. `429` — rate limit or out of credit; ORCA cools the key down and retries later. `400 … tool_calls` — the model does not support tools; pick another model or untick *tools*.
- Keys are never logged. The UI shows them masked (`sk-1…ab12`); `GET /api/config` returns the mask only.
- Environment variables such as `OPENAI_API_KEY` are **not** read automatically; paste the key in the UI so it is stored per provider.
