# EQ Zera — building on Windows

Everything here runs in PowerShell. Steps 1–2 are one-time.

## 1. Install the toolchain

Run `setup-windows.ps1` from this folder (right-click → Run with PowerShell), or do it by hand:

| Tool | Why | Install |
|---|---|---|
| **Node.js 24** | app build + tests (the test runner needs Node ≥ 21) | `winget install OpenJS.NodeJS` |
| **Git** | version control | `winget install Git.Git` |
| **Rust (rustup)** | the `zengine.exe` engine that parses the log — the app is empty without it | `winget install Rustlang.Rustup` |
| **Visual Studio Build Tools 2022** with the *Desktop development with C++* workload | Rust on Windows needs the MSVC linker | `winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"` |

Close and reopen PowerShell afterwards so PATH is refreshed. Check:

```powershell
node -v      # v24.x
npm -v
git --version
cargo --version   # rustup will auto-install the pinned 1.98.0 toolchain on first build
```

## 2. Install dependencies

```powershell
cd "C:\Users\jackt\EQ Zera\app"
npm ci
npm run deps:electron
```

`.npmrc` sets `ignore-scripts=true` on purpose (supply-chain hardening), which is why
`deps:electron` is a separate explicit step that downloads the Electron binary.

## 3. Build the engine (once, and after any change under `engine/`)

```powershell
npm run build:engine
```

First run takes several minutes (rustup fetches the 1.98.0 toolchain, cargo compiles ~200
crates). Output: `engine\target\release\zengine.exe`.

The release compile of the fold crate peaks near 6 GB of memory across cargo's default sixteen
codegen units. When less than 8 GB is free the script drops to one job and one codegen unit on
its own (it prints a line saying so); that shape finishes in about twice the time. To force it
by hand:

```powershell
$env:CARGO_BUILD_JOBS=1; $env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1; npm run build:engine
```

## 4. Run in development

```powershell
npm run dev
```

The app opens with hot reload. In EverQuest type `/log on`. Dev builds keep their settings in
`%AppData%\everquest-companion-dev\`, separate from an installed build.

## 5. Checks

```powershell
npm run typecheck
npm run lint
npm test
```

## Refreshing the wiki data

```powershell
npm run refresh:data                  # items, then mobs, then quests
npm run refresh:data -- --refresh     # ignore every disk cache and re-fetch
npm run refresh:data -- --only quests # one source (repeatable)
```

Run this before each release. It re-scrapes the three eqlwiki.com datasets in order and prints,
per source, what was added, removed and changed, plus how many mob-to-item drop edges moved.
The scrapers are rate limited to 1 request per second, so a cold run is roughly 527 requests and
takes 10 to 15 minutes; the quests cache is committed, so `--only quests` runs offline in under a
minute, while the items and mobs caches are gitignored and are usually cold. If a source came
back with the same data, the previous `scrapedAt` stamp is put back, so a run that changed
nothing leaves your tree clean and there is nothing to commit.

## 6. Build an installer

```powershell
npm run dist          # → release\<version>\eq-zera-Setup-<version>.exe
npm run dist:dir      # unpacked folder only, faster, for smoke testing
```

The installer is **unsigned** (the upstream Azure signing hook self-skips when its env vars
are absent). Windows SmartScreen will show "Windows protected your PC" on first run; click
*More info → Run anyway*. If electron-builder fails while extracting `winCodeSign`, either turn
on Windows *Developer Mode* (Settings → System → For developers) or run
`scripts\seed-wincodesign.ps1` once.

## Things the fork deliberately left alone

- `src/main/channel.ts` still names the data folder `everquest-companion` so an existing
  install's alerts, settings and history carry over. To move it, mirror the `LEGACY_*` seed
  pattern already in that file.
- Log prefixes like `[everquest-companion]` inside `errors.log` are unchanged; dozens of tests
  pin them and nobody but you reads that file.
- `infra/` (upstream's AWS Terraform) and `site/` (upstream's landing page) are unused.

## Placeholders to fill in when you create a GitHub repo

`CHANGE-ME/eq-zera` appears in `src/main/security.ts` (external-link allowlist),
`src/renderer/src/features/whatsnew/WhatsNewPanel.tsx` (the "release notes" link), and the two
tests that pin them. Replace with `<your-user>/<your-repo>`. To turn self-updates back on
later: add a `publish:` block to `electron-builder.yml`, make `autoUpdateDisabled()` return `false`
in `src/main/updater.ts`, and sign your releases (electron-updater refuses unsigned updates
when `publisherName` is set).

## Git note

The `app\.git` folder was created by a clone attempt that could not finish, and it contains a
stale `index.lock`. Before your first commit, from PowerShell in the `app` folder:

```powershell
Remove-Item -Recurse -Force .git
git init -b main
git add -A
git commit -m "Fork everquest-companion as EQ Zera"
```
