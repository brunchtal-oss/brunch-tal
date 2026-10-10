// Dev only (story 5.18): builds a fictitious business on the DEV Supabase
// project for the demo, through the same RPCs and the same join flow the
// screens use. Nothing is written to a table directly.
//
//   npm run demo:seed
//
// The cast, the notes and the work sheet are in scripts/demo-cast.mjs; the
// dates and the idempotency keys in scripts/demo-plan.mjs. The script acts
// as the dev admin (dev-admin@example.com) and as the customers themselves,
// signing in with one-time links it never prints. Every new Auth user gets a
// random password that is never printed or kept.
//
// .demo-data.local.json (git-ignored) keeps the generation, the anchor (the
// moment of the first run) and the ids of everything created, written after
// each item. A second run reads it and adds nothing: every item already in
// it is reported as existing; an item that is not (a crash in the middle)
// is called again with the same idempotency key and gets the stored result.
//
// It runs only against the DEV project: DEV_DATABASE_URL must hold the
// project ref of NEXT_PUBLIC_SUPABASE_URL; otherwise it stops before
// touching anything. The output never holds a token, link, password or key;
// an error prints only its code. To remove the demo: npm run demo:clear.

import { randomBytes, randomUUID } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

import { createClient } from "@supabase/supabase-js"

import {
  ADMIN_BOOKINGS,
  CONFLICT,
  CUSTOMERS,
  DEMO_DOMAIN,
  LOGIN_CUSTOMER,
  NOTES,
  SELF_BOOKINGS,
  SELF_CANCEL,
  SESSIONS,
  WORK_SHEET,
} from "./demo-cast.mjs"
import {
  addDays,
  createStep,
  demoKey,
  isUuid,
  planDates,
} from "./demo-plan.mjs"
import { devRef } from "./dev-guard.mjs"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!url || !secretKey || !publishableKey) {
  console.error(
    "חסרים NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY או SUPABASE_SECRET_KEY ב-.env.local"
  )
  process.exit(1)
}

if (
  !devRef({ supabaseUrl: url, databaseUrl: process.env.DEV_DATABASE_URL })
) {
  console.error(
    "הסקריפט רץ רק מול פרויקט הפיתוח: DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL. לא בוצע שום שינוי."
  )
  process.exit(1)
}

const STATE_FILE = ".demo-data.local.json"
const ADMIN_EMAIL = "dev-admin@example.com"
const OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

const service = createClient(url, secretKey, OPTIONS)

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

function fail(message) {
  console.error(message)
  process.exit(1)
}

const demoEmail = (local) => `${local}@${DEMO_DOMAIN}`

async function listAllUsers() {
  const users = []
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) throw new Error(`listUsers: ${error.code ?? error.status}`)
    users.push(...data.users)
    if (data.users.length < 1000) return users
  }
}

// A client signed in as this email (a one-time link, never printed).
async function signedIn(email) {
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
    throw new Error(
      `verifyOtp: ${verified.error.code ?? verified.error.status}`
    )
  }
  return client
}

// ---------------------------------------------------------------- state

let state = null

function saveState() {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
}

function readState() {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"))
  } catch {
    fail(`${STATE_FILE} פגום. לא בוצע שום שינוי.`)
  }
  if (
    !parsed ||
    !isUuid(parsed.generation) ||
    typeof parsed.anchor !== "string" ||
    Number.isNaN(Date.parse(parsed.anchor)) ||
    typeof parsed.items !== "object" ||
    parsed.items === null
  ) {
    fail(`${STATE_FILE} פגום. לא בוצע שום שינוי.`)
  }
  return parsed
}

const PLAN_REFUSALS = {
  late: "אחרי 23:30 שעון ישראל אי אפשר להתחיל: מפגש ההדגמה של היום (E0) חייב להסתיים היום. כדאי להריץ מחר בבוקר.",
  early:
    "לפני 06:10 שעון ישראל אי אפשר להתחיל: מפגש ההדגמה של היום (E0) מתחיל ב-06:00 לכל המוקדם, לפני ההרצה.",
  saturday: "בשבת אין מפגשים, ומפגש ההדגמה של היום (E0) נוצר היום. כדאי להריץ ביום אחר.",
}

function newState() {
  const anchor = new Date().toISOString()
  const plan = planDates(anchor)
  if (!plan.ok) fail(`${PLAN_REFUSALS[plan.reason]} לא בוצע שום שינוי.`)
  return { generation: randomUUID(), anchor, items: {} }
}

