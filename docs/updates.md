# Updates & releases

ORCA updates itself. There is no separate updater binary and nothing to install: the packaged app
checks the release channel, downloads the right package in the background, verifies it and swaps
itself on restart. Manage everything in **Settings → Updates**.

## The release feed

Every release is a GitHub Release on this repository:

- one package per platform and CPU (`win-x64.zip`, `mac-x64`/`mac-arm64` `.zip` + `.dmg`,
  `linux-x64` `.AppImage`, `.tar.gz`, `.deb`),
- a `SHA256SUMS` manifest listing the digest of every package,
- release notes generated from [CHANGELOG.md](../CHANGELOG.md).

The app resolves the newest release through the GitHub API and falls back to the
`releases/latest/download/SHA256SUMS` redirect when the API is rate-limited or blocked.

## How an update runs

1. **Check** — automatic every few hours, or on demand (Settings → Updates → *Check now*). The
   version string is compared semver-wise against the installed build.
2. **Download** — in the background, resumable with `Range` requests. When `github.com` does not
   answer, public mirrors are tried. A stalled connection (no bytes for 45 s) moves to the next
   source. You can cancel at any time; the partial file is kept and resumed later.
3. **Verify** — the bytes are checked against the release's SHA-256 digest (from the GitHub API)
   *and* the `SHA256SUMS` manifest. A package without a trusted checksum is refused outright; a
   mismatching file is discarded. Mirrors may carry bytes, but never define what is valid.
4. **Install on restart** — the swap happens while the app is closed and it relaunches itself:

| Platform | Mechanism |
|---|---|
| Windows (installed, NSIS) | the next `ORCA-Setup-*.exe` is downloaded and run silently (`/S`) after the app exits; the installer replaces the install folder and relaunches the app |
| Windows (portable exe) | the single portable file replaces itself after exit and relaunches (the launched stub is never locked while the app runs from its temporary extract) |
| Windows (legacy folder zip) | the app folder is replaced (PowerShell helper with `cmd` fallback; robocopy when a rename is refused; the previous folder is restored if the swap fails) |
| macOS (`.app` bundle) | the bundle is replaced in place with a built-in zip reader that preserves symlinks and file modes; the quarantine flag is cleared and the app reopens |
| Linux AppImage | the AppImage file replaces itself and relaunches |
| Linux tar.gz | the app folder is swapped and relaunched |

Your data (chats, checkpoints, memory, configuration) lives in the data folder and is never touched
by an update.

## Channels and versions

`orca.config.json` carries the `repo` and `updateChannel` the updater follows (`stable` by default).
Pre-releases (tags containing `-`, e.g. `v1.1.0-beta.1`) are published as GitHub pre-releases and are
only offered to installs on a matching channel.

## Manual install / update

Download the package for your system from [Releases](https://github.com/Nethyric/orca/releases/latest),
check it against `SHA256SUMS` (`sha256sum -c SHA256SUMS`), and replace your existing installation:

- **Windows** — run `ORCA-Setup-<version>-win-x64.exe` (per-user installer, no admin rights, folder of your choice) or keep `ORCA-<version>-win-x64-portable.exe` as a single file; the zip remains for automated/legacy installs.
- **macOS** — drag the app from the `.dmg` (or the `.zip`) to Applications, replacing the old one.
  Builds are not notarized: first launch via right-click → **Open**.
- **Linux** — `chmod +x` the AppImage and run it, extract the tar.gz, or install the `.deb`
  (`sudo apt install ./ORCA-Agent-*.deb`).

## Running from source

A development checkout cannot replace itself (there is no packaged folder to swap); the Updates tab
shows the pending package location instead. Update with `git pull && npm install`.

## Building releases (maintainers)

Releases are produced by GitHub Actions on every `v*` tag (`.github/workflows/release.yml`):
Windows x64 is cross-built on Linux (icon and version resources embedded with `resedit`, portable
zip assembled by `scripts/finish-win.js`), macOS x64 and arm64 are built on their own runners with
matching bundled binaries, Linux x64 is built natively. The publish job collects every artifact,
writes `SHA256SUMS`, extracts the changelog section for the tag and creates the GitHub Release —
which is exactly the feed the updater consumes.

See [setup.md](setup.md#maintainers) for the vault key and key-rotation workflows.
