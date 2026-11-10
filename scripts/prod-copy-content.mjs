// Story 6.1: copies the real site content and the business setup from the
// DEV project to the empty PRODUCTION project.
//
//   node scripts/prod-copy-content.mjs          # dry run: per table, how many
//                                               # rows would be inserted,
//                                               # updated and deleted, and how
//                                               # many image files uploaded
//   node scripts/prod-copy-content.mjs --apply  # copy (only after the
//                                               # user's OK)
//
// Copied (scripts/prod-copy-plan.mjs › TABLES): content_pages,
// content_sections (draft_content and published_content_full; the trigger
// derives published_content), the media rows any copied row references
// (with their source_id chain) and their Storage files, concepts, products,
// payment_methods, marketing_reminder_texts, notification_templates (title,
// body, push) and business_settings (the editable columns). updated_by /
// created_by become null. Never: events, customers, bookings, payments,
// entitlements, credits, waitlist, notifications, jobs, audit, tokens,
// notes, work sheets, push subscriptions, idempotency, rate limits,
// marketing_tags values.
//
// Refuses to run when production holds any profile, event, payment,
// entitlement or booking, or when a copied row is test_ data or mentions
// video.example.com. A rerun reaches the same end state and uploads no file
// that is already there. Files go up first, then every row in one
// transaction (a failure leaves only orphan files, which a rerun reuses).

import {
  connect,
  fail,
  loadDevConfig,
  loadProdConfig,
  serviceClient,
} from "./prod-env.mjs"
import {
  BLOCKING_TABLES,
  copyRow,
  keyOf,
  mediaFiles,
  planTable,
  REFERENCED_MEDIA_SQL,
  refusedRows,
  slotTarget,
  sourceFirst,
  TABLES,
  withoutExcluded,
} from "./prod-copy-plan.mjs"

const apply = process.argv.includes("--apply")

const prodConfig = loadProdConfig()
const devConfig = loadDevConfig(prodConfig.dev)
if (apply && !devConfig.secretKey) {
  fail("חסר SUPABASE_SECRET_KEY ב-.env.local (נדרש להורדת התמונות מהפיתוח).")
}

const spec = (name) => TABLES.find((t) => t.table === name)

async function readRows(client, table, where = "", params = []) {
  const { rows } = await client.query(
    `select to_jsonb(t) as r from public.${table} t ${where}`,
    params
  )
  return rows.map((row) => row.r)
}

async function blockingTables(prod) {
  const found = []
  for (const table of BLOCKING_TABLES) {
    const { rows } = await prod.query(
      `select exists (select 1 from public.${table}) as e`
    )
    if (rows[0].e) found.push(table)
  }
  return found
}

async function storageNames(client, bucket, names) {
  const { rows } = await client.query(
    "select name, metadata ->> 'mimetype' as mimetype from storage.objects where bucket_id = $1 and name = any($2::text[])",
    [bucket, names]
  )
  return new Map(rows.map((row) => [row.name, row.mimetype]))
}

// One row through jsonb_populate_record, so json, arrays and times keep
// their types. Insert or update by the table's key.
async function upsert(client, tableSpec, row) {
  const cols = tableSpec.copy
  const list = cols.map((c) => `"${c}"`).join(", ")
  const updates = cols
    .filter((c) => !tableSpec.key.includes(c))
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ")
  await client.query(
    `insert into public.${tableSpec.table} (${list})
     select ${list} from jsonb_populate_record(null::public.${tableSpec.table}, $1::jsonb)
     on conflict (${tableSpec.key.map((c) => `"${c}"`).join(", ")}) do update set ${updates}`,
    [JSON.stringify(copyRow(tableSpec, row))]
  )
}

async function update(client, tableSpec, row) {
  const cols = tableSpec.copy.filter((c) => !tableSpec.key.includes(c))
  const set = cols.map((c) => `"${c}" = r."${c}"`).join(", ")
  const where = tableSpec.key.map((c) => `t."${c}" = r."${c}"`).join(" and ")
  const result = await client.query(
    `update public.${tableSpec.table} t set ${set}
     from jsonb_populate_record(null::public.${tableSpec.table}, $1::jsonb) r
     where ${where}`,
    [JSON.stringify(copyRow(tableSpec, row))]
  )
  if (result.rowCount !== 1) {
    throw new Error(
      `${tableSpec.table} ${keyOf(tableSpec, row)}: ${result.rowCount} rows`
    )
  }
}

