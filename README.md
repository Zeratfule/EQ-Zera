# EQ Zera

**Website and download:** [eqzera.com](https://eqzera.com)

A Windows desktop companion for **EverQuest Legends**. It reads the log file the game already
writes and turns it into live views: a DPS meter, floating overlays, Plane of Sky quest tracking,
loot and item knowledge, XP/AA progress, raid-target history, buff timers, and sound alerts.

**It only reads your log.** Nothing is injected into EverQuest, no game files are touched, no
memory is read, nothing is automated.

## Origin

EQ Zera is a fork of [everquest-companion](https://github.com/jmoyers/everquest-companion)
("EQ Legends Companion") by Josh Moyers, whose development ended in September 2026. The upstream
README is preserved as [`README.upstream.md`](README.upstream.md); the upstream architecture
guide is [`AGENTS.md`](AGENTS.md) and is still the best map of the code.

## What changed in the fork

- **Renamed** to EQ Zera (the upstream license reserves the original product name).
- **The Z Engine.** The Rust log engine (`engine/`) is the fork's own line of development now: the
  process is `zengine.exe`, its cost on a real log is measured by `npm run engine:baseline` and
  recorded under `docs/zengine/`, and the program of work is in `docs/zengine/README.md`.
- **Auto-update is on, and releases are signed.** The feed is this repository's GitHub
  Releases (`publish:` in `electron-builder.yml`); every release from v1.20.1 is signed through
  Azure Trusted Signing under the publisher "Jack Thomas", and the app refuses an update that is
  not. SECURITY.md has the details.
- **Telemetry and feedback are dark.** No endpoint is compiled in
  (`src/main/telemetry/net.ts`, `src/main/feedback/net.ts`). Nothing leaves your machine
  except the same third-party lookups upstream made: eqlwiki.com (items/mobs/images),
  the community sound-pack registry, and the on-demand Kokoro voice model download.
- Upstream CI workflows are parked in `.github/workflows-upstream-disabled/`; the fork's own
  are `.github/workflows/ci.yml` and `release.yml` (tag-driven, signed builds).
- Settings still live in `%AppData%\everquest-companion\` so an existing install's data is
  picked up unchanged.

## Building

See [`SETUP.md`](SETUP.md). Feature plans are in [`ROADMAP.md`](ROADMAP.md).

## License

Functional Source License 1.1 with MIT future license (FSL-1.1-MIT). See [`LICENSE`](LICENSE)
and [`NOTICE`](NOTICE). In short: use, modify, and share it freely for any non-commercial
purpose; do not sell it or offer it as a paid service until the MIT conversion date.
Copyright (c) 2026 Josh Moyers (original work).
