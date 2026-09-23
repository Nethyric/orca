# MCP — Model Context Protocol

ORCA ships a minimal, dependency-free MCP client. It lets any MCP tool server extend the agent with
extra tools — filesystems, databases, browsers, search APIs, your own services — without writing code.

Manage servers in **Settings → MCP**.

## Transports

| Transport | How it runs | Typical use |
|---|---|---|
| `stdio` | ORCA spawns the server as a local subprocess and talks JSON-RPC over its stdin/stdout | `npx -y @modelcontextprotocol/server-filesystem /path` |
| Streamable HTTP | ORCA connects to a URL (`POST` JSON-RPC, optional SSE stream) | hosted servers, e.g. `https://huggingface.co/mcp` |
| HTTP+SSE (legacy) | automatic fallback for older HTTP servers that only speak the SSE transport | legacy hosted servers |

`stdio` servers spawn lazily (on first use) and are restarted quietly if they exit. HTTP servers are
probed on connect and reconnect on the next call.

## Adding a server

**From a preset.** One click adds a ready-made configuration: Filesystem, Fetch, Git, GitHub, Memory,
Brave Search, Playwright, Hugging Face. Presets that need a key (GitHub, Brave, Hugging Face) ask for
it once and store it locally.

**By hand.**

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/projects"]
  },
  "hf": {
    "url": "https://huggingface.co/mcp",
    "headers": { "Authorization": "Bearer hf_..." }
  }
}
```

**Import from Claude Desktop.** Paste an existing `mcpServers` block as-is — the same JSON shape is
accepted, so a configuration that works in Claude Desktop works in ORCA.

## Per-server options

- **Tool toggles** — enable or disable individual tools without removing the server.
- **Compact mode** — the server's tool schemas stay out of the model context; the agent discovers
  them on demand. Useful for servers that expose dozens of tools.
- **Environment variables** — for `stdio` servers (`env` map), merged over a sanitized environment.

## Security model

- Tool manifests are **fingerprinted**: if a server silently redefines its tools between sessions,
  ORCA notices and re-presents the new definitions instead of trusting cached ones.
- Every MCP result is injected into the conversation as **untrusted content** — data, never
  instructions — and is covered by the same prompt-injection guard as web and file content.
- MCP tool calls obey the app's autonomy setting: in `ask` mode each new tool needs one approval,
  in `auto` mode high-risk calls (per the decision engine's command-risk review) still stop and ask.
- `stdio` servers run with the privileges of the ORCA process; only add servers whose packages you
  trust, and pin versions (`npx -y @scope/server@1.2.3`) when you want reproducible behaviour.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Server shows *failed to start* | Run the same `command args` in a terminal; usually `npx` is not on PATH or the package name is wrong |
| HTTP server: *401* | The `Authorization` header is missing or the token expired |
| Tools appear but do nothing | Check the per-tool toggle and the server's own logs (Settings → MCP → server → log) |
| Too many tools crowd the context | Enable **compact** mode for that server |

See [tools.md](tools.md) for ORCA's built-in tools, and [configuration.md](configuration.md) for how
MCP servers are stored in `config.json`.