const warnings = []

function warn(message) {
  warnings.push(message)
  console.log(`אזהרה: ${message}`)
}

// One demo item (createStep in demo-plan.mjs), bound to the state once main
// has settled it (the state is not replaced after that).
let stepper = null

function bindStep() {
  stepper = createStep({
    state,
    save: saveState,
    keyOf: (itemKey) => demoKey(state.generation, itemKey),
    log: (message) => console.log(message),
  })
}

const step = (itemKey, label, fn) => stepper.step(itemKey, label, fn)

const eventId = (key) => state.items[`event:${key}`]?.event_id ?? null
const customerId = (key) => state.items[`join:${key}`]?.customer_id ?? null
const castOf = (key) => CUSTOMERS.find((c) => c.key === key)

// ------------------------------------------------------------- the join

// The raw token of a link exists only in the response that issued it, kept
// here in memory for the join that follows and never written or printed.
const tokens = new Map()

// A live link for this payment: the one just issued, or a new one
// (admin_issue_link, a fresh key) after a crash lost it. Returns
// { token, tokenId? } | { joined: customer_id } | undefined (a join in
// progress). tokenId is set only for a link issued here, after a crash.
async function liveToken(admin, paymentItem, payment) {
  const token = tokens.get(paymentItem)
  if (token) return { token }
  try {
    const issued = await rpc(admin, "admin_issue_link", {
      p_purpose: "join",
      p_target_id: payment.payment_id,
      p_idempotency_key: randomUUID(),
    })
    // As the links screen does: the Auth user of a stuck join it revoked
    // goes, unless it already has a profile.
    if (isUuid(issued.revoked_pending_user_id)) {
      await deleteOrphanUser(issued.revoked_pending_user_id)
    }
    return { token: issued.token, tokenId: issued.token_id }
  } catch (error) {
    if (error.code === "LINK_USED") {
      const { data, error: readError } = await admin
        .from("payments")
        .select("customer_id")
        .eq("id", payment.payment_id)
        .single()
      if (readError || !data?.customer_id) throw error
      return { joined: data.customer_id }
    }
    if (error.code === "LINK_IN_PROGRESS") {
      warn(
        "קישור הצטרפות באמצע תהליך. אפשר להריץ שוב בעוד 15 דקות, כשהוא ייחשב תקוע."
      )
      return undefined
    }
    throw error
  }
}

async function deleteOrphanUser(userId) {
  const { data, error } = await service
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle()
  if (error) throw new Error(`profiles read: ${error.code}`)
  if (data) return
  const found = await service.auth.admin.getUserById(userId)
  if (found.error && found.error.status !== 404) {
    throw new Error(`getUserById: ${found.error.code ?? found.error.status}`)
  }
  const user = found.data?.user
  if (!user) return
  if (!user.email?.toLowerCase().endsWith(`@${DEMO_DOMAIN}`)) {
    warn("משתמשת Auth של קישור שבוטל אינה במייל הדגמה, ולכן לא נמחקה.")
    return
  }
  const deleted = await service.auth.admin.deleteUser(userId)
  if (deleted.error && deleted.error.status !== 404) {
    throw new Error(`deleteUser: ${deleted.error.code ?? deleted.error.status}`)
  }
}

// Step 2 of the join (as lib/server/privileged/join.ts): the Auth user
// pending_user_id exists with this email.
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

function profileOf(customer, today) {
  return {
    email: demoEmail(customer.email),
    phone: customer.phone,
    full_name: customer.fullName,
    dietary_notes: customer.dietaryNotes,
    privacy_consent: true,
    photo_consent: customer.photoConsent,
    personal_photo_consent: customer.personalPhotoConsent,
    babies: customer.babies.map((baby) => ({
      name: baby.name,
      birth_date: addDays(today, -baby.ageDays),
    })),
  }
}

