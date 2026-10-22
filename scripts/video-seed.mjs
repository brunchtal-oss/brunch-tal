// Dev only (story 5.22): builds the fictional world of the explainer videos
// on the DEV Supabase project, dated from the run day (Asia/Jerusalem),
// through the same RPCs and the same join flow the screens use, acting as a
// dedicated filming admin (admin@video.example.com) and as the customers.
//
//   npm run video:seed
//
// The cast is in scripts/video-cast.mjs (checked by video-cast-rules.mjs
// before anything is written); dates, keys and backdating targets in
// video-plan.mjs; the direct writes in video-sql.mjs. To remove the world:
// npm run video:clear. Rule: clear, then seed, before each filming day.
//
// No file: the world is found in the database (the video email domain and
// the rows of the filming admin). Its anchor is the filming admin's Auth
// app_metadata.video_world = { anchor_date, generation, complete }. A second
// run on the anchor day replays the same idempotency keys (stored results,
// no duplicates) and resumes after a crash; on another day it stops.
//
// Direct writes (no supabase-js insert/update/delete/upsert; pg, documented
// in the spec's Design Notes): DW1 the filming admin's admin_roles row (its
// own small transaction, before the first admin RPC); DW2 the history time
// shift, DW3 backdating, DW4 the expired link, DW5 the job calls and the
// marketing reminder (one transaction, at the end).
//
// Passwords: the three customer logins and the filming admin get
// VIDEO_LOGIN_PASSWORD (.env.local, at least 10 characters) through the Auth
// Admin API; every other new Auth user a random one. Sign-ins use one-time
// links. Nothing here prints a token, link, password or key; an error prints
// only its code.

import { randomBytes, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"

import { createClient } from "@supabase/supabase-js"
import pg from "pg"

import {
  ADMIN_BOOKINGS,
  BOARD_NOTES,
  BUSINESS_CANCEL,
  CAPACITY,
  CAST,
  COMPANION_NOTE,
  COMPLETED_REFUNDS,
  CONFLICT,
  CUSTOMER_NOTES,
  FILMING_ADMIN_EMAIL,
  LOGINS,
  PERSONAS,
  SELF_BOOKINGS,
  SELF_CANCELS,
  SESSIONS,
  VIDEO_DOMAIN,
  WAITLIST,
  WEEKDAY_THEMES,
  WORK_SHEET,
  sessionKind,
} from "./video-cast.mjs"
import { checkCast } from "./video-cast-rules.mjs"
import {
  HISTORY_KEYS,
  checkAnchor,
  createStep,
  demoKey,
  eventCreatedOn,
  historyBookingMoment,
  isHistory,
  isUuid,
  joinMoment,
  localMoment,
  paidOnOf,
  planVideoDates,
  weekday,
} from "./video-plan.mjs"
import {
  DEV_ADMIN_EMAIL,
  adminRoleSql,
  directWritesSql,
} from "./video-sql.mjs"
import { devRef, isVideoEmail } from "./dev-guard.mjs"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

function fail(message) {
  console.error(`${message} לא בוצע שינוי נוסף.`)
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!url || !secretKey || !publishableKey) {
  fail(
    "חסרים NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY או SUPABASE_SECRET_KEY ב-.env.local."
  )
}
if (!devRef({ supabaseUrl: url, databaseUrl: process.env.DEV_DATABASE_URL })) {
  fail(
    "הסקריפט רץ רק מול פרויקט הפיתוח: DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL."
  )
}
const loginPassword = process.env.VIDEO_LOGIN_PASSWORD ?? ""
if (loginPassword.length < 10) {
  fail("חסר VIDEO_LOGIN_PASSWORD ב-.env.local (לפחות 10 תווים).")
}

const OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const service = createClient(url, secretKey, OPTIONS)

// SSL without certificate verification, as supabase/tests/support/db.ts
// (dev project, fictitious data only).
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

const db = new pg.Client(connectionConfig(process.env.DEV_DATABASE_URL))
const q = async (sql, params = []) => (await db.query(sql, params)).rows

// An RPC error carries only its code (the P0001 message) and the RPC name.
class RpcError extends Error {
  constructor(name, code) {
    super(`${name}: ${code}`)
    this.code = code
  }
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new RpcError(name, error.message)
  return data
}

const videoEmail = (local) => `${local}@${VIDEO_DOMAIN}`

// Signed-in clients by email (one-time links, never printed), signed out
// locally at the end.
const clients = new Map()

async function signedIn(email) {
  if (clients.has(email)) return clients.get(email)
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw new Error(`generateLink: ${error.code ?? error.status}`)
  const client = createClient(url, publishableKey, OPTIONS)
  const verified = await client.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  })
  if (verified.error) {
    throw new Error(`verifyOtp: ${verified.error.code ?? verified.error.status}`)
  }
  clients.set(email, client)
  return client
}

