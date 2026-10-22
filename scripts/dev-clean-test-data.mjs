// Dev only (story 5.20, fix 8): removes test data that a killed `npm run
// test:db` left in the DEV project (rows named `test_...`, and everything
// that hangs on them), in foreign-key order, in one transaction.
//
//   node scripts/dev-clean-test-data.mjs           # dry run: the plan only
//   node scripts/dev-clean-test-data.mjs --apply   # the plan, then delete
//
// Runs only against the DEV project (DEV_DATABASE_URL must carry the ref of
// NEXT_PUBLIC_SUPABASE_URL, scripts/dev-guard.mjs). The dry run reads only
// (a read-only transaction) and prints how many rows each table would lose.
// Protected records (the dev customer and admin, the demo customers, "גלית
// ותיקה בדויה") are checked first: if any is touched, nothing is deleted.
// Profiles without an Auth user that are not test data are only listed,
// for a manual look. --apply only with the user's OK (spec 5.20).
// The rules live in scripts/dev-clean-test-data-plan.mjs (tested).

import { existsSync } from "node:fs"

import pg from "pg"

import {
  ORPHAN_PROFILES_SQL,
  PROTECTED_DOMAIN,
  PROTECTED_EMAILS,
  PROTECTED_NAMES,
  PROTECTED_SQL,
  PROTECTION_CHECKS,
  SETS,
  STEPS,
  bind,
} from "./dev-clean-test-data-plan.mjs"
import { devRef } from "./dev-guard.mjs"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const apply = process.argv.includes("--apply")

if (
  !devRef({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    databaseUrl: process.env.DEV_DATABASE_URL,
  })
) {
  console.error(
    "הסקריפט רץ רק מול פרויקט הפיתוח: DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL."
  )
  process.exit(1)
}

// SSL without certificate verification, as supabase/tests/support/db.ts
// (dev project, fictitious data only).
function connectionConfig(url) {
  const parsed = new URL(url)
  const sslKeys = ["sslmode", "sslcert", "sslkey", "sslrootcert"]
  parsed.search = new URLSearchParams(
    [...parsed.searchParams].filter(([key]) => !sslKeys.includes(key))
  ).toString()
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
  }
}

async function main() {
  const client = new pg.Client(connectionConfig(process.env.DEV_DATABASE_URL))
  await client.connect()
  let open = false
  try {
    await client.query(apply ? "begin" : "begin read only")
    open = true
    const run = async (sql, values) => {
      const bound = bind(sql, values)
      return (await client.query(bound.text, bound.values)).rows
    }

    const values = {
      EMAILS: PROTECTED_EMAILS,
      DOMAIN: PROTECTED_DOMAIN,
      NAMES: PROTECTED_NAMES,
    }
    values.PROT = (await run(PROTECTED_SQL, values)).map((r) => r.id)
    for (const [name, sql] of SETS) {
      values[name] = [...new Set((await run(sql, values)).map((r) => r.id))]
    }

    const problems = []
    for (const [label, sql] of PROTECTION_CHECKS) {
      const [{ count }] = await run(sql, values)
      if (Number(count) > 0) problems.push(`${label}: ${count}`)
    }
    if (problems.length > 0) {
      console.error("נמצאה רשומה מוגנת בתוכנית המחיקה, ולכן לא נמחק כלום:")
      for (const problem of problems) console.error(`  ${problem}`)
      process.exitCode = 1
      return
    }

    console.log(
      apply ? "התוכנית (תימחק עכשיו):" : "התוכנית (הרצה יבשה, לא נמחק כלום):"
    )
    let total = 0
    for (const step of STEPS) {
      const [{ count }] = await run(
        `select count(*)::integer as count from ${step.table} where ${step.where}`,
        values
      )
      total += count
      if (count > 0) console.log(`  ${step.table}: ${count}`)
    }
    if (total === 0) console.log("  אין נתוני בדיקה במסד.")

    const orphans = (await run(ORPHAN_PROFILES_SQL, values)).map((r) => r.id)
    if (orphans.length > 0) {
      console.log(
        `פרופילים בלי משתמשת Auth שאינם נתוני בדיקה (לבדיקה ידנית, לא נמחקים): ${orphans.length}`
      )
      for (const id of orphans) console.log(`  ${id}`)
    }

    if (!apply || total === 0) {
      await client.query("rollback")
      open = false
      if (!apply && total > 0) {
        console.log("כדי למחוק: node scripts/dev-clean-test-data.mjs --apply")
      }
      return
    }

    for (const step of STEPS) {
      if (step.replica) {
        await client.query("set local session_replication_role = replica")
      }
      const bound = bind(
        `delete from ${step.table} where ${step.where}`,
        values
      )
      await client.query(bound.text, bound.values)
      if (step.replica) {
        await client.query("set local session_replication_role = origin")
      }
    }
    await client.query("commit")
    open = false
    console.log(`נמחקו ${total} שורות של נתוני בדיקה.`)
  } finally {
    if (open) await client.query("rollback").catch(() => {})
    await client.end()
  }
}

main().catch((error) => {
  // Never the connection string or row values: the message only.
  console.error(`הניקוי נכשל: ${error.message}`)
  process.exit(1)
})
