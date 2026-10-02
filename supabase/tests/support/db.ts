// Database test support (`npm run test:db`). Tests talk to the DEV Supabase
// project directly through `pg`, as the connection's owner role, so they can
// call private helpers and switch to `authenticated` inside a transaction.
//
// Connection: DEV_DATABASE_URL in .env.local, the Supavisor *session* pooler
// (port 5432), never the transaction pooler (6543): tests use SET LOCAL and
// session state. Fictitious data only; every row a test creates is prefixed
// with `runId` and removed in `onCleanup`.

import { randomBytes, randomUUID } from "node:crypto"

import pg from "pg"

export type Db = pg.PoolClient

/**
 * Validates DEV_DATABASE_URL before anything connects: it must exist and
 * point at the same project ref as NEXT_PUBLIC_SUPABASE_URL (the dev
 * project), so the tests can never run against another database.
 */
export function devDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const url = env.DEV_DATABASE_URL
  if (!url) {
    throw new Error(
      "DEV_DATABASE_URL is missing. Add the DEV project's session pooler connection string (port 5432) to .env.local; see .env.example."
    )
  }
  const apiUrl = env.NEXT_PUBLIC_SUPABASE_URL
  let ref: string | undefined
  try {
    // A hosted Supabase project: https://<20-char ref>.supabase.co. A local
    // stack (127.0.0.1) or any other host has no ref and is refused.
    ref = apiUrl
      ? /^([a-z0-9]{20})[.]supabase[.]co$/.exec(new URL(apiUrl).hostname)?.[1]
      : undefined
  } catch {
    ref = undefined
  }
  if (!ref) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing or is not a hosted Supabase project URL (https://<ref>.supabase.co) in .env.local, so DEV_DATABASE_URL cannot be checked against the dev project ref."
    )
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Never echo the string or attach the original error as `cause`: both
    // may contain the password.
    throw new Error(
      "DEV_DATABASE_URL is not a valid URL. Percent-encode special characters in the password (for example @ as %40)."
    )
  }
  // The ref must be the pooler user (postgres.<ref>) or the direct host
  // (db.<ref>.supabase.co), not just appear somewhere (password, query).
  const matchesRef =
    parsed.username === `postgres.${ref}` ||
    parsed.hostname === `db.${ref}.supabase.co`
  if (!matchesRef) {
    throw new Error(
      "DEV_DATABASE_URL does not contain the project ref of NEXT_PUBLIC_SUPABASE_URL. Database tests run only against the DEV project."
    )
  }
  return url
}

// SSL without certificate verification: dev project, fictitious data only.
// Any sslmode in the string is dropped, because pg lets the string override
// the `ssl` option.
function connectionConfig(url: string): pg.PoolConfig {
  const parsed = new URL(url)
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    parsed.searchParams.delete(key)
  }
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
    // Serial test files share one small budget on the pooler.
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 15_000,
    // Session settings, so a stuck test fails instead of holding locks or a
    // pooler slot. Supavisor drops startup parameters, so they are set with
    // SET; the pool waits for onConnect before handing the client out.
    onConnect: async (client) => {
      await client.query(
        "set statement_timeout = '15s'; set idle_in_transaction_session_timeout = '30s'"
      )
    },
  }
}

let pool: pg.Pool | undefined

/** The shared pool, created on first use (after the env check). */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool(connectionConfig(devDatabaseUrl()))
    // An idle client dropped by the pooler emits "error" on the pool; without
    // a listener it would crash the test process.
    pool.on("error", (error) => {
      console.error(`db tests: idle client error: ${error.message}`)
    })
  }
  return pool
}

/** Ends the pool; called once per test file from setup.ts. */
export async function endPool(): Promise<void> {
  const current = pool
  pool = undefined
  await current?.end()
}

/** Runs one statement on the pool. */
export async function sql<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<Row[]> {
  const result = await getPool().query<Row>(text, params)
  return result.rows
}

/** Unique per test file run: `test_<random>`. */
export const runId = `test_${randomBytes(6).toString("hex")}`

/** A name for fictitious data of this run, e.g. `test_ab12cd34ef56_alice`. */
export function testName(label: string): string {
  return `${runId}_${label}`
}