async function join(admin, customer, paymentItem, today) {
  return step(`join:${customer.key}`, `הצטרפות ${customer.fullName}`, async (key) => {
    const payment = state.items[paymentItem]
    const live = await liveToken(admin, paymentItem, payment)
    if (!live) return undefined
    if (live.joined) return { customer_id: live.joined }

    // A link issued after a crash gets its own keys: the stored results of
    // the item key belong to the old link.
    const joinKey = live.tokenId
      ? demoKey(state.generation, `join:${customer.key}:${live.tokenId}`)
      : key
    const profile = profileOf(customer, today)
    const begin = await rpc(service, "join_begin", {
      p_token: live.token,
      p_email: profile.email,
      p_phone: profile.phone,
      p_idempotency_key: joinKey,
    })
    // The same key already completed the join (a lost response).
    if (begin.outcome === "joined") return { customer_id: begin.customer_id }
    if (begin.outcome !== "claiming") {
      throw new Error(`join_begin: ${begin.outcome}`)
    }
    await ensureAuthUser(begin.pending_user_id, profile.email)
    const done = await rpc(service, "join_complete", {
      p_token: live.token,
      p_profile: profile,
      p_idempotency_key: joinKey,
    })
    if (done.outcome !== "joined") {
      throw new Error(`join_complete: ${done.outcome}`)
    }
    return { customer_id: done.customer_id }
  })
}

// ---------------------------------------------------------------- main

