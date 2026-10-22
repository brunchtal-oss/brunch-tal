// Dev only (story 5.22): removes the fictional world of the explainer videos
// from the DEV Supabase project, live filming actions included (D6: it
// deletes by itself, after a count and a "y").
//
//   npm run video:clear              # count, guard, ask, delete
//   node scripts/video-clear.mjs --dry-run   # count and guard only
//
// The world is found in the database, without a file: the Auth users on the
// video domain (the filming admin among them) and their profiles, the rows
// the filming admin made, the sessions it created, everything linked to
// them, and the board notes its stored admin_add_note results name (D10).
// The set and its SQL are built in scripts/video-sql.mjs (pure, tested).
//
// 1. A count per table, in a transaction that is rolled back (temp tables
//    only).
// 2. Guards: it stops (exit 1, nothing deleted) when the set touches
//    dev-admin or dev-customer, a board note not traced to the filming
//    admin, a test_ row, a booking of a non-world customer in a world
//    session, or a world payment's customer outside the domain who is not
//    anonymized; it lists the offending rows.
// 3. It asks for "y" (a non-interactive stdin refuses).
// 4. One delete transaction: the set is computed again and the transaction
//    aborts if a count changed; deletes in foreign-key order, with
//    session_replication_role = replica only around the append-only
//    entitlement_movements; the Auth users go in the same transaction.
// Media the filming admin uploaded stay (a warning; the seed creates none).

import { existsSync } from "node:fs"
import { createInterface } from "node:readline/promises"

import pg from "pg"

import { FILMING_ADMIN_EMAIL, VIDEO_DOMAIN } from "./video-cast.mjs"
import {
  COUNT_TABLES,
  DEV_ADMIN_EMAIL,
  countsSql,
  deleteSql,
  guardSql,
  warningsSql,
  worldSetSql,
} from "./video-sql.mjs"
import { devRef } from "./dev-guard.mjs"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const dryRun = process.argv.includes("--dry-run")

if (
  !devRef({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    databaseUrl: process.env.DEV_DATABASE_URL,
  })
) {
  console.error(
    "הסקריפט רץ רק מול פרויקט הפיתוח: DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL. לא נמחק כלום."
  )
  process.exit(1)
}

function connectionConfig(databaseUrl) {
  const parsed = new URL(databaseUrl)
  const sslKeys = ["sslmode", "sslcert", "sslkey", "sslrootcert"]
  parsed.search = new URLSearchParams(
    [...parsed.searchParams].filter(([key]) => !sslKeys.includes(key))
  ).toString()
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
  }
}

const REASONS = {
  dev_account: "חשבון פיתוח (dev-admin או dev-customer)",
  test_row: "שורת test_",
  foreign_booking: "הרשמה של לקוחה שאינה מהעולם במפגש של העולם",
  foreign_waitlist: "המתנה של לקוחה שאינה מהעולם במפגש של העולם",
  foreign_credit_option: "חלופה של זיכוי שאינו מהעולם במפגש של העולם",
  foreign_correction: "תיקון בזכות שאינה מהעולם",
  foreign_customer: "לקוחה בעולם במייל אחר ובלי הסרת פרטים",
  foreign_join_user: "קישור שהתחיל הצטרפות במייל מחוץ לדומיין",
}

const CRON_TABLES = ["notification_deliveries", "notification_jobs", "notifications"]

const client = new pg.Client(connectionConfig(process.env.DEV_DATABASE_URL))

// The set, its counts, guards and warnings, inside the open transaction.
async function inspect() {
  for (const sql of worldSetSql({ adminEmail: FILMING_ADMIN_EMAIL, domain: VIDEO_DOMAIN })) {
    await client.query(sql)
  }
  const counts = (await client.query(countsSql())).rows[0].counts
  const offending = (await client.query(guardSql({ domain: VIDEO_DOMAIN }))).rows
  const warnings = (await client.query(warningsSql())).rows
  return { counts, offending, warnings }
}

const total = (counts) => Object.values(counts).reduce((n, v) => n + Number(v), 0)

async function confirm() {
  if (!process.stdin.isTTY) {
    console.error("אין קלט אינטראקטיבי, ולכן לא נמחק כלום. מריצים בטרמינל ועונים y.")
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question("למחוק את כל השורות האלה? (y למחיקה) ")
    return answer.trim().toLowerCase() === "y"
  } finally {
    rl.close()
  }
}

async function main() {
  await client.connect()
  const devAdmin = await client.query("select 1 from auth.users where lower(email) = $1", [
    DEV_ADMIN_EMAIL,
  ])
  if (devAdmin.rowCount === 0) {
    console.error(`אין אדמין פיתוח (${DEV_ADMIN_EMAIL}), ולכן זה כנראה לא פרויקט הפיתוח. לא נמחק כלום.`)
    process.exitCode = 1
    return
  }

  // 1–2. Count and guard (rolled back: nothing is written).
  await client.query("begin")
  let before
  try {
    before = await inspect()
  } finally {
    await client.query("rollback")
  }

  console.log("העולם של הסרטונים במסד:")
  for (const [table] of COUNT_TABLES) console.log(`  ${table}: ${before.counts[table]}`)
  const media = before.warnings.find((w) => w.kind === "media")
  if (media && media.n > 0) {
    console.log(`אזהרה: ${media.n} קובצי מדיה שאדמין הצילום העלתה נשארים (גם הקבצים ב-Storage).`)
  }
  const oldNotes = before.warnings.filter((w) => w.kind === "old_note")
  if (oldNotes.length > 0) {
    console.log(
      `אזהרה: ${oldNotes.length} פתקים בלוח נוצרו מאז אדמין הצילום, ואין להם תוצאה שמורה (נמחקת אחרי 7 ימים), ולכן הם נשארים. אם הם מהצילום, מוחקים אותם במסך הרשימות:`
    )
    for (const note of oldNotes) {
      const when = new Date(note.created_at).toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
      })
      console.log(`  ${when} · ${note.excerpt} (${note.id})`)
    }
  }
  if (before.offending.length > 0) {
    console.error("")
    console.error("לא נמחק כלום. השורות האלה עוצרות את המחיקה:")
    for (const row of before.offending) {
      console.error(`  ${REASONS[row.reason] ?? row.reason}: ${row.id}`)
    }
    process.exitCode = 1
    return
  }
  if (total(before.counts) === 0) {
    console.log("אין מה למחוק.")
    return
  }
  if (dryRun) {
    console.log("--dry-run: לא נמחק כלום.")
    return
  }
  if (!(await confirm())) {
    console.log("לא נמחק כלום.")
    if (!process.stdin.isTTY) process.exitCode = 1
    return
  }

  // 4. Delete: the set again, the same counts, then FK order.
  await client.query("begin")
  try {
    const again = await inspect()
    // The per-minute cron may write notifications while the prompt waits;
    // they are recomputed and deleted, but do not abort the run.
    const changed = COUNT_TABLES.some(
      ([table]) =>
        !CRON_TABLES.includes(table) &&
        Number(again.counts[table]) !== Number(before.counts[table])
    )
    if (changed || again.offending.length > 0) {
      await client.query("rollback")
      console.error("הנתונים השתנו מאז הספירה, ולכן לא נמחק כלום. מריצים שוב.")
      process.exitCode = 1
      return
    }
    for (const sql of deleteSql()) await client.query(sql)
    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => {})
    throw error
  }
  console.log("")
  console.log(`נמחקו ${total(before.counts)} שורות. אפשר להריץ npm run video:seed.`)
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => client.end().catch(() => {}))