const cleanups: Array<() => Promise<unknown>> = []

/** Registers a cleanup; setup.ts runs them in reverse order in afterAll. */
export function onCleanup(fn: () => Promise<unknown>): void {
  cleanups.push(fn)
}

/** Runs every registered cleanup (latest first). Throws the first failure. */
export async function runCleanups(): Promise<void> {
  let firstError: unknown
  while (cleanups.length > 0) {
    const fn = cleanups.pop()!
    try {
      await fn()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError) throw firstError
}

/**
 * Runs `fn` inside a transaction that is always rolled back, so nothing it
 * writes survives. Use it for anything that changes data or role.
 */
export async function inRollback<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  let result: T
  try {
    await client.query("begin")
    result = await fn(client)
  } catch (error) {
    // Keep fn's error; a failed rollback only destroys the client.
    await client.query("rollback").then(
      () => client.release(),
      (rollbackError: Error) => client.release(rollbackError)
    )
    throw error
  }
  try {
    await client.query("rollback")
  } catch (rollbackError) {
    // A client whose rollback failed must not go back to the pool.
    client.release(rollbackError as Error)
    throw rollbackError
  }
  client.release()
  return result
}

/**
 * Inside an open transaction (inRollback), acts as a signed-in user: role
 * `authenticated` and JWT claims whose `sub` is `userId`, so `auth.uid()`
 * returns it. Both settings are local to the transaction.
 */
export async function asAuthenticated(db: Db, userId: string): Promise<void> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" })
  await db.query(
    "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
    [claims, userId]
  )
  await db.query("set local role authenticated")
  // Outside a transaction SET LOCAL only warns and the test would silently
  // run as the owner.
  const { rows } = await db.query<{ role: string }>(
    "select current_user as role"
  )
  if (rows[0]?.role !== "authenticated") {
    throw new Error(
      "asAuthenticated must run inside an open transaction (use inRollback)."
    )
  }
}

/**
 * Inside an open transaction (inRollback), acts as the service role: role
 * `service_role` and JWT claims with `role: service_role`, so
 * `auth.role()` returns it. Both settings are local to the transaction; use
 * `reset role` to go back to the owner for checks.
 */
export async function asServiceRole(db: Db): Promise<void> {
  const claims = JSON.stringify({ role: "service_role" })
  await db.query(
    // claim.sub is cleared so auth.uid() does not keep a previous user.
    "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claim.sub', '', true)",
    [claims]
  )
  await db.query("set local role service_role")
  const { rows } = await db.query<{ role: string; jwt_role: string | null }>(
    "select current_user as role, auth.role() as jwt_role"
  )
  if (
    rows[0]?.role !== "service_role" ||
    rows[0]?.jwt_role !== "service_role"
  ) {
    throw new Error(
      "asServiceRole must run inside an open transaction (use inRollback)."
    )
  }
}

/**
 * Inside an open transaction (inRollback), as the owner: a fictitious Auth
 * user (a row in auth.users) with the email `test_<runId>_<label>@example.test`,
 * so it is rolled back with the transaction and never reaches Auth. `id`
 * defaults to a new uuid (pass join_begin's pending_user_id to stand in for
 * the Admin API's createUser).
 */
export async function insertAuthUser(
  db: Db,
  label: string,
  { id = randomUUID() }: { id?: string } = {}
): Promise<{ id: string; email: string }> {
  const email = `${testName(label)}@example.test`.toLowerCase()
  await db.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', $2, '', now(), now(), now(), '{}', '{}')`,
    [id, email]
  )
  return { id, email }
}

/**
 * Runs one statement inside a savepoint and returns its error (`code` is the
 * SQLSTATE, `message` the raised text, e.g. P0001 / LINK_USED), or null when
 * it succeeded. The savepoint keeps the surrounding transaction usable.
 */
export async function queryError(
  db: Db,
  text: string,
  params: unknown[] = []
): Promise<{ code: string; message: string } | null> {
  await db.query("savepoint query_error")
  try {
    await db.query(text, params)
    await db.query("release savepoint query_error")
    return null
  } catch (error) {
    await db.query("rollback to savepoint query_error")
    const { code, message } = error as { code?: string; message?: string }
    return { code: code ?? "", message: message ?? "" }
  }
}
