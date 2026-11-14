// Story 6.1: the read-only checks of the production project, one line each
// (✓ / ✗; a few add indented detail lines below); exit 1 when any line is ✗.
//
//   node scripts/prod-check.mjs
//
// Both sessions (prod, and dev for the comparisons) are
// default_transaction_read_only. Vault values are never read out: only
// whether they are filled, whether app_url is the production URL and the
// sha256 of cron_secret (compared with PROD_CRON_SECRET) leave the
// database. Besides those (fix-after-6-11): pg_net's error message of a
// worker call without a status (cut to 120 characters, a Bearer token and
// PROD_CRON_SECRET masked), and for failed push jobs their time, type,
// attempts and last_error code, the count of sent jobs, and each failed
// recipient's subscriptions (created_at, platform) under a running number;
// never an id, name, email or endpoint. The one request with an effect: POST /api/jobs/push with
// PROD_CRON_SECRET, which runs the push worker once, exactly as pg_cron
// does. "Copied tables equal dev" holds right after the
// copy; once Tal edits content or settings in production, those lines are
// expected to differ.

import { createHash } from "node:crypto"
import { readdirSync } from "node:fs"

import {
  connect,
  loadDevConfig,
  loadProdConfig,
  PROD_SITE_URL,
} from "./prod-env.mjs"
import {
  compareColumns,
  keyOf,
  mediaFiles,
  REFERENCED_MEDIA_SQL,
  refusedRows,
  rowHash,
  TABLES,
  withoutExcluded,
} from "./prod-copy-plan.mjs"

const CRON_JOBS = [
  "auto_extend",
  "cleanup",
  "complete_events",
  "expiry_alerts",
  "invoke_push_worker",
  "marketing_reminders",
  "refresh_credit_options",
  "reminders",
]
const LEGAL_PAGES = ["privacy", "terms", "accessibility", "cookie-notice"]

const prodConfig = loadProdConfig()
const devConfig = loadDevConfig(prodConfig.dev)

let failed = 0
function line(ok, text) {
  if (!ok) failed += 1
  console.log(`${ok ? "✓" : "✗"} ${text}`)
}

async function readRows(client, table, where = "", params = []) {
  const { rows } = await client.query(
    `select to_jsonb(t) as r from public.${table} t ${where}`,
    params
  )
  return rows.map((row) => row.r)
}

async function checkMigrations(prod) {
  const all = readdirSync("supabase/migrations").filter((f) =>
    f.endsWith(".sql")
  )
  const badNames = all.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f))
  line(
    badNames.length === 0,
    `שמות קובצי המיגרציה תקינים${badNames.length ? `; לא תקינים: ${badNames.join(", ")}` : ""}`
  )
  const files = all
    .filter((f) => !badNames.includes(f))
    .map((f) => f.replace(/\.sql$/, ""))
    .sort()
  const { rows: exists } = await prod.query(
    "select to_regclass('supabase_migrations.schema_migrations') is not null as e"
  )
  const rows = exists[0].e
    ? (
        await prod.query(
          "select version || '_' || name as v from supabase_migrations.schema_migrations order by version"
        )
      ).rows
    : []
  const actual = rows.map((r) => r.v)
  const same =
    actual.length === files.length && actual.every((v, i) => v === files[i])
  line(same, `schema_migrations תואם לקבצים (${actual.length}/${files.length})`)
}

async function checkCron(prod) {
  const { rows } = await prod.query(
    "select jobname, active from cron.job order by jobname"
  )
  const active = rows.filter((r) => r.active).map((r) => r.jobname)
  const missing = CRON_JOBS.filter((j) => !active.includes(j))
  line(
    missing.length === 0 && rows.length === CRON_JOBS.length,
    `8 משימות pg_cron פעילות (${active.length}${missing.length ? `; חסרות: ${missing.join(", ")}` : ""})`
  )
}

const CRON_SECRET_HINT =
  "חסר PROD_CRON_SECRET ב-.env.prod.local (שורה חמישית, אותו ערך כמו CRON_SECRET ב-Vercel Production וכמו cron_secret ב-Vault)"

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex")

