// Story 6.1: builds the empty production database from supabase/migrations.
//
//   node scripts/prod-migrate.mjs --rehearse  # every file, in version order,
//                                             # in ONE transaction, then
//                                             # ROLLBACK (nothing is kept)
//   node scripts/prod-migrate.mjs             # dry run: supabase db push
//                                             # --dry-run (lists the files)
//   node scripts/prod-migrate.mjs --apply     # dry run, then the real push
//                                             # (one transaction per file,
//                                             # stops at the first failure,
//                                             # resumable), then compares
//                                             # schema_migrations with the
//                                             # files
//
// Only against the production project (scripts/prod-env.mjs). --apply only
// after the user's explicit OK. The rehearsal and the dry run may run any
// time. The connection string is never printed: the CLI's output is shown
// with it (and its password, user and host) replaced by "***", and the
// password goes to the CLI through PGPASSWORD, not its command line.

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import {
  connect,
  databaseUrlSecrets,
  fail,
  loadProdConfig,
  redact,
} from "./prod-env.mjs"

const MIGRATIONS_DIR = "supabase/migrations"
// The CLI version this runbook was written against (`--remote=<url>`
// replaced `--db-url`).
const SUPABASE_CLI = "supabase@3.1.0"

const rehearse = process.argv.includes("--rehearse")
const apply = process.argv.includes("--apply")
if (rehearse && apply) fail("--rehearse ו---apply לא באים יחד.")

/** The migration files in version order: [{ version, name, file }]. */
function migrationFiles() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
  return files.map((file) => {
    const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(file)
    if (!match) fail(`שם קובץ מיגרציה לא תקין: ${file}`)
    return { version: match[1], name: match[2], file }
  })
}

const config = loadProdConfig()
const files = migrationFiles()

async function runRehearsal() {
  const client = await connect(config.databaseUrl)
  try {
    const { rows } = await client.query(`
      select
        to_regclass('supabase_migrations.schema_migrations') is not null as has_history,
        (select count(*)::int from pg_tables where schemaname = 'public') as public_tables`)
    if (rows[0].has_history || rows[0].public_tables > 0) {
      fail(
        "מסד הפרודקשן לא ריק (יש בו טבלאות או היסטוריית מיגרציות). החזרה רצה רק על מסד ריק."
      )
    }
    console.log(`חזרה: ${files.length} קבצים, בעסקה אחת שמתגלגלת אחורה.`)
    // A migration that sets a statement timeout of its own keeps it; the
    // whole run gets no limit of its own.
    await client.query("set statement_timeout = 0")
    await client.query("begin")
    try {
      for (const { file } of files) {
        const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
        try {
          await client.query(text)
        } catch (error) {
          const { code, message } = /** @type {{ code?: string, message?: string }} */ (error)
          console.error(`נכשל: ${file}`)
          console.error(`SQLSTATE ${code ?? "?"}: ${message ?? ""}`)
          console.error("שום דבר לא נשמר (ROLLBACK).")
          process.exitCode = 1
          return
        }
      }
      console.log(`OK: ${files.length} קבצים רצו בלי שגיאה. שום דבר לא נשמר (ROLLBACK).`)
    } finally {
      await client.query("rollback").catch(() => {})
    }
  } finally {
    await client.end().catch(() => {})
  }
}

// npm's npx next to this node binary (Windows: <node dir>/node_modules,
// Unix: <prefix>/lib/node_modules), so no shell parses the URL.
function npxCli() {
  const base = dirname(process.execPath)
  const candidates = [
    join(base, "node_modules", "npm", "bin", "npx-cli.js"),
    join(base, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ]
  const found = candidates.find((path) => existsSync(path))
  if (!found) fail("לא נמצא npx של Node. מריצים מ-Node 24 שהותקן עם npm.")
  return found
}

// The password never reaches the command line (process listings): the
// CLI gets the URL without it and reads PGPASSWORD (checked with CLI 3.1.0).
function remoteWithoutPassword() {
  const parsed = new URL(config.databaseUrl)
  const password = decodeURIComponent(parsed.password)
  parsed.password = ""
  return { remote: parsed.toString(), password }
}

function push({ dryRun }) {
  const { remote, password } = remoteWithoutPassword()
  const args = [
    npxCli(),
    "--yes",
    SUPABASE_CLI,
    "db",
    "push",
    `--remote=${remote}`,
    "--skip-vault",
    ...(dryRun ? ["--dry-run"] : ["--yes"]),
  ]
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PGPASSWORD: password },
  })
  const secrets = databaseUrlSecrets(config.databaseUrl)
  const output = redact(`${result.stdout ?? ""}${result.stderr ?? ""}`, secrets)
  if (output.trim()) console.log(output.trimEnd())
  if (result.error) fail(`ה-CLI לא הופעל: ${redact(result.error.message, secrets)}`)
  if (result.status !== 0) fail(`supabase db push נכשל (קוד ${result.status}).`)
}

async function compareHistory() {
  const client = await connect(config.databaseUrl, { readOnly: true })
  try {
    const { rows } = await client.query(
      "select version, name from supabase_migrations.schema_migrations order by version"
    )
    const actual = rows.map((row) => `${row.version}_${row.name}`)
    const expected = files.map((f) => `${f.version}_${f.name}`)
    const missing = expected.filter((v) => !actual.includes(v))
    const extra = actual.filter((v) => !expected.includes(v))
    if (missing.length === 0 && extra.length === 0) {
      console.log(`✓ schema_migrations תואם לקבצים (${expected.length}).`)
      return
    }
    for (const v of missing) console.error(`✗ חסר במסד: ${v}`)
    for (const v of extra) console.error(`✗ במסד ולא בקבצים: ${v}`)
    process.exitCode = 1
  } finally {
    await client.end().catch(() => {})
  }
}

async function main() {
  if (rehearse) return runRehearsal()
  console.log(`הרצה יבשה (supabase db push --dry-run), ${files.length} קבצים במאגר:`)
  push({ dryRun: true })
  if (!apply) {
    console.log("כדי להחיל (רק אחרי אישור המשתמשת): node scripts/prod-migrate.mjs --apply")
    return
  }
  console.log("")
  console.log("מחילים (supabase db push):")
  push({ dryRun: false })
  await compareHistory()
}

main().catch((error) => {
  console.error(`prod-migrate נכשל: ${redact(error.message, databaseUrlSecrets(config.databaseUrl))}`)
  process.exit(1)
})