async function remove(client, tableSpec, row) {
  const where = tableSpec.key
    .map((c, i) => `"${c}"::text = $${i + 1}`)
    .join(" and ")
  await client.query(
    `delete from public.${tableSpec.table} where ${where}`,
    tableSpec.key.map((c) => String(row[c]))
  )
}

async function main() {
  const dev = await connect(devConfig.databaseUrl, {
    readOnly: true,
    label: "פרויקט הפיתוח",
  })
  const prod = await connect(prodConfig.databaseUrl, { readOnly: !apply })
  try {
    const blocking = await blockingTables(prod)
    if (blocking.length > 0) {
      fail(
        `בפרודקשן כבר יש נתונים, ולכן ההעתקה לא רצה. טבלאות: ${blocking.join(", ")}`
      )
    }

    // --- the dev side -----------------------------------------------------
    const mediaIds = (await dev.query(REFERENCED_MEDIA_SQL)).rows.map(
      (r) => r.id
    )
    const devRows = {}
    for (const t of TABLES) {
      devRows[t.table] =
        t.table === "media_assets"
          ? await readRows(dev, t.table, "where t.id = any($1::uuid[])", [
              mediaIds,
            ])
          : withoutExcluded(t, await readRows(dev, t.table))
    }
    const refused = TABLES.flatMap((t) => refusedRows(t, devRows[t.table]))
    if (refused.length > 0) {
      console.error(
        "שורות שאסור להעתיק (test_ או video.example.com). מנקים אותן בפיתוח קודם:"
      )
      for (const line of refused) console.error(`  ${line}`)
      process.exit(1)
    }
    const copying = devRows.media_assets.filter(
      (m) => m.publish_state === "copying"
    )
    if (copying.length > 0) {
      fail(
        `תמונות באמצע פרסום בפיתוח (copying), ולכן ההעתקה עוצרת: ${copying.map((m) => m.id).join(", ")}`
      )
    }
    const media = sourceFirst(devRows.media_assets)
    devRows.media_assets = media

    // Every file the copy needs must exist in dev.
    const files = media.flatMap(mediaFiles)
    const devFiles = {
      "media-drafts": await storageNames(
        dev,
        "media-drafts",
        files.filter((f) => f.bucket === "media-drafts").map((f) => f.name)
      ),
      "media-public": await storageNames(
        dev,
        "media-public",
        files.filter((f) => f.bucket === "media-public").map((f) => f.name)
      ),
    }
    const missingDev = files.filter((f) => !devFiles[f.bucket].has(f.name))
    if (missingDev.length > 0) {
      fail(
        `קבצים חסרים באחסון של הפיתוח: ${missingDev.map((f) => `${f.id} (${f.bucket})`).join(", ")}`
      )
    }

    // --- the plan -----------------------------------------------------------
    const prodFiles = {
      "media-drafts": await storageNames(
        prod,
        "media-drafts",
        files.filter((f) => f.bucket === "media-drafts").map((f) => f.name)
      ),
      "media-public": await storageNames(
        prod,
        "media-public",
        files.filter((f) => f.bucket === "media-public").map((f) => f.name)
      ),
    }
    const uploads = files.filter((f) => !prodFiles[f.bucket].has(f.name))
    const plans = {}
    for (const t of TABLES) {
      const prodRows =
        t.table === "media_assets"
          ? await readRows(prod, t.table, "where t.id = any($1::uuid[])", [
              mediaIds,
            ])
          : await readRows(prod, t.table)
      plans[t.table] = planTable(t, devRows[t.table], prodRows)
    }

    console.log(apply ? "העתקה לפרודקשן:" : "הרצה יבשה (שום דבר לא נכתב):")
    for (const t of TABLES) {
      const p = plans[t.table]
      console.log(
        `  ${t.table}: הוספה ${p.insert.length}, עדכון ${p.update.length}, מחיקה ${p.delete.length}, ללא שינוי ${p.same}`
      )
      if (p.unmatched.length > 0) {
        fail(
          `  ${t.table}: שורות שקיימות רק בצד אחד (${p.unmatched.join(", ")}). בודקים שהמיגרציות זהות.`
        )
      }
    }
    console.log(
      `  קובצי תמונה: ${files.length} (${media.length} תמונות), להעלאה ${uploads.length}`
    )
    if (!apply) {
      console.log(
        "כדי להעתיק (רק אחרי אישור המשתמשת): node scripts/prod-copy-content.mjs --apply"
      )
      return
    }

    // --- files first ---------------------------------------------------------
    const devStorage = serviceClient(
      devConfig.supabaseUrl,
      devConfig.secretKey
    ).storage
    const prodStorage = serviceClient(
      prodConfig.supabaseUrl,
      prodConfig.secretKey
    ).storage
    for (const file of uploads) {
      const { data, error } = await devStorage
        .from(file.bucket)
        .download(file.name)
      if (error || !data)
        fail(`הורדה מהפיתוח נכשלה: ${file.id} (${file.bucket})`)
      const contentType =
        devFiles[file.bucket].get(file.name) || data.type || "image/jpeg"
      const { error: upError } = await prodStorage
        .from(file.bucket)
        .upload(file.name, data, { contentType, upsert: false })
      if (upError && !/exists|duplicate/i.test(upError.message ?? "")) {
        fail(
          `העלאה לפרודקשן נכשלה: ${file.id} (${file.bucket}): ${upError.message}`
        )
      }
    }
    console.log(`  הועלו ${uploads.length} קבצים.`)

    // --- rows, in one transaction -------------------------------------------
    await prod.query("begin")
    try {
      const again = await blockingTables(prod)
      if (again.length > 0)
        throw new Error(`production holds data: ${again.join(", ")}`)

      for (const t of TABLES) {
        if (t.table === "content_pages") break
        const p = plans[t.table]
        if (t.table === "marketing_reminder_texts") {
          // The production job may already have recorded slots against the
          // seeded texts (FK, not deferrable). So: the dev rows first, then
          // each slot of a seed moves to a dev text (it is only a
          // once-a-day marker), then the seeds go.
          for (const row of [...p.insert, ...p.update])
            await upsert(prod, t, row)
          for (const old of p.delete) {
            const target = slotTarget(devRows.marketing_reminder_texts, old)
            if (!target) throw new Error("no marketing reminder text in dev")
            await prod.query(
              "update private.marketing_reminder_slots set text_id = $1 where text_id = $2",
              [target.id, old.id]
            )
          }
          for (const row of p.delete) await remove(prod, t, row)
          continue
        }
        for (const row of p.delete) await remove(prod, t, row)
        if (t.mode === "update") {
          for (const row of p.update) await update(prod, t, row)
        } else {
          for (const row of [...p.insert, ...p.update])
            await upsert(prod, t, row)
        }
      }

      // Pages before their sections; a page dev no longer has goes last.
      const pages = plans.content_pages
      const sections = plans.content_sections
      for (const row of [...pages.insert, ...pages.update]) {
        await upsert(prod, spec("content_pages"), row)
      }
      for (const row of sections.delete)
        await remove(prod, spec("content_sections"), row)
      for (const row of [...sections.insert, ...sections.update]) {
        await upsert(prod, spec("content_sections"), row)
      }
      for (const row of pages.delete)
        await remove(prod, spec("content_pages"), row)

      await prod.query("commit")
    } catch (error) {
      await prod.query("rollback").catch(() => {})
      fail(`ההעתקה נכשלה ובוטלה (ROLLBACK): ${error.message}`)
    }
    console.log("ההעתקה הושלמה. הבדיקה: node scripts/prod-check.mjs")
  } finally {
    await dev.end().catch(() => {})
    await prod.end().catch(() => {})
  }
}

main().catch((error) => {
  console.error(`prod-copy-content נכשל: ${error.message}`)
  process.exit(1)
})