// Only hashes and booleans leave the database; no secret is printed.
async function checkVault(prod) {
  const { rows } = await prod.query(
    `select name,
       coalesce(btrim(decrypted_secret), '') <> '' as filled,
       rtrim(btrim(coalesce(decrypted_secret, '')), '/') = $1 as is_prod_url,
       encode(sha256(convert_to(btrim(coalesce(decrypted_secret, '')), 'UTF8')), 'hex') as h
     from vault.decrypted_secrets where name in ('app_url', 'cron_secret')`,
    [PROD_SITE_URL]
  )
  const byName = new Map(rows.map((r) => [r.name, r]))
  line(Boolean(byName.get("cron_secret")?.filled), "Vault: cron_secret מולא")
  line(
    Boolean(byName.get("app_url")?.is_prod_url),
    `Vault: app_url = ${PROD_SITE_URL}`
  )
  if (!prodConfig.cronSecret) {
    line(false, `Vault: cron_secret = PROD_CRON_SECRET (${CRON_SECRET_HINT})`)
  } else {
    line(
      byName.get("cron_secret")?.h === sha256(prodConfig.cronSecret),
      "Vault: cron_secret = PROD_CRON_SECRET"
    )
  }
}

// The whole chain: Vercel's CRON_SECRET accepts PROD_CRON_SECRET at the
// lock-exempt worker route (200; it runs the worker once, as pg_cron does).
async function checkPushRoute() {
  if (!prodConfig.cronSecret) {
    line(false, `POST /api/jobs/push (${CRON_SECRET_HINT})`)
    return
  }
  let status
  try {
    const response = await fetch(`${PROD_SITE_URL}/api/jobs/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${prodConfig.cronSecret}` },
    })
    status = response.status
  } catch {
    status = "network"
  }
  line(
    status === 200,
    `POST ${PROD_SITE_URL}/api/jobs/push עם PROD_CRON_SECRET: ${status}${
      status === 401
        ? " (CRON_SECRET ב-Vercel Production שונה)"
        : status === 503
          ? " (חסר CRON_SECRET או VAPID ב-Vercel Production)"
          : ""
    }`
  )
}

async function checkCronRuns(prod) {
  const { rows } = await prod.query(
    `select count(*)::int as n from cron.job_run_details d
     join cron.job j on j.jobid = d.jobid
     where j.jobname = 'invoke_push_worker' and d.status = 'succeeded'
       and d.end_time > now() - interval '10 minutes'`
  )
  line(
    rows[0].n > 0,
    "המשימה invoke_push_worker רצה בהצלחה ב-10 הדקות האחרונות"
  )
}