const warnings = []
// A join or a booking that was skipped: the world is not whole, so the run
// stops before the direct writes (DW2 completes the history sessions, and a
// rerun could not book them any more).
let incomplete = false
function warn(message) {
  warnings.push(message)
  console.log(`אזהרה: ${message}`)
}

const personaOf = (key) => PERSONAS.find((p) => p.key === key)

// ------------------------------------------------------------- anchor

async function videoUsers() {
  return q(
    "select id, lower(email) as email, raw_app_meta_data as meta from auth.users where lower(email) like $1",
    [`%@${VIDEO_DOMAIN}`]
  )
}

// The filming admin and the world's generation. Stops when the world is
// from another day, or when video users exist without an anchor.
async function settleAnchor(today) {
  const users = await videoUsers()
  const adminRow = users.find((u) => u.email === FILMING_ADMIN_EMAIL)
  const others = users.filter((u) => u.email !== FILMING_ADMIN_EMAIL)
  const clearFirst =
    "קודם npm run video:clear, ואז npm run video:seed."
  const decision = checkAnchor(adminRow?.meta?.video_world, today)
  if (decision.action === "stop") {
    fail(
      decision.reason === "other_day"
        ? `העולם במסד נבנה ביום אחר. ${clearFirst}`
        : `סימון העולם אצל אדמין הצילום פגום. ${clearFirst}`
    )
  }
  if (decision.action === "replay") {
    if (!adminRow) fail(`אין אדמין צילום. ${clearFirst}`)
    return {
      adminId: adminRow.id,
      generation: decision.generation,
      complete: decision.complete,
      fresh: false,
    }
  }
  // A new world: nothing of the domain may exist besides an anchor-less
  // filming admin (a crash right after its creation).
  if (others.length > 0) {
    fail(`יש במסד משתמשות @${VIDEO_DOMAIN} בלי סימון עולם. ${clearFirst}`)
  }
  const anchor = {
    anchor_date: today,
    generation: randomUUID(),
    complete: false,
  }
  let adminId = adminRow?.id
  if (!adminId) {
    const { data, error } = await service.auth.admin.createUser({
      email: FILMING_ADMIN_EMAIL,
      password: randomBytes(24).toString("base64url"),
      email_confirm: true,
      app_metadata: { video_world: anchor },
    })
    if (error) throw new Error(`createUser: ${error.code ?? error.status}`)
    adminId = data.user.id
  } else {
    await setAnchor(adminId, anchor)
  }
  return { adminId, generation: anchor.generation, complete: false, fresh: true }
}

async function setAnchor(userId, anchor) {
  const found = await service.auth.admin.getUserById(userId)
  if (found.error) {
    throw new Error(`getUserById: ${found.error.code ?? found.error.status}`)
  }
  const { error } = await service.auth.admin.updateUserById(userId, {
    app_metadata: { ...(found.data.user.app_metadata ?? {}), video_world: anchor },
  })
  if (error) throw new Error(`updateUserById: ${error.code ?? error.status}`)
}

async function inTransaction(statements) {
  await db.query("begin")
  try {
    for (const sql of statements) await db.query(sql)
    await db.query("commit")
  } catch (error) {
    await db.query("rollback")
    throw error
  }
}

// ---------------------------------------------------------------- main

