# Security

- The desktop app ships **without any provider API keys**. Built-in models are reached through the ORCA Cloud gateway
  (`gateway/`, a Cloudflare Worker) which holds keys as encrypted Secrets. Keys are never in this repository or in release zips.
- Requests from the app carry an HMAC signature + anonymous install id; the gateway enforces per-IP rate limits and a per-install daily budget.
- Updates are fetched only from this repository's GitHub Releases over HTTPS and verified against `SHA256SUMS` before install.
- Found a problem? Open a private security advisory on GitHub or email the maintainers. Please do not open public issues for vulnerabilities.
