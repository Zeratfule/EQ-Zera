// ============================================================================
// ownerTools.ts — MAIN's half of the owner-tooling gate (JOS-72).
// ============================================================================
//
// The policy is pure and lives in `src/shared/ownerTools.ts` (read the header there for why the
// tier exists at all and why it degrades CLOSED). This file is only the Electron binding: it
// reads the environment ONCE, because env is fixed at launch, and hands the answer to
// `registerDevTriageIpc` in index.ts.
//
// A SIBLING OF `unreleased.ts`, NOT A COPY OF IT. Both are main-side doors and both read one
// env var, but they are opposite polarities on purpose. `UNRELEASED` is open by default in any
// dev run and `EQ_UNRELEASED=1` only FORCES it open in a production-shaped one, because an
// unreleased product surface is credential-free and the owner reviews it every day. `OWNER_TOOLS`
// is shut by default in every run, because what is behind it is one person's AWS account.

import { app } from 'electron'
import { E2E } from './e2e'
import { ownerToolsEnabled } from '../shared/ownerTools'

/** May this process register the owner-only (`triage:*`) IPC surface? Fails closed. */
export const OWNER_TOOLS = ownerToolsEnabled({
  env: process.env,
  isPackaged: app.isPackaged,
  e2e: E2E
})
