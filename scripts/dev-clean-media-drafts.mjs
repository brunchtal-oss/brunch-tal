// Dev only (story 5.20, deferred 5.4): removes photo uploads that were
// never used. A candidate is a media_assets row still in `draft`, older than
// 7 days, that no content (draft or published, of a section or a page), no
// session and no concept names. Published and hidden rows are never
// touched (a hidden image keeps its draft file: re-publishing uses it).
//
//   node scripts/dev-clean-media-drafts.mjs           # dry run: the list
//   node scripts/dev-clean-media-drafts.mjs --apply   # remove them
//
// --apply deletes each row, one at a time, in a transaction that checks it
// again under a lock, and after the commit removes its file from the
// private media-drafts bucket through the Storage API (service role). A
// failed file removal leaves an orphan file (harmless), never a row
// without its file. Only against the DEV
// project (scripts/dev-guard.mjs), and only with the user's OK (spec 5.20).
// Production is decided in story 6.1.

import { existsSync } from "node:fs"

import { createClient } from "@supabase/supabase-js"
import pg from "pg"

import { devRef } from "./dev-guard.mjs"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const apply = process.argv.includes("--apply")
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!devRef({ supabaseUrl: url, databaseUrl: process.env.DEV_DATABASE_URL })) {
  console.error(
    "הסקריפט רץ רק מול פרויקט הפיתוח: DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL."
  )
  process.exit(1)
}
if (apply && !secretKey) {
  console.error("חסר SUPABASE_SECRET_KEY ב-.env.local (נדרש למחיקת הקבצים).")
  process.exit(1)
}

// The unused drafts; with `for update` when one row is checked again.
const CANDIDATES = `
  select m.id, m.storage_path, m.created_at
  from public.media_assets m
  where m.publish_state = 'draft'
    and m.created_at < now() - interval '7 days'
    and not exists (
      select 1 from public.content_sections s
      where strpos(coalesce(s.draft_content::text, ''), m.id::text) > 0
         or strpos(coalesce(s.published_content::text, ''), m.id::text) > 0
         or strpos(coalesce(s.published_content_full::text, ''), m.id::text) > 0
    )
    and not exists (
      select 1 from public.content_pages p
      where strpos(coalesce(p.draft_content::text, ''), m.id::text) > 0
         or strpos(coalesce(p.published_content::text, ''), m.id::text) > 0
    )
    and not exists (select 1 from public.events e where e.image_id = m.id)
    and not exists (
      select 1 from public.concepts c where c.default_image_id = m.id
    )`

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

async function main() {
  const client = new pg.Client(connectionConfig(process.env.DEV_DATABASE_URL))
  await client.connect()
  try {
    const { rows } = await client.query(
      `${CANDIDATES} order by m.created_at, m.id`
    )
    if (rows.length === 0) {
      console.log("אין טיוטות תמונה שלא בשימוש.")
      return
    }
    console.log(
      `${rows.length} טיוטות תמונה שלא בשימוש (בנות יותר מ-7 ימים)${apply ? ", נמחקות עכשיו:" : ":"}`
    )
    for (const row of rows) {
      console.log(`  ${row.id} (${row.created_at.toISOString().slice(0, 10)})`)
    }
    if (!apply) {
      console.log("כדי למחוק: node scripts/dev-clean-media-drafts.mjs --apply")
      return
    }

    const storage = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage.from("media-drafts")
    let removed = 0
    for (const row of rows) {
      await client.query("begin")
      try {
        const again = await client.query(
          `${CANDIDATES} and m.id = $1 for update of m`,
          [row.id]
        )
        if (again.rows.length === 0) {
          await client.query("rollback")
          continue
        }
        await client.query(
          "delete from public.media_assets where id = $1 and publish_state = 'draft'",
          [row.id]
        )
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => {})
        console.error(`  ${row.id}: ${error.message}`)
        continue
      }
      removed += 1
      const { error } = await storage.remove([row.storage_path])
      if (error) {
        console.error(`  ${row.id}: הקובץ לא נמחק (${error.message})`)
      }
    }
    console.log(`נמחקו ${removed} טיוטות.`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(`הניקוי נכשל: ${error.message}`)
  process.exit(1)
})