async function main() {
  await db.connect()
  // 1. Guards: the dev admin exists; the cast passes its rules against the
  //    products and settings of the database; the concepts and methods it
  //    needs exist. Nothing is written before this passes.
  const devAdmin = await q("select id from auth.users where lower(email) = $1", [
    DEV_ADMIN_EMAIL,
  ])
  if (devAdmin.length === 0) {
    fail(`אין אדמין פיתוח (${DEV_ADMIN_EMAIL}), ולכן זה כנראה לא פרויקט הפיתוח.`)
  }
  const products = await q(
    "select id, type, units, validity_days, validity_mode, party_size, eligible_event_kind, price_agorot, active from public.products where active order by created_at, id"
  )
  const [settings] = await q("select * from public.business_settings")
  if (!settings) fail("אין שורת business_settings.")
  const plan = planVideoDates(new Date())
  const today = plan.today
  const errors = checkCast({ ...CAST, plan }, products, settings)
  if (errors.length > 0) {
    for (const e of errors) console.error(`כלל ${e.rule}: ${e.message}`)
    fail(`הקאסט לא עומד בכלל ${errors[0].rule}.`)
  }
  const concepts = await q(
    "select id, theme_key from public.concepts where archived_at is null order by sort_order, id"
  )
  const conceptOf = (theme) => concepts.find((c) => c.theme_key === theme) ?? null
  const methods = await q(
    "select id from public.payment_methods where not hidden order by sort_order, id"
  )
  if (methods.length === 0) fail("אין אמצעי תשלום גלוי.")
  const productOf = (type) => products.find((p) => p.type === type)
  const themeOf = (key) =>
    SESSIONS[key].theme ?? WEEKDAY_THEMES[weekday(plan.sessions[key])]
  for (const key of Object.keys(SESSIONS)) {
    if (!conceptOf(themeOf(key))) fail(`אין קונספט פעיל עם theme_key ${themeOf(key)}.`)
  }
  const hours = {
    start: String(settings.default_session_start_time).slice(0, 5),
    end: String(settings.default_session_end_time).slice(0, 5),
  }

  // 2. The filming admin, the anchor and DW1.
  const anchor = await settleAnchor(today)
  console.log(
    anchor.fresh
      ? `עולם חדש ליום ${today}.`
      : `העולם של ${today} כבר קיים${anchor.complete ? "" : " (חלקית)"}: הרצה חוזרת.`
  )
  await inTransaction([adminRoleSql(anchor.adminId)])

  const keyOf = (itemKey) => demoKey(anchor.generation, itemKey)
  const { step, counts } = createStep({
    keyOf,
    exists: async (key) =>
      (
        await q(
          "select exists (select 1 from private.idempotency_results where key = $1 and result is not null) as e",
          [key]
        )
      )[0].e,
    log: (message) => console.log(message),
  })

  const admin = await signedIn(FILMING_ADMIN_EMAIL)
  try {
    // Site content: the seed writes none; it only warns about an empty
    // section, and takes the published gallery photos for the sessions.
    const pages = {}
    for (const slug of ["home", "about", "how-it-works", "gallery"]) {
      pages[slug] = await rpc(admin, "admin_get_content_page", { p_slug: slug })
    }
    const published = (slug, key) =>
      pages[slug].sections.find((s) => s.key === key)?.published_content ?? null
    for (const [slug, key, list] of [
      ["home", "hero", false],
      ["about", "main", false],
      ["how-it-works", "faq", true],
      ["how-it-works", "steps", true],
      ["gallery", "photos", true],
      ["gallery", "testimonials", true],
    ]) {
      const content = published(slug, key)
      const empty = list
        ? !(content?.items?.length > 0)
        : !content || Object.keys(content).length === 0
      if (empty) warn(`בתוכן האתר ${slug}/${key} ריק.`)
    }
    const galleryMedia = (published("gallery", "photos")?.items ?? [])
      .map((item) => item?.image?.media_id)
      .filter(isUuid)

    // 3. Sessions (history ones on their temporary dates, DW2).
    const eventIds = {}
    for (const [key, spec] of Object.entries(SESSIONS)) {
      const date = isHistory(key) ? plan.temp[key].temp : plan.sessions[key]
      const created = await step(`event:${key}`, `מפגש ${key} (${plan.sessions[key]})`, (k) =>
        rpc(admin, "admin_create_event", {
          p_event: {
            concept_id: conceptOf(themeOf(key)).id,
            date,
            start_time: hours.start,
            end_time: hours.end,
            capacity_adults: CAPACITY[sessionKind(key)],
            publish: !spec.draft,
          },
          p_idempotency_key: k,
        })
      )
      eventIds[key] = created.event_id
    }

    // 4. Purchases and joins.
    const tokens = new Map() // raw join tokens, in memory only
    const purchases = new Map() // itemKey -> { paymentId, bookingId, paidOn }
    const customers = new Map() // persona key -> customer id
    const methodOf = (itemKey) =>
      methods[parseInt(demoKey("method", itemKey).slice(0, 8), 16) % methods.length]

    async function approve(itemKey, label, payerLabel, purchase, forCustomer) {
      const product = productOf(purchase.product)
      const eventId = purchase.event ? eventIds[purchase.event] : null
      const paidOn = paidOnOf(purchase.paid, {
        today,
        eventDate: purchase.event ? plan.sessions[purchase.event] : null,
        validityDays: product.validity_days,
      })
      const result = await step(itemKey, label, async (key) => {
        const approved = await rpc(admin, "admin_approve_payment", {
          p_customer_id: forCustomer,
          p_payer_label: forCustomer ? null : payerLabel,
          p_product_id: product.id,
          p_event_id: eventId,
          p_amount_agorot: product.price_agorot,
          p_amount_override_reason: null,
          p_paid_on: paidOn,
          p_payment_method_id: methodOf(itemKey).id,
          p_reference: null,
          p_note: null,
          p_confirmed: false,
          p_duplicate_confirmed: true,
          p_idempotency_key: key,
        })
        const { token, ...stored } = approved
        if (token) tokens.set(itemKey, token)
        return stored
      })
      let bookingId = isUuid(result.booking_id) ? result.booking_id : null
      if (!bookingId && eventId) {
        const rows = await q(
          "select id from public.bookings where payment_id = $1 order by created_at limit 1",
          [result.payment_id]
        )
        bookingId = rows[0]?.id ?? null
      }
      const entry = { paymentId: result.payment_id, bookingId, paidOn }
      purchases.set(itemKey, entry)
      return entry
    }

    // A live link for this payment: the one just issued, or a new one
    // (admin_issue_link, a fresh key) after a crash lost it.
    async function liveToken(itemKey, paymentId) {
      const token = tokens.get(itemKey)
      if (token) return { token }
      try {
        const issued = await rpc(admin, "admin_issue_link", {
          p_purpose: "join",
          p_target_id: paymentId,
          p_idempotency_key: randomUUID(),
        })
        if (isUuid(issued.revoked_pending_user_id)) {
          await deleteOrphanUser(issued.revoked_pending_user_id)
        }
        return { token: issued.token, tokenId: issued.token_id }
      } catch (error) {
        if (error.code === "LINK_IN_PROGRESS") {
          warn("קישור הצטרפות באמצע תהליך. אפשר להריץ שוב בעוד 15 דקות, כשהוא ייחשב תקוע.")
          return undefined
        }
        throw error
      }
    }

    async function deleteOrphanUser(userId) {
      if ((await q("select 1 from public.profiles where id = $1", [userId])).length) return
      const found = await service.auth.admin.getUserById(userId)
      const user = found.data?.user
      if (!user) return
      if (!isVideoEmail(user.email)) {
        warn("משתמשת Auth של קישור שבוטל אינה במייל של הסרטונים, ולכן לא נמחקה.")
        return
      }
      const deleted = await service.auth.admin.deleteUser(userId)
      if (deleted.error && deleted.error.status !== 404) {
        throw new Error(`deleteUser: ${deleted.error.code ?? deleted.error.status}`)
      }
    }

    async function ensureAuthUser(userId, email) {
      const found = await service.auth.admin.getUserById(userId)
      if (found.data?.user) return
      const { error } = await service.auth.admin.createUser({
        id: userId,
        email,
        password: randomBytes(24).toString("base64url"),
        email_confirm: true,
      })
      if (error) throw new Error(`createUser: ${error.code ?? error.status}`)
    }

    const profileOf = (persona) => ({
      email: videoEmail(persona.email),
      phone: persona.phone,
      full_name: persona.fullName,
      dietary_notes: persona.dietaryNotes,
      privacy_consent: true,
      photo_consent: persona.photoConsent,
      personal_photo_consent: persona.personalPhotoConsent,
      babies: persona.babies.map((baby) => {
        const d = new Date(`${today}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() - baby.ageDays)
        return { name: baby.name, birth_date: d.toISOString().slice(0, 10) }
      }),
    })

    async function join(persona, itemKey, paymentId) {
      const [paid] = await q("select customer_id from public.payments where id = $1", [
        paymentId,
      ])
      if (paid?.customer_id) {
        customers.set(persona.key, paid.customer_id)
        counts.existing++
        console.log(`כבר קיים: הצטרפות ${persona.fullName}`)
        return
      }
      const joined = await step(`join:${persona.key}`, `הצטרפות ${persona.fullName}`, async (key) => {
        const live = await liveToken(itemKey, paymentId)
        if (!live) return undefined
        // A link issued after a crash gets its own keys.
        const joinKey = live.tokenId ? keyOf(`join:${persona.key}:${live.tokenId}`) : key
        const profile = profileOf(persona)
        const begin = await rpc(service, "join_begin", {
          p_token: live.token,
          p_email: profile.email,
          p_phone: profile.phone,
          p_idempotency_key: joinKey,
        })
        if (begin.outcome === "joined") return { customer_id: begin.customer_id }
        if (begin.outcome !== "claiming") throw new Error(`join_begin: ${begin.outcome}`)
        await ensureAuthUser(begin.pending_user_id, profile.email)
        const done = await rpc(service, "join_complete", {
          p_token: live.token,
          p_profile: profile,
          p_idempotency_key: joinKey,
        })
        if (done.outcome !== "joined") throw new Error(`join_complete: ${done.outcome}`)
        return { customer_id: done.customer_id }
      })
      if (joined) customers.set(persona.key, joined.customer_id)
      else incomplete = true
    }

    for (const persona of PERSONAS) {
      for (const [index, purchase] of persona.purchases.entries()) {
        const itemKey = `payment:${persona.key}:${index}`
        const label = `רכישה ${index + 1} של ${persona.fullName}`
        const isNew = index === 0
        if (!isNew && !customers.has(persona.key)) {
          incomplete = true
          warn(`${label} דולגה: ${persona.fullName} עוד לא הצטרפה.`)
          continue
        }
        const entry = await approve(
          itemKey,
          label,
          persona.fullName,
          purchase,
          isNew ? null : customers.get(persona.key)
        )
        if (isNew && persona.joins !== false) await join(persona, itemKey, entry.paymentId)
      }
    }

    // 5. Card bookings (admin_book_customer).
    const cardBookings = new Map() // "who:event" -> booking id
    for (const [who, event] of ADMIN_BOOKINGS) {
      const persona = personaOf(who)
      if (!customers.has(who)) {
        incomplete = true
        warn(`ההרשמה של ${persona.fullName} ל-${event} דולגה: היא עוד לא הצטרפה.`)
        continue
      }
      const booked = await step(`book:${who}:${event}`, `הרשמה של ${persona.fullName} ל-${event}`, (key) =>
        rpc(admin, "admin_book_customer", {
          p_customer_id: customers.get(who),
          p_event_id: eventIds[event],
          p_idempotency_key: key,
        })
      )
      cardBookings.set(`${who}:${event}`, booked.booking_id)
    }

    // 6. Customer actions, signed in as each customer.
    const asCustomer = (who) => signedIn(videoEmail(personaOf(who).email))
    const pinnedBooking = (who, event) => {
      const persona = personaOf(who)
      const index = persona.purchases.findIndex((p) => p.event === event)
      return purchases.get(`payment:${who}:${index}`)?.bookingId ?? null
    }

    for (const { who, events } of SELF_BOOKINGS) {
      if (!customers.has(who)) continue
      const booked = await step(`self-book:${who}`, `${personaOf(who).fullName} נרשמת בעצמה ל-${events.join(", ")}`, async (key) =>
        rpc(await asCustomer(who), "book_sessions", {
          p_items: events.map((e) => eventIds[e]),
          p_idempotency_key: key,
        })
      )
      for (const item of booked?.results ?? []) {
        if (!item.ok) warn(`הרשמה עצמית של ${personaOf(who).fullName} נדחתה: ${item.code}`)
      }
    }

    const cancelResults = new Map()
    for (const { who, event, choice } of SELF_CANCELS) {
      const bookingId = pinnedBooking(who, event)
      if (!customers.has(who) || !bookingId) {
        warn(`הביטול של ${personaOf(who).fullName} דולג.`)
        continue
      }
      const cancelled = await step(`cancel:${who}:${event}`, `${personaOf(who).fullName} מבטלת את ${event} (${choice === "credit" ? "זיכוי" : "החזר"})`, async (key) =>
        rpc(await asCustomer(who), "cancel_booking", {
          p_booking_id: bookingId,
          p_choice: choice,
          p_idempotency_key: key,
        })
      )
      cancelResults.set(who, cancelled)
    }

    for (const { who, event } of WAITLIST) {
      if (!customers.has(who)) continue
      await step(`waitlist:${who}:${event}`, `${personaOf(who).fullName} ממתינה ל-${event}`, async (key) =>
        rpc(await asCustomer(who), "join_waitlist", {
          p_event_id: eventIds[event],
          p_idempotency_key: key,
        })
      )
    }

    {
      const { who, event, text } = COMPANION_NOTE
      const bookingId = pinnedBooking(who, event)
      if (customers.has(who) && bookingId) {
        await step(`companion:${who}:${event}`, `${personaOf(who).fullName} מוסיפה הערה על המלווה ב-${event}`, async (key) =>
          rpc(await asCustomer(who), "set_booking_guest_details", {
            p_booking_id: bookingId,
            p_guest_details: text,
            p_idempotency_key: key,
          })
        )
      } else {
        warn(`ההערה על המלווה של ${personaOf(who).fullName} דולגה.`)
      }
    }

    // 7. Admin actions.
    // The business cancels U3 (message: the rendered template).
    {
      const eventId = eventIds[BUSINESS_CANCEL]
      const [row] = await q("select status from public.events where id = $1", [eventId])
      if (row?.status === "cancelled") {
        counts.existing++
        console.log(`כבר קיים: ביטול ${BUSINESS_CANCEL}`)
      } else {
        const preview = await rpc(admin, "preview_admin_cancel_event", { p_event_id: eventId })
        if (!preview.ok) {
          warn(`ביטול ${BUSINESS_CANCEL} דולג: ${preview.code}`)
        } else {
          await step(`cancel-event:${BUSINESS_CANCEL}`, `ביטול ${BUSINESS_CANCEL} מצד העסק`, (key) =>
            rpc(admin, "admin_cancel_event", {
              p_event_id: eventId,
              p_confirmed: true,
              p_message: preview.body,
              p_parked_acknowledged: false,
              p_idempotency_key: key,
            })
          )
        }
      }
    }

    for (const who of COMPLETED_REFUNDS) {
      const requestId = cancelResults.get(who)?.refund_request_id
      if (!isUuid(requestId)) {
        warn(`ההחזר של ${personaOf(who).fullName} דולג.`)
        continue
      }
      const [request] = await q("select amount_agorot from public.refund_requests where id = $1", [
        requestId,
      ])
      if (!request) {
        warn(`ההחזר של ${personaOf(who).fullName} דולג: בקשת ההחזר לא נמצאה.`)
        continue
      }
      await step(`refund:${who}`, `ההחזר של ${personaOf(who).fullName} הושלם`, (key) =>
        rpc(admin, "admin_complete_refund", {
          p_refund_request_id: requestId,
          p_refunded_on: today,
          p_amount_agorot: request.amount_agorot,
          p_reference: null,
          p_confirmed: true,
          p_idempotency_key: key,
        })
      )
    }

    // The conflict: a card "for a new customer", her email and another
    // customer's phone, three times.
    {
      const moran = personaOf(CONFLICT.customer)
      const other = personaOf(CONFLICT.phoneOf)
      const itemKey = `payment:${moran.key}:conflict`
      const entry = await approve(
        itemKey,
        `רכישה חדשה של ${moran.fullName} (קישור בהתנגשות)`,
        moran.fullName,
        { product: CONFLICT.product, paid: CONFLICT.paid },
        null
      )
      const [state] = await q(
        "select state from public.activation_tokens where payment_id = $1 and state in ('conflict', 'consumed') limit 1",
        [entry.paymentId]
      )
      if (state) {
        counts.existing++
        console.log(`כבר קיים: הקישור של ${moran.fullName} בהתנגשות`)
      } else if (customers.has(moran.key) && customers.has(other.key)) {
        await step(`conflict:${moran.key}`, `הקישור של ${moran.fullName} ב"לטיפול"`, async () => {
          const live = await liveToken(itemKey, entry.paymentId)
          if (!live) return undefined
          for (let attempt = 1; attempt <= CONFLICT.attempts; attempt++) {
            const begin = await rpc(service, "join_begin", {
              p_token: live.token,
              p_email: videoEmail(moran.email),
              p_phone: other.phone,
              p_idempotency_key: keyOf(
                `conflict:${moran.key}:${live.tokenId ?? "first"}:attempt:${attempt}`
              ),
            })
            if (begin.outcome === "conflict") return { outcome: begin.outcome }
          }
          throw new Error("join_begin: no conflict")
        })
      } else {
        warn(`הקישור של ${moran.fullName} דולג: חסרה לקוחה שהצטרפה.`)
      }
    }

    // Internal notes on customer cards.
    for (const [index, note] of CUSTOMER_NOTES.entries()) {
      if (!customers.has(note.who)) continue
      await step(`customer-note:${index}`, `הערה על ${personaOf(note.who).fullName}`, (key) =>
        rpc(admin, "admin_add_customer_note", {
          p_customer_id: customers.get(note.who),
          p_body: note.body,
          p_idempotency_key: key,
        })
      )
    }

    // The work sheet of U1.
    {
      const sheetEvent = eventIds[WORK_SHEET.event]
      await step("prep-day", `יום הכנה נוסף (${WORK_SHEET.extraPrepDay})`, (key) =>
        rpc(admin, "admin_add_prep_day", {
          p_event_id: sheetEvent,
          p_day_offset: WORK_SHEET.extraPrepDay,
          p_idempotency_key: key,
        })
      )
      for (const [d, dish] of WORK_SHEET.dishes.entries()) {
        const added = await step(`dish:${d}`, `מנה: ${dish.name}`, (key) =>
          rpc(admin, "admin_add_work_dish", {
            p_event_id: sheetEvent,
            p_name: dish.name,
            p_idempotency_key: key,
          })
        )
        for (const [t, task] of dish.tasks.entries()) {
          const row = await step(`task:${d}:${t}`, `משימה: ${task.body}`, (key) =>
            rpc(admin, "admin_add_work_task", {
              p_dish_id: added.dish_id,
              p_day_offset: task.day,
              p_body: task.body,
              p_idempotency_key: key,
            })
          )
          if (task.done) {
            await rpc(admin, "admin_set_work_task_done", { p_task_id: row.task_id, p_done: true })
          }
        }
      }
      const shopping = await step("shopping", "רשימת קניות", (key) =>
        rpc(admin, "admin_add_shopping_items", {
          p_event_id: sheetEvent,
          p_bodies: WORK_SHEET.shopping.map((item) => item.body),
          p_idempotency_key: key,
        })
      )
      for (const [i, item] of WORK_SHEET.shopping.entries()) {
        if (!item.bought) continue
        await rpc(admin, "admin_set_shopping_item_bought", {
          p_item_id: shopping.item_ids[i],
          p_bought: true,
        })
      }
    }

    // The board (D10): its notes are found by the stored results.
    for (const [index, note] of BOARD_NOTES.entries()) {
      const added = await step(`board:${index}`, `פתק: ${note.body}`, (key) =>
        rpc(admin, "admin_add_note", { p_body: note.body, p_idempotency_key: key })
      )
      if (note.pinned) {
        await rpc(admin, "admin_set_note_pinned", { p_note_id: added.note_id, p_pinned: true })
      }
      if (note.done) {
        await rpc(admin, "admin_set_note_done", { p_note_id: added.note_id, p_done: true })
      }
      if (note.archived) {
        await rpc(admin, "admin_set_note_archived", { p_note_id: added.note_id, p_archived: true })
      }
    }

    // A published gallery photo for each session. Storage files are never
    // removed here (a hidden photo keeps its file).
    if (galleryMedia.length === 0) {
      warn("אין תמונות בגלריה, ולכן המפגשים בלי תמונה.")
    } else {
      for (const [index, key] of Object.keys(SESSIONS).entries()) {
        const result = await rpc(admin, "admin_set_event_image", {
          p_event_id: eventIds[key],
          p_media_id: galleryMedia[index % galleryMedia.length],
        })
        if (result?.hidden_paths?.length) {
          warn(`${result.hidden_paths.length} תמונות שאינן בשימוש הוסתרו; הקבצים נשארו.`)
        }
      }
    }

    // 8. Passwords of the logins (never printed or written).
    for (const userId of [
      anchor.adminId,
      ...LOGINS.map((who) => customers.get(who)).filter(Boolean),
    ]) {
      const { error } = await service.auth.admin.updateUserById(userId, {
        password: loginPassword,
      })
      if (error) throw new Error(`updateUserById: ${error.code ?? error.status}`)
    }

    if (incomplete) {
      console.error("הריצה לא הושלמה, הריצי שוב מאוחר יותר.")
      process.exitCode = 1
      return
    }

    // 9. The direct writes (DW2–DW5), one transaction.
    const momentOf = new Map() // itemKey -> purchase moment
    const paymentRows = []
    const joinRows = []
    for (const persona of PERSONAS) {
      for (const [index] of persona.purchases.entries()) {
        const itemKey = `payment:${persona.key}:${index}`
        const entry = purchases.get(itemKey)
        if (!entry || entry.paidOn >= today) continue
        const at = localMoment(entry.paidOn, itemKey)
        momentOf.set(itemKey, at)
        const joins = index === 0 && persona.joins !== false && customers.has(persona.key)
        const joinAt = joins ? joinMoment(at, `join:${persona.key}`) : at
        paymentRows.push({ paymentId: entry.paymentId, at, boundAt: joinAt, notifyAt: joinAt })
        if (joins) {
          joinRows.push({
            customerId: customers.get(persona.key),
            paymentId: entry.paymentId,
            at: joinAt,
          })
        }
      }
    }
    {
      const entry = purchases.get(`payment:${CONFLICT.customer}:conflict`)
      if (entry && entry.paidOn < today) {
        const at = localMoment(entry.paidOn, "conflict")
        paymentRows.push({ paymentId: entry.paymentId, at, boundAt: at, notifyAt: at })
      }
    }
    const historyBookings = []
    for (const persona of PERSONAS) {
      persona.purchases.forEach((purchase, index) => {
        const itemKey = `payment:${persona.key}:${index}`
        const entry = purchases.get(itemKey)
        if (purchase.event && isHistory(purchase.event) && entry?.bookingId && momentOf.has(itemKey)) {
          historyBookings.push({ bookingId: entry.bookingId, at: momentOf.get(itemKey) })
        }
      })
    }
    for (const [who, event] of ADMIN_BOOKINGS) {
      if (!isHistory(event)) continue
      const bookingId = cardBookings.get(`${who}:${event}`)
      const cardIndex = personaOf(who).purchases.findIndex((p) => p.product === "card")
      const cardAt = momentOf.get(`payment:${who}:${cardIndex}`)
      if (!bookingId || !cardAt) continue
      historyBookings.push({
        bookingId,
        at: historyBookingMoment(cardAt, plan.sessions[event], `${who}:${event}`),
      })
    }
    const eventRows = []
    for (const key of Object.keys(SESSIONS)) {
      const paidOns = PERSONAS.flatMap((persona) =>
        persona.purchases
          .map((purchase, index) => ({ purchase, entry: purchases.get(`payment:${persona.key}:${index}`) }))
          .filter(({ purchase, entry }) => purchase.event === key && entry)
          .map(({ entry }) => entry.paidOn)
      )
      const createdOn = eventCreatedOn(plan.sessions[key], paidOns, today)
      if (createdOn) eventRows.push({ eventId: eventIds[key], createdAt: `${createdOn} 10:00` })
    }
    const expiredLinks = PERSONAS.filter((p) => p.expiredLink)
      .map((p) => purchases.get(`payment:${p.key}:0`)?.paymentId)
      .filter(isUuid)
    const schedule = Array.isArray(settings.marketing_reminder_schedule)
      ? settings.marketing_reminder_schedule
      : []
    const [{ active: activeTexts }] = await q(
      "select count(*)::integer as active from public.marketing_reminder_texts where active"
    )
    if (activeTexts === 0) {
      warn("אין נוסח פעיל לתזכורת השיווקית, ולכן אין תזכורת בפס ובפעמון של האדמין.")
    }
    const slot = schedule.find((s) => Number(s?.weekday) === weekday(today))
    const slotTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(slot?.time ?? "") ? slot.time : "09:00"

    await inTransaction(
      directWritesSql({
        filmingAdminId: anchor.adminId,
        history: HISTORY_KEYS.map((key) => ({
          eventId: eventIds[key],
          realDate: plan.sessions[key],
          tempDate: plan.temp[key].temp,
        })),
        historyBookings,
        payments: paymentRows,
        joins: joinRows,
        events: eventRows,
        expiredLinks,
        marketingSlot: `${today} ${slotTime}`,
      })
    )
    console.log("נכתבו הזזת ההיסטוריה, התאריכים לאחור, הקישור שפג והמשימות.")

    // 10. The world is complete.
    await setAnchor(anchor.adminId, {
      anchor_date: today,
      generation: anchor.generation,
      complete: true,
    })

    // Summary: emails only, never a password.
    console.log("")
    console.log(`סיכום: ${counts.created} נוצרו עכשיו, ${counts.existing} כבר היו.`)
    console.log("כניסות לצילום (הסיסמה: VIDEO_LOGIN_PASSWORD מ-.env.local):")
    console.log(`  טל (אדמין הצילום): ${FILMING_ADMIN_EMAIL}`)
    for (const who of LOGINS) {
      console.log(`  ${personaOf(who).fullName}: ${videoEmail(personaOf(who).email)}`)
    }
    console.log("תאריכי המפגשים:")
    for (const key of Object.keys(SESSIONS)) {
      console.log(`  ${key}: ${plan.sessions[key]}`)
    }
    console.log("")
    console.log("לפני כל יום צילום: npm run video:clear ואז npm run video:seed.")
    if (warnings.length > 0) {
      console.log("")
      console.log(`${warnings.length} אזהרות:`)
      for (const message of warnings) console.log(`  ${message}`)
    }
  } finally {
    // Local only: the default (global) would end every session of these
    // accounts on all devices.
    for (const client of clients.values()) {
      await client.auth.signOut({ scope: "local" })
    }
  }
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => db.end().catch(() => {}))
