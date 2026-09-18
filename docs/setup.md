# Setup

## Requirements

| | Release builds | From source |
|---|---|---|
| OS | Windows 10/11 x64 · macOS 12+ (x64, arm64) · Linux x64 (glibc 2.31+) | Windows, macOS, Linux |
| Runtime | none (bundled) | Node.js ≥ 20, npm |
| Optional | Python 3 (`run_python`), Chrome/Edge (`screenshot`, `browser_check`) | same, plus `ffmpeg`/`yt-dlp` on PATH for media tools |

## Install a release

All assets are on the [Releases](https://github.com/Nethyric/orca/releases/latest) page together with `SHA256SUMS` (verify with `sha256sum -c SHA256SUMS --ignore-missing` or `certutil -hashfile <file> SHA256`).

### Windows

1. Download `ORCA-Agent-<version>-win-x64.zip`.
2. Extract anywhere (e.g. `C:\Apps\ORCA`) and run `ORCA.exe`. Nothing is installed system-wide; delete the folder to uninstall.

Windows SmartScreen may warn because the executable is not code-signed — choose *More info → Run anyway*.

### macOS

1. Download `ORCA-Agent-<version>-mac-arm64.dmg` (Apple Silicon) or `ORCA-Agent-<version>-mac-x64.dmg` (Intel); the `.zip` variants contain the same app bundle.
2. Open the image and drag **ORCA Agent** to *Applications*.
3. First launch: the app is not notarized, so right-click → *Open* → *Open* (once), or run `xattr -dr com.apple.quarantine "/Applications/ORCA Agent.app"`.

### Linux

- **AppImage** (any distribution): `chmod +x ORCA-Agent-<version>-linux-x64.AppImage && ./ORCA-Agent-<version>-linux-x64.AppImage`. Needs FUSE 2 (`sudo apt install libfuse2` on Ubuntu 22.04+); without it, run with `--appimage-extract-and-run`.
- **tar.gz**: `tar xzf ORCA-Agent-<version>-linux-x64.tar.gz && ./ORCA-Agent-<version>-linux-x64/orca-agent`.
- On hardened kernels that block unprivileged user namespaces, add `--no-sandbox`.

### Updates

ORCA checks GitHub Releases on start and every few hours and shows a banner with the release notes (Settings → Updates). The package for your platform and CPU is downloaded and verified against `SHA256SUMS`, then:

- **Windows**: the app swaps itself in place and restarts.
- **Linux AppImage**: the AppImage file is replaced in place and relaunched.
- **macOS / Linux tar.gz**: the verified package is revealed in your file manager — drop it over the current install and relaunch.

## Run from source

```bash
git clone https://github.com/Nethyric/orca.git
cd orca
npm install
npm run fetch-bins      # optional: ffmpeg.exe, yt-dlp.exe, OCR language data (needed for media/OCR tools)
npm start               # Electron desktop app
npm run web             # or plain web mode → http://localhost:7860
```

A source checkout does **not** include the vault private key, so the *built-in* models are unavailable until you either add a provider of your own (Settings → Models) or, as a maintainer, export `ORCA_VAULT_KEY` (see [vault.md](vault.md)).

## Folders

| | Desktop app | Web mode |
|---|---|---|
| Data folder | `%APPDATA%\ORCA Agent\data` · `~/Library/Application Support/ORCA Agent/data` · `~/.config/ORCA Agent/data` | `~/.orca` |
| Workspace | `<data>/workspace` | `<data>/workspace` |

Both can be changed: the workspace in **Settings → General**, the data folder with `ORCA_DATA` (web mode). The workspace is the only place tools read and write; point it at your project.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | Web-mode port (default `7860`) |
| `HOST` | Web-mode bind address (default `127.0.0.1`; set `0.0.0.0` to expose on your network — there is no authentication, so only do this behind a firewall or an authenticating reverse proxy) |
| `ORCA_DATA` | Data folder (web mode / scripts) |
| `ORCA_VAULT_KEY` | Vault private key (PKCS8, base64). Lets a source build open the sealed vault |
| `ORCA_VAULT_URL` | Override the vault URL (testing) |
| `ORCA_DEV=1` | Enables `POST /api/update/simulate` for testing the update banner |

`.env.example` lists them; ORCA does not read `.env` itself — export them in your shell or CI.

## Build

```bash
npm run fetch-bins                      # once per target platform (ORCA_TARGET=win|mac|linux, ORCA_ARCH=x64|arm64)
ORCA_VAULT_KEY=... npm run dist:win     # → release/ORCA-Agent-<version>-win-x64.zip          (builds on any OS)
ORCA_VAULT_KEY=... npm run dist:mac     # → release/ORCA-Agent-<version>-mac-{x64,arm64}.{zip,dmg}   (macOS only)
ORCA_VAULT_KEY=... npm run dist:linux   # → release/ORCA-Agent-<version>-linux-x64.{AppImage,tar.gz}
```

`scripts/bake.js` writes `src/build-info.json` (vault key, commit, build time) which is git-ignored and packed into the app. The Windows build runs on Linux/macOS too (no Wine needed: `signAndEditExecutable` is off; `scripts/finish-win.js` renames the exe and zips the folder). macOS builds are unsigned (`identity: null`); Linux builds bundle `ffmpeg`/`yt-dlp` for x64.

## Maintainers

### One-time

1. Fork/clone, then `npm run set-repo -- YourName/your-repo` (rewrites repo links).
2. `npm run vault:keygen -- --write` → prints a private key and writes the public key into `orca.config.json`. Keep the private key secret.
3. GitHub → Settings → Secrets and variables → Actions:
   - `ORCA_VAULT_KEY` — the private key from step 2
   - `UPSTREAMS` — JSON describing the built-in providers/keys (format in [vault.md](vault.md))
4. Actions → **Seal vault** → *Run workflow*. It validates each key, encrypts `UPSTREAMS` to the public key and commits `remote/vault.json`.

### Release

```bash
npm version 0.0.4 --no-git-tag-version   # or edit package.json
git commit -am "0.0.4" && git tag v0.0.4 && git push && git push --tags
```

The **Release** workflow builds all three platforms in parallel (Windows on Ubuntu, macOS on `macos-14`, Linux on Ubuntu), merges one `SHA256SUMS`, attaches `remote/vault.json`, and publishes the GitHub Release. Installed apps pick it up on their next check.

### Rotate or replace built-in keys

Edit the `UPSTREAMS` secret → Actions → **Seal vault** → *Run workflow*. Running apps refresh the vault within 15 minutes; nothing else changes and no release is needed. Dead keys are skipped automatically (cool-down and per-key health tracking), so even an exhausted key is not user-visible.
