// THE DROPPED SOCKET — the failure the app showed the owner as a raw node-postgres string, and
// showed itself as four uncaughtExceptions in three seconds.
//
// EVIDENCE (%APPDATA%\everquest-companion-dev\errors.log, 2026-08-05T10:39):
//   [main:uncaughtException] Error: Connection terminated unexpectedly
//       at Connection.<anonymous> (node_modules/pg/lib/client.js:199:73)
// Four of them, ~1s apart. pg's client raises the drop as an ASYNC 'error' EVENT when no query
// is in flight, and an EventEmitter with no 'error' listener THROWS — so the whole main process
// took it as an uncaught exception. `infra/lambda/db.ts` has had that listener since it was
// written; `src/main/triage/store.ts` did not. Four rather than one because the Analytics tab
// reads three tables with `Promise.all` and the cached handle was assigned only after the await,
// so every read opened its OWN socket.
//
// THREE CLAIMS, and each maps to one of those facts:
//   1. LIFECYCLE — an async 'error' is listened for (the emit does not throw), the dead handle is
//      retired so the next statement reconnects, and N parallel statements open ONE connection.
//   2. CLASSIFICATION — a connection failure is told apart from a SQLSTATE, by message OR by the
//      node system-error `code`, and a real SQLSTATE is never mistaken for one.
//   3. THE DEGRADE — the analytics read answers `available:false, state:'unreachable'`, which is
//      the same shape the tab already renders for a missing table, and an error that is NEITHER
//      still throws (a degrade that swallows everything would hide the next real bug).
//
// No AWS, no cluster, no credentials: `makeClients` takes an `open` seam and `awsBackend` takes
// a `Clients` factory, both added for exactly this. The suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { Client as PgClient } from 'pg'
import { makeClients, unreachable, type Clients, type Stack } from '../src/main/triage/store'
import { awsBackend } from '../src/main/triage/backend'
import type { TriageAnalytics } from '../src/shared/triage'

const STACK: Stack = {
  region: 'us-east-1',
  cluster_endpoint: 'nowhere.dsql.us-east-1.on.aws',
  bucket_name: 'bucket',
  triage_role_arn: 'arn:aws:iam::0:role/triage',
  lambda_role_arn: 'arn:aws:iam::0:role/submit',
  telemetry_lambda_role_arn: 'arn:aws:iam::0:role/telemetry',
  api_url: 'https://example.invalid/v1/feedback'
}

/** A pg `Client` as far as this module uses one: an EventEmitter that answers `query`. */
class FakeClient extends EventEmitter {
  rows: Record<string, unknown>[] = [{ n: 1 }]
  fail: Error | null = null
  ended = false
  queries = 0
  query(): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.queries += 1
    if (this.fail) return Promise.reject(this.fail)
    return Promise.resolve({ rows: this.rows, rowCount: this.rows.length })
  }
  end(): Promise<void> {
    this.ended = true
    return Promise.resolve()
  }
}

/** `makeClients` with the real connector replaced. Returns the clients and every client opened. */
function clientsOver(open: () => Promise<FakeClient>): { c: Clients; opened: FakeClient[] } {
  const opened: FakeClient[] = []
  const c = makeClients(STACK, {
    open: async () => {
      const fresh = await open()
      opened.push(fresh)
      return fresh as unknown as PgClient
    }
  })
  return { c, opened }
}

// ---- 1. the connection lifecycle -----------------------------------------------------------

test('an async socket error has a LISTENER — the emit does not throw the process down', async () => {
  const { c, opened } = clientsOver(() => Promise.resolve(new FakeClient()))
  await c.query('SELECT 1')
  const live = opened[0]
  // THE REGRESSION, exactly: `emit('error')` on an EventEmitter with no 'error' listener THROWS
  // synchronously. In the main process that is the uncaughtException in errors.log.
  assert.doesNotThrow(() => live.emit('error', new Error('Connection terminated unexpectedly')))
})

test('a dead handle is RETIRED — the next statement reconnects instead of inheriting a corpse', async () => {
  const { c, opened } = clientsOver(() => Promise.resolve(new FakeClient()))
  await c.query('SELECT 1')
  opened[0].emit('error', new Error('Connection terminated unexpectedly'))
  await c.query('SELECT 1')
  assert.equal(opened.length, 2, 'the second statement opened a fresh connection')
  assert.equal(opened[1].queries, 1)
})