// Dashboard settings that the database or Auth expose read-only.
async function checkAuthSettings() {
  let settings = null
  try {
    const response = await fetch(`${prodConfig.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: prodConfig.publishableKey },
    })
    if (response.ok) settings = await response.json()
  } catch {
    settings = null
  }
  if (!settings) {
    line(false, "הגדרות Auth (/auth/v1/settings) לא נקראו")
    return
  }
  line(settings.disable_signup === true, "Auth: הרשמה ציבורית כבויה")
  line(
    settings.external?.anonymous_users !== true,
    "Auth: כניסה אנונימית כבויה"
  )
  line(
    settings.mailer_autoconfirm === true,
    "Auth: Confirm email כבוי (mailer_autoconfirm)"
  )
}

async function checkDatabaseSettings(prod) {
  const { rows: graphql } = await prod.query(
    "select count(*)::int as n from pg_extension where extname = 'pg_graphql'"
  )
  line(graphql[0].n === 0, "pg_graphql לא מותקן")
  const { rows: noRls } = await prod.query(
    `select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
     order by 1`
  )
  line(
    noRls.length === 0,
    `RLS פעיל בכל טבלה ב-public${noRls.length ? `; בלי: ${noRls.map((r) => r.relname).join(", ")}` : ""}`
  )
}

// A response without a status: pg_net's error message (no headers are kept
// in it), cut to 120 characters; a Bearer token or PROD_CRON_SECRET is
// masked anyway.
function responseLabel(r) {
  if (r.timed_out) return "timeout"
  if (r.status_code != null) return String(r.status_code)
  let msg = String(r.error_msg ?? "no status").replace(
    /Bearer\s+\S+/gi,
    "Bearer ***"
  )
  if (prodConfig.cronSecret) msg = msg.split(prodConfig.cronSecret).join("***")
  return `error: ${msg.replace(/\s+/g, " ").trim().slice(0, 120)}`
}

// Story 6.11: emails go out through pg_net too (private.send_email), so
// only the worker's responses count: the request ids of the emails are in
// private.email_requests (before the 6.11 migration it does not exist: a ✗
// line, not a crash).
async function checkPushWorker(prod) {
  const { rows: table } = await prod.query(
    "select to_regclass('private.email_requests') is not null as ok"
  )
  if (!table[0].ok) {
    line(
      false,
      "invoke_push_worker: חסרה הטבלה private.email_requests (המיגרציות של 6.11 עוד לא הוחלו)"
    )
    return
  }
  const { rows } = await prod.query(
    `select r.status_code, r.timed_out, r.error_msg from net._http_response r
     where not exists (
       select 1 from private.email_requests e where e.request_id = r.id
     )
     order by r.created desc limit 10`
  )
  if (rows.length > 0) {
    const bad = rows.filter((r) => r.status_code !== 200)
    line(
      bad.length === 0,
      `תגובות אחרונות של invoke_push_worker: ${rows.length - bad.length}/${rows.length} עם 200${bad.length ? ` (אחרות: ${bad.map(responseLabel).join(", ")})` : ""}`
    )
    return
  }
  // No call in pg_net's retention (6 hours): fine only when no push job
  // was due for the worker.
  const { rows: due } = await prod.query(
    `select count(*)::int as n from public.notification_jobs
     where status = 'queued' and next_attempt_at < now() - interval '2 minutes'`
  )
  line(
    due[0].n === 0,
    due[0].n === 0
      ? "invoke_push_worker: אין קריאות ב-6 השעות האחרונות, ואין התראה שמחכה"
      : `invoke_push_worker: ${due[0].n} התראות מחכות ואין קריאה (בודקים Vault ו-CRON_SECRET)`
  )
}

// fix-after-6-11: the failed push jobs of the last 7 days (the same rule as
// push_failed in admin_get_attention_items), each with its time, type,
// attempts and last_error (error codes only, e.g. HTTP_403), next to the
// jobs sent in the same 7 days, and the subscriptions of the failed jobs'
// recipients (created_at, platform), each recipient shown only as a number
// ("נמענת 1") that ties her jobs to her subscriptions. One old broken
// subscription and a VAPID key pair that fails every push look different
// here. Never the recipient's id, a subscription id or an endpoint.
const AT = (col) =>
  `to_char(${col} at time zone 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI')`

async function checkFailedPushes(prod) {
  const { rows: sent } = await prod.query(
    `select count(*)::int as n from public.notification_jobs
     where status = 'sent' and finished_at >= now() - interval '7 days'`
  )
  // One query, so the numbering is the same for jobs and subscriptions.
  const { rows } = await prod.query(
    `with failed as (
       select j.finished_at, n.type, j.attempt_count, j.last_error,
         n.recipient_id,
         dense_rank() over (order by n.recipient_id)::int as k
       from public.notification_jobs j
       join public.notifications n on n.id = j.notification_id
       where j.status = 'failed' and j.finished_at >= now() - interval '7 days'
     )
     select 'job' as kind, f.k, ${AT("f.finished_at")} as at, f.type,
       f.attempt_count, f.last_error, null::text as platform, f.finished_at as t
     from failed f
     union all
     select 'sub', r.k, ${AT("s.created_at")}, null, null, null, s.platform,
       s.created_at
     from (select distinct recipient_id, k from failed) r
     join public.push_subscriptions s on s.user_id = r.recipient_id
     order by 2, 1, 8 desc`
  )
  const jobs = rows.filter((r) => r.kind === "job")
  line(
    jobs.length === 0,
    `התראות פוש שנכשלו ב-7 הימים האחרונים: ${jobs.length} (נשלחו: ${sent[0].n})`
  )
  for (const k of [...new Set(rows.map((r) => r.k))]) {
    const subs = rows.filter((r) => r.k === k && r.kind === "sub")
    console.log(`    נמענת ${k} (מנויים: ${subs.length})`)
    for (const r of rows.filter((x) => x.k === k && x.kind === "job")) {
      console.log(
        `      ${r.at} · ${r.type} · ${r.attempt_count} ניסיונות · ${r.last_error ?? "-"}`
      )
    }
    for (const s of subs)
      console.log(`      מנוי נרשם ${s.at} · ${s.platform ?? "-"}`)
  }
}

// Story 6.11: the email setup the database can show, read-only: the names
// of the Resend key and of the site's address in Vault (never their values)
// and the Send Email Hook function. Whether the hook is switched on is seen
// only in the dashboard (Authentication -> Hooks; README runbook).
async function checkEmail(prod) {
  const { rows } = await prod.query(
    `select
       exists (select 1 from vault.secrets where name = 'resend_api_key') as has_key,
       exists (select 1 from vault.secrets where name = 'site_url') as has_site,
       to_regprocedure('public.send_email_hook(jsonb)') is not null as has_hook`
  )
  line(rows[0].has_key, "Vault: resend_api_key קיים (השם בלבד)")
  line(rows[0].has_site, "Vault: site_url קיים (השם בלבד; קישור האיפוס במייל)")
  line(rows[0].has_hook, "פונקציית ה-hook public.send_email_hook קיימת")
}

async function checkMarketingTags(prod) {
  const { rows } = await prod.query(
    `select count(*)::int as n,
       count(*) filter (where ga4_measurement_id is null and gtm_container_id is null
         and meta_pixel_id is null)::int as empty
     from public.marketing_tags`
  )
  line(
    rows[0].n === 1 && rows[0].empty === 1,
    "marketing_tags: שורה אחת, שלושת המזהים ריקים"
  )
}

async function checkLegalPages(prod) {
  const { rows } = await prod.query(
    `select p.slug,
       p.published_version > 0 as page_published,
       count(s.id)::int as sections,
       count(s.id) filter (where s.published_at is null)::int as unpublished
     from public.content_pages p
     left join public.content_sections s on s.page_slug = p.slug
     where p.slug = any($1::text[])
     group by p.slug, p.published_version`,
    [LEGAL_PAGES]
  )
  for (const slug of LEGAL_PAGES) {
    const r = rows.find((row) => row.slug === slug)
    line(
      Boolean(r && r.page_published && r.sections > 0 && r.unpublished === 0),
      `פורסם: ${slug}`
    )
  }
}

async function checkCopiedTables(prod, dev) {
  const mediaIds = (await dev.query(REFERENCED_MEDIA_SQL)).rows.map((r) => r.id)
  for (const spec of TABLES) {
    const where =
      spec.table === "media_assets" ? "where t.id = any($1::uuid[])" : ""
    const params = spec.table === "media_assets" ? [mediaIds] : []
    const [devRows, prodRows] = await Promise.all([
      readRows(dev, spec.table, where, params).then((rows) =>
        withoutExcluded(spec, rows)
      ),
      readRows(prod, spec.table, where, params),
    ])
    const cols = compareColumns(spec)
    const hashes = (rows) =>
      new Map(rows.map((r) => [keyOf(spec, r), rowHash(r, cols)]))
    const d = hashes(devRows)
    const p = hashes(prodRows)
    const diff = [...new Set([...d.keys(), ...p.keys()])].filter(
      (k) => d.get(k) !== p.get(k)
    )
    line(
      diff.length === 0,
      `${spec.table} זהה לפיתוח (${devRows.length} שורות)${diff.length ? `; שונות: ${diff.slice(0, 10).join(", ")}${diff.length > 10 ? "…" : ""}` : ""}`
    )
    if (spec.table === "media_assets")
      await checkMediaFiles(prod, prodRows, mediaIds)
    const refused = refusedRows(spec, prodRows)
    if (refused.length > 0)
      line(false, `נתוני בדיקה בפרודקשן: ${refused.join(", ")}`)
  }
}

async function checkMediaFiles(prod, prodMedia, mediaIds) {
  const found = new Set(prodMedia.map((m) => m.id))
  const missingRows = mediaIds.filter((id) => !found.has(id))
  const files = prodMedia.flatMap(mediaFiles)
  const { rows } = await prod.query(
    `select bucket_id || '/' || name as f from storage.objects
     where bucket_id in ('media-drafts', 'media-public')`
  )
  const present = new Set(rows.map((r) => r.f))
  const missingFiles = files.filter(
    (f) => !present.has(`${f.bucket}/${f.name}`)
  )
  line(
    missingRows.length === 0 && missingFiles.length === 0,
    `תמונות: ${mediaIds.length} מוזכרות, כולן בפרודקשן עם הקבצים שלהן${
      missingRows.length || missingFiles.length
        ? `; חסרות שורות: ${missingRows.join(", ") || "-"}; חסרים קבצים: ${missingFiles.map((f) => `${f.id} (${f.bucket})`).join(", ") || "-"}`
        : ""
    }`
  )
}

async function checkNoTestData(prod) {
  const { rows } = await prod.query(
    `select count(*)::int as n from auth.users
     where lower(coalesce(email, '')) like '%video.example.com'
        or lower(coalesce(email, '')) like 'test\\_%'
        or lower(coalesce(email, '')) like '%@example.test'
        or lower(coalesce(email, '')) like '%@example.com'`
  )
  line(rows[0].n === 0, "אין משתמשי Auth של בדיקות או של הסרטונים")
}

async function checkAdmins(prod) {
  const { rows } = await prod.query(
    "select count(*)::int as n from public.admin_roles"
  )
  line(rows[0].n >= 1, `אדמינים: ${rows[0].n}`)
}

const GUARD_DEF =
  "select md5(pg_get_functiondef('private.guard_auth_user_change()'::regprocedure)) as h"

async function checkAuthGuard(prod, dev) {
  const { rows } = await prod.query(
    `select t.tgenabled from pg_trigger t
     where t.tgname = 'guard_identity_change' and t.tgrelid = 'auth.users'::regclass`
  )
  line(
    rows[0]?.tgenabled === "O",
    "ה-trigger guard_identity_change על auth.users פעיל"
  )
  const [p, d] = await Promise.all([
    prod.query(GUARD_DEF),
    dev.query(GUARD_DEF),
  ])
  line(p.rows[0].h === d.rows[0].h, "private.guard_auth_user_change זהה לפיתוח")
}

async function main() {
  const prod = await connect(prodConfig.databaseUrl, { readOnly: true })
  const dev = await connect(devConfig.databaseUrl, {
    readOnly: true,
    label: "פרויקט הפיתוח",
  })
  try {
    const { rows } = await prod.query("show default_transaction_read_only")
    line(
      rows[0].default_transaction_read_only === "on",
      "החיבור לפרודקשן לקריאה בלבד"
    )
    await checkMigrations(prod)
    await checkCron(prod)
    await checkVault(prod)
    await checkPushRoute()
    await checkCronRuns(prod)
    await checkAuthSettings()
    await checkDatabaseSettings(prod)
    await checkPushWorker(prod)
    await checkFailedPushes(prod)
    await checkEmail(prod)
    await checkMarketingTags(prod)
    await checkLegalPages(prod)
    await checkCopiedTables(prod, dev)
    await checkNoTestData(prod)
    await checkAdmins(prod)
    await checkAuthGuard(prod, dev)
  } finally {
    await prod.end().catch(() => {})
    await dev.end().catch(() => {})
  }
  console.log(failed === 0 ? "\nכל הבדיקות עברו." : `\n${failed} בדיקות נכשלו.`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`prod-check נכשל: ${error.message}`)
  process.exit(1)
})
