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

**A local `npm run dist` build is unsigned, and that is deliberate**: `scripts/azure-sign.cjs`
self-skips when `AZURE_SIGNING_ENDPOINT` is empty, so a developer machine needs no signing
credentials and no configuration. Windows SmartScreen will show "Windows protected your PC"
when you run one; click *More info → Run anyway*. **Released builds are signed** - CI injects
the Azure credentials; see "Signing" under Releasing. If electron-builder fails while extracting
`winCodeSign`, either turn on Windows *Developer Mode* (Settings → System → For developers) or
run `scripts\seed-wincodesign.ps1` once.

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

### The installer is signed (since v1.20.1, 2026-09-09)

CI signs the app `.exe`, the bundled `zengine.exe` and the installer with **Azure Trusted
Signing** (Microsoft renamed it Artifact Signing). The certificate subject is
`CN=Jack Thomas, O=Jack Thomas, L=Traverse City, S=mi, C=US`; Windows shows **Jack Thomas** as
the publisher in the installer's UAC and SmartScreen dialogs. A Trusted Signing certificate
carries Microsoft-attached reputation, so the "Windows protected your PC" screen is expected to
stop appearing - the honest claim is that this is the signature Windows trusts and that
reputation attaches to, not that it will never warn about anything.

**The signature is a second trust root alongside the GitHub account.** Anyone who could publish
a release here could still put a file on the page, but an installed copy will not take an
update that is not signed as "Jack Thomas" (see the next section). Tag and release access is
still a security control, it is just no longer the only one; `SECURITY.md` states this to users.

**Local builds stay unsigned.** `scripts/azure-sign.cjs` self-skips when
`AZURE_SIGNING_ENDPOINT` is empty, so `npm run dist` on a developer machine needs nothing.

### Self-update is ON — cutting a tag ships an update to every install

**Every install polls this repo's releases and steps itself up to whatever you tag.** A user
sees a card on the celebration overlay saying the new build is ready, clicks it to download,
and clicks again to restart into it; a build they downloaded and never restarted for is applied
the next time they close the app. There is no manual step on their side and no way to recall a
release once installs have seen it. So a tag is a deliberate act, never a tidy-up: if the build
is bad, the fix is another tag.

Three files carry the switch, and they already agree:

1. **`src/main/updater.ts`** — `autoUpdateDisabled()` returns `false`.
2. **`electron-builder.yml`** — the `publish:` block names `Zeratfule/EQ-Zera`, which is what
   writes `app-update.yml` into the package.
3. **`.github/workflows/release.yml`** — publishes the installer, its `.blockmap`, `latest.yml`
   and the `main.yml` bridge copy on every `v*` tag, and verifies all four are present before
   it flips the release live.

**It ships signed, and both halves of the update check are armed.** The feed and the installer
come over HTTPS and electron-updater verifies the installer's sha512 against `latest.yml`, so a
*tampered download* fails. Authenticode verification is on as well:
`win.signtoolOptions.publisherName: Jack Thomas` in `electron-builder.yml` is what
app-builder-lib copies into the packaged `app-update.yml`, and that is what
`NsisUpdater.verifySignature` compares the downloaded installer's signer CN against. A mismatch,
or no signature at all, is `ERR_UPDATER_INVALID_SIGNATURE` and the update never runs. Nothing in
`src/main/updater.ts` is involved in the switch.

**`publisherName` must match the certificate's subject CN character for character**, and the
order of operations is the thing to get right. The failure mode to avoid is `publisherName` set
while releases go out unsigned: every update then downloads and is then rejected, forever. That
is why signing is armed by a repository variable (below) rather than by the secrets alone.

**The 2026-09-08 to 2026-09-09 window, for the record.** v1.19.0 through v1.20.0 went out
unsigned with `publisherName` commented out, which was the owner's explicit call at go-live.
Installs on those builds carry no publisher name in their `app-update.yml`, so their signature
check skips and they accept the first signed update normally. From v1.20.1 on, every update
must be signed.

### How signing is wired, and the one manual step left

**Azure Trusted Signing / Artifact Signing** (~$10/month, Microsoft-run). No hardware token and
no certificate file in CI: the certificate is short-lived and re-issued automatically, which is
why `scripts/azure-sign.cjs` exists and is wired permanently into `win.signtoolOptions.sign`
instead of a static `CSC_LINK`.

- **Account** `eqzera`, resource group `eq-zera-signing`, East US, endpoint
  `https://eus.codesigning.azure.net`.
- **Certificate profile** `eqzera-public`, type **PublicTrust**, built on an **individual**
  public identity validation (id `dabd72c6-44c7-4960-adea-f8abdba14ac4`). Subject:
  `CN=Jack Thomas, O=Jack Thomas, L=Traverse City, S=mi, C=US`, which is the value of
  `win.signtoolOptions.publisherName`.
- **Six repository secrets**, all passed into the packaging step by `release.yml`:
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`,
  `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`. That step also runs
  `Install-Module TrustedSigning -Scope CurrentUser` before the build.
- **One repository variable, `SIGNING_ENABLED`, is the actual switch**, and it has been `true`
  since 2026-09-09 (`gh variable set SIGNING_ENABLED --body true`). `release.yml` forwards
  `AZURE_SIGNING_ENDPOINT` only when the variable is the string `true` and passes an empty
  string otherwise; the endpoint is the hook's only trigger, so a blank one makes the hook
  self-skip and the build come out unsigned. **Why the extra switch exists:** the secrets were
  stored days before the certificate profile did, because identity validation takes days, and
  **v1.19.4's build failed** on the sign hook running against a profile that was not there yet.
  Setting the variable to anything but `true` turns signing off again with no edit to secrets or
  YAML.
- **Renewal and rotation are automatic.** Azure re-issues the certificate every few days. There
  is nothing to do per release, and the subject CN does not change, so `publisherName` does not
  move either.
- **The one manual step ever needed again:** if the **identity validation** expires - an
  individual validation lasts about a year and Azure emails ahead of it - renew it in the portal
  under **Identity validations → Renew**. If the CN comes back different, change
  `publisherName` in `electron-builder.yml` to match it character for character, or every update
  is rejected.

**The road not taken, and why it costs one hand-written line.** A conventional OV or EV
certificate from a CA (DigiCert, Sectigo, SSL.com, roughly $200 to $600 a year) is loaded by
electron-builder itself from `CSC_LINK` plus `CSC_KEY_PASSWORD`, so its CN would land in
`app-update.yml` automatically. The Azure hook never hands app-builder-lib a certificate to
inspect, so on this road the publisher name has to be written out by hand, and that is exactly
what the `publisherName` line in `electron-builder.yml` is.

## Git note

The repository is `github.com/Zeratfule/EQ-Zera` (public, default branch `main`) since 2026-09-08.
The folder's original `.git` was a clone attempt that never finished; it was replaced with a fresh
`git init -b main` before the first commit, so there is nothing left to clean up. Pushes work from
the GitHub CLI (`gh auth login --web`) or from GitHub Desktop.