test('THREE PARALLEL READS OPEN ONE SOCKET — the Analytics tab is a Promise.all of three', async () => {
  let opens = 0
  const { c, opened } = clientsOver(async () => {
    opens += 1
    // A real connect awaits a token and a TLS handshake; the point is that the second and third
    // callers arrive DURING it. Before the in-flight promise was cached they each opened one.
    await Promise.resolve()
    return new FakeClient()
  })
  await Promise.all([c.query('SELECT 1'), c.query('SELECT 2'), c.query('SELECT 3')])
  assert.equal(opens, 1)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].queries, 3)
})

test('a FAILED connect is not cached — the next statement tries again', async () => {
  let attempt = 0
  const { c } = clientsOver(() => {
    attempt += 1
    return attempt === 1 ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve(new FakeClient())
  })
  await assert.rejects(() => c.query('SELECT 1'))
  await c.query('SELECT 1')
  assert.equal(attempt, 2)
})

test('close() ends the socket — a live one holds the CLI open until DSQL hangs up at an hour', async () => {
  const { c, opened } = clientsOver(() => Promise.resolve(new FakeClient()))
  await c.query('SELECT 1')
  await c.close()
  assert.equal(opened[0].ended, true)
})

// ---- 2. the classification ------------------------------------------------------------------

test('a connection failure is recognised by MESSAGE and by node system-error CODE', () => {
  // What pg fails every in-flight query with when the socket ends. This is the string the panel
  // used to print verbatim at the owner.
  assert.equal(unreachable(new Error('Connection terminated unexpectedly')), true)
  assert.equal(unreachable(new Error('Connection terminated')), true)
  assert.equal(unreachable(new Error('socket hang up')), true)
  assert.equal(unreachable(new Error('timeout expired')), true)
  // A node system error carries the shape on `code`, and its message may say nothing useful.
  assert.equal(unreachable(Object.assign(new Error('read'), { code: 'ECONNRESET' })), true)
  assert.equal(unreachable(Object.assign(new Error('connect'), { code: 'ETIMEDOUT' })), true)
  assert.equal(unreachable(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' })), true)
})

test('a real SQLSTATE is NEVER a connection failure — the two paths must not steal each other', () => {
  assert.equal(unreachable(Object.assign(new Error('column "cohort" does not exist'), { code: '42703' })), false)
  assert.equal(unreachable(Object.assign(new Error('relation "usage_daily" does not exist'), { code: '42P01' })), false)
  assert.equal(unreachable(Object.assign(new Error('serialization'), { code: '40001' })), false)
  assert.equal(unreachable(new Error('permission denied for table report')), false)
  assert.equal(unreachable(undefined), false)
  assert.equal(unreachable(null), false)
})

// ---- 3. the named degrade the tab renders ----------------------------------------------------

/** A `Clients` whose every statement fails the same way. The s3/stack halves are never reached. */
function failingWith(err: Error): Clients {
  return {
    query: () => Promise.reject(err),
    execute: () => Promise.reject(err),
    s3: {},
    stack: STACK,
    close: () => Promise.resolve()
  } as unknown as Clients
}

/** The unavailable half of the union, having asserted that is what came back. */
function unavailable(a: TriageAnalytics): Extract<TriageAnalytics, { available: false }> {
  assert.equal(a.available, false)
  if (a.available) throw new Error('expected an unavailable readout')
  return a
}

test('a dropped connection resolves to the NAMED unavailable state, not a raw pg string', async () => {
  const backend = awsBackend(() => failingWith(new Error('Connection terminated unexpectedly')))
  const out = unavailable(await backend.analytics(30, false))
  assert.equal(out.state, 'unreachable')
  // It must not send the operator to `migrate`: nothing here is a schema problem.
  assert.doesNotMatch(out.reason, /migrate --refresh/)
  assert.match(out.reason, /stopped answering/i)
})

test('a missing column still resolves to `missing`, naming it — the other degrade is untouched', async () => {
  const err = Object.assign(new Error('column "cohort" does not exist'), { code: '42703' })
  const out = unavailable(await awsBackend(() => failingWith(err)).analytics(30, false))
  assert.equal(out.state, 'missing')
  assert.equal(out.state === 'missing' ? out.missing : null, 'cohort')
  assert.match(out.reason, /migrate --refresh/)
})

test('anything ELSE still throws — a degrade that swallowed everything would hide the next bug', async () => {
  const denied = Object.assign(new Error('permission denied for table usage_daily'), { code: '42501' })
  await assert.rejects(() => awsBackend(() => failingWith(denied)).analytics(30, false), /permission denied/)
})
