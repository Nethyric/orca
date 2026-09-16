# Security

## What ships in the app

- The repository and release archives contain **no provider API keys**.
- Built-in models are powered by a **sealed vault**: `remote/vault.json` is a ciphertext (X25519 + HKDF‑SHA256 + AES‑256‑GCM) that only a release build can open. The corresponding private key is injected by CI at build time and is never committed. Details: [docs/vault.md](docs/vault.md).
- Keys you add yourself live in your local `config.json` inside the data folder. They are sent only to the provider you configured, never anywhere else.
- Updates are fetched from this repository's GitHub Releases over HTTPS and verified against `SHA256SUMS` before they are applied.
- ORCA has no accounts and sends no telemetry. The only network calls it makes on its own are the update check, the remote-config/vault fetch, and the model requests you trigger.

## Scope of the agent

ORCA executes real commands on your machine. The **Ask** autonomy level requires confirmation for medium/high-risk tool calls; **Auto** confirms only destructive shell commands; **Full auto** confirms nothing. Choose accordingly, and keep the workspace folder pointed at a project directory rather than your home directory.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue. Include the ORCA version, platform and reproduction steps. You will get a response within a few days.
