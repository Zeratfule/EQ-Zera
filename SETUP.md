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

## Releasing

The repo is `Zeratfule/EQ-Zera`. Two workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does | Token |
|---|---|---|---|
| `ci.yml` | push to `main`, every pull request | typecheck, lint, `npm test`, builds the engine and the installer, and the Rust job (fmt, clippy, `cargo test --workspace`, the release performance budget, the factoring ratchet). The installer is kept as a **workflow artifact for 14 days** — never published. | read-only |
| `release.yml` | push of a `v*` tag | the same gates, then publishes a **GitHub Release** with the installer | `contents: write` |

Those are two files rather than two jobs because GitHub token permissions are per-job and
static: one workflow covering both paths would have to hold write access on every push to
`main`, which would hand a writable repo token to `npm ci` and the whole third-party build on a
path that publishes nothing.

### Cutting a release

1. **Write the release note first.** Add an entry for the version to
   `src/shared/releaseNotes.ts` — at most three sentences per entry. `release.yml` runs
   `scripts/check-release-notes.mjs` as its *first* step and refuses a tag with no entry. The
   app's What's new panel reads that file, so a missing entry is not a crash, it is silence.
   Check it locally with `node --import tsx scripts/check-release-notes.mjs v1.19.0`.
2. Commit and push that to `main`, and let CI go green.
3. Tag and push:

   ```powershell
   git tag v1.19.0
   git push origin v1.19.0
   ```

`package.json` stays at `0.1.0` forever — **the tag is the version**. CI rewrites
`package.json` in the runner only (`npm version --no-git-tag-version`, never committed), so a
`v1.19.0` tag builds `1.19.0` and the two cannot drift. A tag that is not
`vMAJOR.MINOR.PATCH` is rejected before anything is built.

The release lands at `https://github.com/Zeratfule/EQ-Zera/releases`, carrying
`eq-zera-Setup-<version>.exe`, its `.blockmap`, `latest.yml`, and a byte copy of `latest.yml`
named `main.yml` (the update feed's default channel lives in the *filename*, so the copy is
the whole bridge). It is assembled as a **draft**, every required asset is verified to be
present, and only then does it flip live — so nobody can resolve the tag and find a file
missing. A plain `vX.Y.Z` publishes as a normal release and takes the `latest` marker; a tag
with a prerelease part (`v1.19.0-rc.1`) publishes as a prerelease and does not.

Sourcemaps go to a **private workflow artifact**, named after the tag, kept 90 days — never a
release asset. They are what `scripts/symbolicate.mts` needs to turn a bundle position in an
error report back into a source line, and they only work for the exact build they came from.

### The installer is unsigned

There is no code-signing certificate for this project yet, so `scripts/azure-sign.cjs`
self-skips and the published `.exe` carries no Authenticode signature. Windows SmartScreen
shows "Windows protected your PC" on first run; the user clicks *More info → Run anyway*. The
release body says so, in those words.

**Because the build is unsigned, the GitHub account is the trust root.** Anyone who can publish
a release here can put any executable on that page. Tag and release access *is* the security
control; `SECURITY.md` states this to users.

### The two switches that turn self-update on

Self-update is off, and it takes both of these — flipping either alone makes things worse, not
better:

1. **`src/main/updater.ts`** — `autoUpdateDisabled()` returns `true`. Make it return `false`.
2. **Signing secrets in CI** — add the certificate to the repo (below) and give
   `release.yml`'s "Build installer and publish" step the matching `env:` block.

The order is not optional. `electron-builder.yml` sets
`win.signtoolOptions.publisherName: EQ Zera`, and electron-updater's
`NsisUpdater.verifySignature` **rejects** any downloaded update whose Authenticode publisher
does not match that name. Flipping the constant while releases are unsigned does not produce
"updates with a warning" — it produces an updater that downloads a build and then refuses it,
every time. (Clearing `publisherName` instead would make the updater skip signature checking
altogether, which is worse: it turns a silent, per-user, no-UAC auto-install into something
that trusts whatever the feed hands it.)

`electron-builder.yml` already has its `publish:` block, so nothing else needs adding there.

### Getting a certificate

Two roads, and the hook in this tree already supports the first:

- **Azure Trusted Signing** (~$10/month, Microsoft-run). No hardware token, no certificate file
  in CI, and the certificate is short-lived and re-issued automatically — which is why
  `scripts/azure-sign.cjs` exists and is wired permanently into `win.signtoolOptions.sign`. It
  self-activates on six environment variables: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
  `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`,
  `AZURE_SIGNING_PROFILE`. Add them as repo secrets, pass them into the packaging step, and the
  step also needs `Install-Module TrustedSigning -Scope CurrentUser` ahead of the build.
  Requires an identity-verified Azure account; individual publishers face a 3-year
  verification-history requirement, which is the usual blocker. Set `publisherName` to the
  signing profile's subject CN exactly.
- **A conventional OV or EV certificate** from a CA (DigiCert, Sectigo, SSL.com — roughly
  $200–$600/year). electron-builder loads it from `CSC_LINK` (a base64 `.pfx` or a URL) plus
  `CSC_KEY_PASSWORD`, both as repo secrets; no hook change is needed, and the Azure hook stays
  inert because its env vars are absent. Since June 2023 the private key must live on an HSM or
  a hardware token for a *new* certificate, which is awkward for unattended CI — most CAs sell
  a cloud-HSM option that works with `CSC_LINK`. An **EV** certificate additionally clears
  SmartScreen's reputation warning immediately; an **OV** one still warns until the build has
  accumulated downloads.

Whichever road, the certificate's subject CN and `publisherName` must match character for
character, or every update is rejected.

## Git note

The repository is `github.com/Zeratfule/EQ-Zera` (public, default branch `main`) since 2026-09-08.
The folder's original `.git` was a clone attempt that never finished; it was replaced with a fresh
`git init -b main` before the first commit, so there is nothing left to clean up. Pushes work from
the GitHub CLI (`gh auth login --web`) or from GitHub Desktop.