async function main() {
  const users = await listAllUsers()
  const adminUser = users.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL)
  const howToAdmin = `קודם: node scripts/dev-reset-link.mjs --admin`
  if (!adminUser) fail(`אין אדמין פיתוח (${ADMIN_EMAIL}). ${howToAdmin}`)
  const { data: role } = await service
    .from("admin_roles")
    .select("user_id")
    .eq("user_id", adminUser.id)
    .maybeSingle()
  if (!role) fail(`${ADMIN_EMAIL} אינה אדמין. ${howToAdmin}`)

  const demoUsers = users.filter((u) =>
    u.email?.toLowerCase().endsWith(`@${DEMO_DOMAIN}`)
  )

  const admin = await signedIn(ADMIN_EMAIL)
  let customerClient = null
  try {
    if (!existsSync(STATE_FILE)) {
      if (demoUsers.length > 0) {
        fail(
          `במסד יש כבר לקוחות הדגמה (@${DEMO_DOMAIN}), אבל הקובץ ${STATE_FILE} חסר, ולכן אי אפשר לדעת מה כבר נוצר. עדיף להחזיר את הקובץ. בלי הקובץ, npm run demo:clear מוחק רק את הלקוחות שהצטרפו ואת מה ששייך להן: מפגשי ההדגמה ורכישות שעוד לא שויכו (ממתינה להצטרפות, קישור בהתנגשות) נשארים, ואותם צריך למחוק ידנית לפני הרצה חוזרת. לא בוצע שום שינוי.`
        )
      }
      state = newState()
      saveState()
      console.log("הרצה ראשונה: נוצר קובץ מזהים חדש.")
    } else {
      state = readState()
      const fileEvents = Object.entries(state.items)
        .filter(([key]) => key.startsWith("event:"))
        .map(([, value]) => value?.event_id)
        .filter(isUuid)
      let eventsLeft = 0
      if (fileEvents.length > 0) {
        const { data, error } = await admin
          .from("events")
          .select("id")
          .in("id", fileEvents)
        if (error) throw new Error(`events read: ${error.code}`)
        eventsLeft = data.length
      }
      if (demoUsers.length === 0 && eventsLeft === 0) {
        state = newState()
        saveState()
        console.log("ההדגמה הקודמת נמחקה מהמסד: מתחילה מחדש, עם תאריכים חדשים.")
      }
    }

    bindStep()
    const plan = planDates(state.anchor)
    if (!plan.ok) fail(`${PLAN_REFUSALS[plan.reason]} לא בוצע שום שינוי.`)
    const today = plan.today

    // Lookups: products by type, concepts by theme_key, the visible
    // payment methods, the session hours and the gallery photos.
    const { data: products, error: productsError } = await admin
      .from("products")
      .select("id, type, price_agorot, validity_days, active")
    if (productsError) throw new Error(`products read: ${productsError.code}`)
    const productOf = (type) => {
      const product = products.find((p) => p.type === type && p.active)
      if (!product) fail(`אין מוצר פעיל מסוג ${type}.`)
      return product
    }
    const { data: concepts, error: conceptsError } = await admin
      .from("concepts")
      .select("id, theme_key, archived_at")
    if (conceptsError) throw new Error(`concepts read: ${conceptsError.code}`)
    const { data: methods, error: methodsError } = await admin
      .from("payment_methods")
      .select("id, hidden, sort_order")
      .eq("hidden", false)
      .order("sort_order")
    if (methodsError) throw new Error(`payment methods read: ${methodsError.code}`)
    if (methods.length === 0) fail("אין אמצעי תשלום גלוי.")
    const { data: settings, error: settingsError } = await admin
      .from("business_settings")
      .select("default_session_start_time, default_session_end_time")
      .single()
    if (settingsError) throw new Error(`settings read: ${settingsError.code}`)
    const hours = {
      start: settings.default_session_start_time.slice(0, 5),
      end: settings.default_session_end_time.slice(0, 5),
    }

    // Site content: the script writes none; it only warns about an empty
    // section.
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

    // 1. Sessions.
    const sessionDates = { E0: plan.e0.date, ...plan.sessions }
    for (const [key, { theme, capacity }] of Object.entries(SESSIONS)) {
      const concept = concepts.find(
        (c) => c.theme_key === theme && !c.archived_at
      )
      if (!concept) fail(`אין קונספט פעיל עם theme_key ${theme}.`)
      const times =
        key === "E0"
          ? { start_time: plan.e0.start_time, end_time: plan.e0.end_time }
          : { start_time: hours.start, end_time: hours.end }
      await step(`event:${key}`, `מפגש ${key} (${sessionDates[key]})`, (k) =>
        rpc(admin, "admin_create_event", {
          p_event: {
            concept_id: concept.id,
            date: sessionDates[key],
            ...times,
            capacity_adults: capacity,
            publish: true,
          },
          p_idempotency_key: k,
        })
      )
    }

    // 2. Purchases and joins.
    // The method is fixed per item (its key's request hash includes it).
    const methodOf = (itemKey) =>
      methods[
        parseInt(demoKey("method", itemKey).slice(0, 8), 16) % methods.length
      ]
    const paidOnOf = (purchase, product) =>
      purchase.paidDaysAgo === "expiring"
        ? plan.expiringCardPaidOn(product.validity_days)
        : addDays(today, -purchase.paidDaysAgo)

    async function approve(itemKey, label, customer, purchase, forCustomer) {
      const product = productOf(purchase.product)
      const method = methodOf(itemKey)
      return step(itemKey, label, async (key) => {
        const event = purchase.event ? eventId(purchase.event) : null
        if (purchase.event && !event) {
          warn(`${label}: המפגש ${purchase.event} לא נוצר.`)
          return undefined
        }
        const result = await rpc(admin, "admin_approve_payment", {
          p_customer_id: forCustomer,
          p_payer_label: forCustomer ? null : customer.fullName,
          p_product_id: product.id,
          p_event_id: event,
          p_amount_agorot: product.price_agorot,
          p_amount_override_reason: null,
          p_paid_on: paidOnOf(purchase, product),
          p_payment_method_id: method.id,
          p_reference: null,
          p_note: null,
          p_confirmed: false,
          p_duplicate_confirmed: true,
          p_idempotency_key: key,
        })
        // The raw token stays in memory only.
        const { token, ...stored } = result
        if (token) tokens.set(itemKey, token)
        return stored
      })
    }

    // Tal's card booking (admin_book_customer). E0 ends a few minutes after
    // the first run, so its bookings run right after each customer's join.
    async function bookByAdmin(who, event) {
      const customer = castOf(who)
      await step(`book:${who}:${event}`, `הרשמה של ${customer.fullName} ל-${event}`, async (key) => {
        if (!customerId(who) || !eventId(event)) {
          warn(`הרשמה של ${customer.fullName} ל-${event} דולגה: הלקוחה או המפגש חסרים.`)
          return undefined
        }
        try {
          return await rpc(admin, "admin_book_customer", {
            p_customer_id: customerId(who),
            p_event_id: eventId(event),
            p_idempotency_key: key,
          })
        } catch (error) {
          if (error.code === "EVENT_ENDED") {
            warn(`הרשמה של ${customer.fullName} ל-${event} דולגה: המפגש כבר הסתיים.`)
            return undefined
          }
          throw error
        }
      })
    }
    const bookedEarly = new Set()

    for (const customer of CUSTOMERS) {
      for (const [index, purchase] of customer.purchases.entries()) {
        const itemKey = `payment:${customer.key}:${index}`
        const label = `רכישה ${index + 1} של ${customer.fullName}`
        const isNew = index === 0
        if (!isNew && !customerId(customer.key)) {
          warn(`${label}: ${customer.fullName} עוד לא הצטרפה.`)
          continue
        }
        const paid = await approve(
          itemKey,
          label,
          customer,
          purchase,
          isNew ? null : customerId(customer.key)
        )
        if (isNew && paid && customer.joins !== false) {
          await join(admin, customer, itemKey, today)
          for (const [who, event] of ADMIN_BOOKINGS) {
            if (who !== customer.key || event !== "E0") continue
            await bookByAdmin(who, event)
            bookedEarly.add(`${who}:${event}`)
          }
        }
      }
    }

    // Keren's second link: her email and another customer's phone.
    {
      const keren = castOf(CONFLICT.customer)
      const other = castOf(CONFLICT.phoneOf)
      const itemKey = `payment:${keren.key}:conflict`
      const paid = await approve(
        itemKey,
        `רכישה חדשה של ${keren.fullName} (קישור בהתנגשות)`,
        keren,
        { product: CONFLICT.product, paidDaysAgo: CONFLICT.paidDaysAgo },
        null
      )
      if (paid && customerId(keren.key) && customerId(other.key)) {
        await step(`conflict:${keren.key}`, `הקישור של ${keren.fullName} ב"לטיפול"`, async () => {
          const live = await liveToken(admin, itemKey, paid)
          if (!live) return undefined
          if (live.joined) {
            warn(`הקישור של ${keren.fullName} כבר שויך, ולכן אינו בהתנגשות.`)
            return { outcome: "joined" }
          }
          let outcome = null
          for (let attempt = 1; attempt <= CONFLICT.attempts; attempt++) {
            const begin = await rpc(service, "join_begin", {
              p_token: live.token,
              p_email: demoEmail(keren.email),
              p_phone: other.phone,
              p_idempotency_key: demoKey(
                state.generation,
                `conflict:${keren.key}:attempt:${attempt}`
              ),
            })
            outcome = begin.outcome
            if (outcome === "conflict") {
              return { outcome, reason: begin.reason, token_id: begin.token_id }
            }
          }
          throw new Error(`join_begin: ${outcome}`)
        })
      } else if (paid) {
        warn(`הקישור של ${keren.fullName} דולג: חסרה לקוחה שעוד לא הצטרפה.`)
      }
    }

    // 3. Bookings (E0 ones are already done, right after each join).
    for (const [who, event] of ADMIN_BOOKINGS) {
      if (bookedEarly.has(`${who}:${event}`)) continue
      await bookByAdmin(who, event)
    }

    const login = castOf(LOGIN_CUSTOMER)
    const asCustomer = async () => {
      customerClient ??= await signedIn(demoEmail(login.email))
      return customerClient
    }

    {
      const who = castOf(SELF_BOOKINGS.customer)
      const ids = SELF_BOOKINGS.events.map(eventId)
      if (customerId(who.key) && ids.every(Boolean)) {
        const booked = await step(
          `self-book:${who.key}`,
          `${who.fullName} נרשמת בעצמה ל-${SELF_BOOKINGS.events.join(", ")}`,
          async (key) =>
            rpc(await asCustomer(), "book_sessions", {
              p_items: ids,
              p_idempotency_key: key,
            })
        )
        for (const item of booked?.results ?? []) {
          if (!item.ok) warn(`הרשמה עצמית של ${who.fullName} נדחתה: ${item.code}`)
        }
      } else {
        warn(`ההרשמה העצמית של ${who.fullName} דולגה.`)
      }
    }

    // 4. Maya cancels her single entry for E4 and chooses a credit for the
    //    next matching sessions (story 3.7).
    {
      const who = castOf(SELF_CANCEL.customer)
      const index = who.purchases.findIndex((p) => p.event === SELF_CANCEL.event)
      const booking = state.items[`payment:${who.key}:${index}`]?.booking_id
      if (customerId(who.key) && isUuid(booking)) {
        await step(
          `cancel:${who.key}:${SELF_CANCEL.event}`,
          `${who.fullName} מבטלת את ${SELF_CANCEL.event}`,
          async (key) =>
            rpc(await asCustomer(), "cancel_booking", {
              p_booking_id: booking,
              p_idempotency_key: key,
              p_choice: "credit",
            })
        )
      } else {
        warn(`הביטול של ${who.fullName} דולג.`)
      }
    }

    // 5. Tal's notes.
    for (const [index, note] of NOTES.entries()) {
      const customer = castOf(note.customer)
      if (!customerId(note.customer)) {
        warn(`ההערה על ${customer.fullName} דולגה.`)
        continue
      }
      await step(`note:${index}`, `הערה על ${customer.fullName}`, (key) =>
        rpc(admin, "admin_add_customer_note", {
          p_customer_id: customerId(note.customer),
          p_body: note.body,
          p_idempotency_key: key,
        })
      )
    }

    // 6. The work sheet of E5.
    const sheetEvent = eventId(WORK_SHEET.event)
    if (sheetEvent) {
      for (const [d, dish] of WORK_SHEET.dishes.entries()) {
        const added = await step(`dish:${d}`, `מנה: ${dish.name}`, (key) =>
          rpc(admin, "admin_add_work_dish", {
            p_event_id: sheetEvent,
            p_name: dish.name,
            p_idempotency_key: key,
          })
        )
        for (const [t, task] of dish.tasks.entries()) {
          const taskRow = await step(`task:${d}:${t}`, `משימה: ${task.body}`, (key) =>
            rpc(admin, "admin_add_work_task", {
              p_dish_id: added.dish_id,
              p_day_offset: task.day,
              p_body: task.body,
              p_idempotency_key: key,
            })
          )
          if (task.done) {
            await step(`task-done:${d}:${t}`, `בוצע: ${task.body}`, () =>
              rpc(admin, "admin_set_work_task_done", {
                p_task_id: taskRow.task_id,
                p_done: true,
              })
            )
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
        await step(`bought:${i}`, `נקנה: ${item.body}`, () =>
          rpc(admin, "admin_set_shopping_item_bought", {
            p_item_id: shopping.item_ids[i],
            p_bought: true,
          })
        )
      }
    } else {
      warn(`דף העבודה דולג: המפגש ${WORK_SHEET.event} לא נוצר.`)
    }

    // 7. A gallery photo for each session (already published).
    if (galleryMedia.length === 0) {
      warn("אין תמונות בגלריה, ולכן המפגשים בלי תמונה.")
    } else {
      for (const [index, key] of Object.keys(SESSIONS).entries()) {
        if (!eventId(key)) continue
        await step(`image:${key}`, `תמונה למפגש ${key}`, async () => {
          const result = await rpc(admin, "admin_set_event_image", {
            p_event_id: eventId(key),
            p_media_id: galleryMedia[index % galleryMedia.length],
          })
          // As the screens do: a photo nothing uses any more is hidden, and
          // its public file goes.
          if (result.hidden_paths?.length) {
            const removed = await service.storage
              .from("media-public")
              .remove(result.hidden_paths)
            if (removed.error) {
              warn(`קובץ ציבורי של תמונה שהוסתרה לא נמחק (${removed.error.statusCode ?? removed.error.name}).`)
            }
          }
          return { image_id: result.image_id }
        })
      }
    }

    // Summary.
    const items = state.items
    const pinned = Object.entries(items).filter(
      ([key, value]) => key.startsWith("payment:") && isUuid(value?.booking_id)
    ).length
    const adminBooked = Object.keys(items).filter((k) => k.startsWith("book:")).length
    const selfBooked = Object.entries(items)
      .filter(([key]) => key.startsWith("self-book:"))
      .flatMap(([, value]) => value?.results ?? [])
      .filter((r) => r.ok).length
    const sessionsCount = Object.keys(items).filter((k) => k.startsWith("event:")).length
    const joined = CUSTOMERS.filter((c) => customerId(c.key))

    console.log("")
    console.log(
      `סיכום: ${stepper.counts.created} נוצרו עכשיו, ${stepper.counts.existing} כבר היו.`
    )
    const cancelled = Object.keys(items).filter((k) => k.startsWith("cancel:")).length
    console.log(
      `מפגשים: ${sessionsCount}. הרשמות: ${pinned + adminBooked + selfBooked}, מהן ${cancelled} בוטלו.`
    )
    console.log("לקוחות ההדגמה:")
    for (const c of joined) console.log(`  ${c.fullName}: ${demoEmail(c.email)}`)
    console.log("")
    console.log(
      `מפגש ${plan.e0.date} ${plan.e0.start_time}-${plan.e0.end_time} (E0) נסגר אוטומטית בתוך כ-10 דקות מסיומו (המשימה רצה כל 5 דקות).`
    )
    console.log(
      `כניסה כלקוחת ההדגמה: node scripts/dev-reset-link.mjs --email ${demoEmail(login.email)}`
    )
    if (warnings.length > 0) {
      console.log("")
      console.log(`${warnings.length} אזהרות (ראו למעלה).`)
    }
  } finally {
    // Local only: the default (global) would end every session of the dev
    // admin and of the login customer on all devices.
    await admin.auth.signOut({ scope: "local" })
    if (customerClient) await customerClient.auth.signOut({ scope: "local" })
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
