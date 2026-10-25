// Story 5.22: the rules check of the video cast (pure, no env, no network),
// tested in test/video-cast.test.ts. video-seed runs it before writing
// anything and stops (exit 1) naming the first broken rule.
//
// Rules: user guidelines 1–4 (weekdays; no two active cards; no card with a
// future single entry; a couple session on top is allowed), entries per card
// within its units and its validity (also on the temporary date of a
// history session), occupancy targets (U2 full, U4 within the last-places
// threshold, U5 at most 2), babies' birth dates within 2 years back to 9
// months ahead of the run day, every credit alternative a session that
// accepts the credit's product, unique emails and phones in the domain and
// range, and no "טל" in the fictional copy.

import {
  COUPLE_WEEKDAY,
  REGULAR_WEEKDAYS,
  addDays,
  daysBetween,
  isHistory,
  paidOnOf,
  weekday,
} from "./video-plan.mjs"

const SINGLE_TYPES = ["single", "intro"]
const EMAIL_LOCAL = /^[a-z0-9._-]+$/
const PHONE = /^03-00002\d\d$/
const FORBIDDEN_WORD = "טל"

/**
 * The bookings, entitlements and occupancy the cast leads to (also used by
 * the seed's summary). Throws on a reference that does not exist.
 *
 * @param {any} cast the cast with its plan (planVideoDates)
 * @param {any[]} products rows of public.products
 */
export function deriveWorld(cast, products) {
  const { plan } = cast
  const today = plan.today
  const productOf = (type) =>
    products.find((p) => p.type === type && p.active !== false) ?? null
  const personaOf = (key) => cast.personas.find((p) => p.key === key) ?? null

  const sessions = {}
  for (const [key, spec] of Object.entries(cast.sessions)) {
    const kind = /^(F\d|HF)$/.test(key) ? "couple" : "regular"
    sessions[key] = {
      key,
      ...spec,
      kind,
      date: plan.sessions[key],
      temp: isHistory(key) ? plan.temp[key].temp : null,
      capacity: cast.capacity[kind],
    }
  }

  const entitlements = []
  const bookings = []
  for (const persona of cast.personas) {
    persona.purchases.forEach((purchase, index) => {
      const product = productOf(purchase.product)
      if (!product) throw new Error(`אין מוצר פעיל מסוג ${purchase.product}`)
      const event = purchase.event ? sessions[purchase.event] : null
      if (purchase.event && !event) {
        throw new Error(`מפגש לא מוכר ${purchase.event}`)
      }
      const paidOn = paidOnOf(purchase.paid, {
        today,
        eventDate: event?.date ?? null,
        validityDays: product.validity_days,
      })
      const pinned = product.validity_mode === "session"
      const entitlement = {
        id: `${persona.key}:${index}`,
        owner: persona.joins === false ? null : persona.key,
        persona: persona.key,
        type: product.type,
        product,
        units: product.units,
        event: purchase.event ?? null,
        paidOn,
        validFrom: paidOn,
        expiresOn: pinned
          ? event.date > paidOn
            ? event.date
            : paidOn
          : addDays(paidOn, product.validity_days),
        entries: [],
      }
      entitlements.push(entitlement)
      if (pinned) {
        const booking = {
          who: persona.key,
          owner: entitlement.owner,
          event: purchase.event,
          entitlement,
          party: product.party_size,
          pinned: true,
          cancelled: false,
        }
        bookings.push(booking)
        entitlement.entries.push(booking)
      }
    })
  }

  const cardOf = (who, eventKey) => {
    const event = sessions[eventKey]
    return (
      entitlements
        .filter(
          (e) =>
            e.owner === who &&
            e.product.validity_mode === "days" &&
            e.product.eligible_event_kind === event.kind &&
            e.entries.filter((b) => !b.released).length < e.units &&
            e.validFrom <= event.date &&
            event.date <= e.expiresOn
        )
        .sort((a, b) => (a.expiresOn < b.expiresOn ? -1 : 1))[0] ?? null
    )
  }

  const cardBookings = [
    ...cast.adminBookings.map(([who, event]) => ({ who, event, by: "admin" })),
    ...cast.selfBookings.flatMap(({ who, events }) =>
      events.map((event) => ({ who, event, by: "self" }))
    ),
  ]
  for (const { who, event, by } of cardBookings) {
    if (!personaOf(who)) throw new Error(`דמות לא מוכרת ${who}`)
    if (!sessions[event]) throw new Error(`מפגש לא מוכר ${event}`)
    const card = cardOf(who, event)
    const booking = {
      who,
      owner: who,
      event,
      entitlement: card,
      party: 1,
      pinned: false,
      by,
      cancelled: false,
    }
    bookings.push(booking)
    if (card) card.entries.push(booking)
  }

  for (const cancel of cast.selfCancels) {
    const booking = bookings.find(
      (b) => b.who === cancel.who && b.event === cancel.event && b.pinned
    )
    if (booking) {
      booking.cancelled = true
      booking.choice = cancel.choice
    }
  }
  if (cast.businessCancel) {
    for (const booking of bookings) {
      if (booking.event !== cast.businessCancel) continue
      booking.cancelled = true
      if (!booking.pinned) booking.released = true
    }
  }

  const occupancy = {}
  const peak = {}
  for (const key of Object.keys(sessions)) {
    const here = bookings.filter((b) => b.event === key)
    peak[key] = here.reduce((n, b) => n + b.party, 0)
    occupancy[key] = here
      .filter((b) => !b.cancelled)
      .reduce((n, b) => n + b.party, 0)
  }

  return { today, sessions, entitlements, bookings, occupancy, peak }
}

/**
 * The broken rules of a cast, [] when it passes.
 *
 * @param {any} cast the cast with its plan (planVideoDates)
 * @param {any[]} products rows of public.products
 * @param {{ last_places_threshold: number, credit_options_count: number, cancel_window_hours: number }} settings
 * @returns {{ rule: string, message: string }[]}
 */
export function checkCast(cast, products, settings) {
  const errors = []
  const fail = (rule, message) => errors.push({ rule, message })

  let world
  try {
    world = deriveWorld(cast, products)
  } catch (error) {
    return [{ rule: "references", message: error.message }]
  }
  const { today, sessions, entitlements, bookings, occupancy, peak } = world

  // Guideline 1: weekdays (and the temporary date keeps the weekday).
  for (const s of Object.values(sessions)) {
    const allowed = s.kind === "couple" ? [COUPLE_WEEKDAY] : REGULAR_WEEKDAYS
    if (!allowed.includes(weekday(s.date))) {
      fail("guideline-1", `${s.key} (${s.date}) לא ביום שמותר למפגש ${s.kind}`)
    }
    if (s.temp && weekday(s.temp) !== weekday(s.date)) {
      fail("guideline-1", `התאריך הזמני של ${s.key} ביום אחר בשבוע`)
    }
    if (isHistory(s.key) ? s.date >= today : s.date <= today) {
      fail("dates", `${s.key} (${s.date}) בצד הלא נכון של יום ההרצה`)
    }
  }

  // Entries per card: units and validity (real and temporary dates).
  for (const e of entitlements) {
    if (e.paidOn > today) fail("validity", `${e.id}: תאריך תשלום בעתיד`)
    const live = e.entries.filter((b) => !b.released)
    if (live.length > e.units) {
      fail("units", `${e.persona}: ${live.length} כניסות בכרטיסייה של ${e.units}`)
    }
    for (const b of e.entries) {
      const s = sessions[b.event]
      // A pinned purchase follows its session (approval: greatest(session
      // day, paid_on); DW2 moves it with the session): paid by its real day.
      const dates = b.pinned ? [s.date] : [s.date, s.temp].filter(Boolean)
      for (const date of dates) {
        if (date < e.validFrom || date > e.expiresOn) {
          fail("validity", `${b.who} ב-${b.event} (${date}) מחוץ לתוקף של ${e.id}`)
        }
      }
      if (s.kind !== e.product.eligible_event_kind) {
        fail("validity", `${b.who}: ${e.type} לא מתאים ל-${b.event}`)
      }
    }
  }
  for (const b of bookings) {
    if (!b.entitlement) {
      fail("units", `ל-${b.who} אין כרטיסייה בתוקף ל-${b.event}`)
    }
  }

  // Guidelines 2 and 3, at the end of the seed.
  const activeCards = (who) =>
    entitlements.filter((e) => {
      if (e.owner !== who || e.type !== "card") return false
      if (e.expiresOn < today) return false
      const live = e.entries.filter((b) => !b.released && !b.cancelled)
      const future = live.filter((b) => sessions[b.event].date > today)
      return live.length < e.units || future.length > 0
    })
  for (const persona of cast.personas) {
    if (persona.joins === false) continue
    const cards = activeCards(persona.key)
    if (cards.length > 1) {
      fail("guideline-2", `ל-${persona.fullName} שתי כרטיסיות פעילות`)
    }
    const futureSingle = bookings.some(
      (b) =>
        b.owner === persona.key &&
        b.pinned &&
        !b.cancelled &&
        SINGLE_TYPES.includes(b.entitlement.type) &&
        sessions[b.event].date > today
    )
    if (cards.length > 0 && futureSingle) {
      fail("guideline-3", `ל-${persona.fullName} כרטיסייה וגם כניסה בודדת עתידית`)
    }
  }

  // Occupancy.
  for (const s of Object.values(sessions)) {
    if (peak[s.key] > s.capacity) {
      fail("capacity", `${s.key}: ${peak[s.key]} מקומות מתוך ${s.capacity}`)
    }
    if (typeof s.target === "number" && occupancy[s.key] !== s.target) {
      fail("occupancy", `${s.key}: ${occupancy[s.key]} במקום ${s.target}`)
    }
    if (s.draft && peak[s.key] > 0) {
      fail("occupancy", `${s.key} טיוטה ויש בה הרשמות`)
    }
  }
  if (sessions.U2 && occupancy.U2 !== sessions.U2.capacity) {
    fail("occupancy", "U2 חייב להיות מלא")
  }
  if (sessions.U4) {
    const free = sessions.U4.capacity - occupancy.U4
    if (free < 1 || free > settings.last_places_threshold) {
      fail("occupancy", `ב-U4 ${free} מקומות פנויים, לא "מקומות אחרונים"`)
    }
  }
  if (sessions.U5 && occupancy.U5 > 2) {
    fail("occupancy", "ב-U5 יותר משתי נרשמות")
  }

  // Babies.
  const oldest = addDays(today, -730)
  for (const persona of cast.personas) {
    if (persona.joins === false) continue
    if (!Array.isArray(persona.babies) || persona.babies.length < 1 || persona.babies.length > 10) {
      fail("babies", `${persona.fullName}: בין תינוק אחד לעשרה`)
      continue
    }
    for (const baby of persona.babies) {
      const birth = addDays(today, -baby.ageDays)
      const limitAhead = new Date(`${today}T00:00:00Z`)
      limitAhead.setUTCMonth(limitAhead.getUTCMonth() + 9)
      const latest = limitAhead.toISOString().slice(0, 10)
      const back = new Date(`${today}T00:00:00Z`)
      back.setUTCFullYear(back.getUTCFullYear() - 2)
      const earliest = back.toISOString().slice(0, 10)
      if (birth < earliest || birth > latest || birth < oldest) {
        fail("babies", `${persona.fullName}: תאריך לידה ${birth} מחוץ לטווח`)
      }
    }
  }

  // Credits: the alternatives of each self cancellation with a credit.
  const minDays = Math.ceil(settings.cancel_window_hours / 24) + 1
  for (const cancel of cast.selfCancels) {
    const booking = bookings.find(
      (b) => b.who === cancel.who && b.event === cancel.event && b.pinned
    )
    if (!booking) {
      fail("credits", `אין ל-${cancel.who} כניסה בודדת ב-${cancel.event} לביטול`)
      continue
    }
    const origin = sessions[cancel.event]
    if (daysBetween(today, origin.date) < minDays) {
      fail("credits", `${cancel.event} קרוב מדי לביטול עצמי`)
    }
    if (cancel.choice !== "credit") continue
    const candidates = Object.values(sessions)
      .filter(
        (s) =>
          !isHistory(s.key) &&
          !s.draft &&
          s.key !== cast.businessCancel &&
          s.kind === origin.kind &&
          s.date > origin.date &&
          occupancy[s.key] + booking.party <= s.capacity &&
          !bookings.some((b) => b.who === cancel.who && b.event === s.key && !b.cancelled)
      )
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, settings.credit_options_count)
    if (candidates.length < settings.credit_options_count) {
      fail("credits", `לזיכוי של ${cancel.who} אין ${settings.credit_options_count} חלופות`)
    }
    for (const s of candidates) {
      const accepts =
        !Array.isArray(s.products) || s.products.includes(booking.entitlement.type)
      if (!accepts) {
        fail("credits", `${s.key} לא מקבל את המוצר של הזיכוי של ${cancel.who}`)
      }
    }
  }
  for (const who of cast.completedRefunds) {
    if (!cast.selfCancels.some((c) => c.who === who && c.choice === "refund")) {
      fail("credits", `אין ל-${who} בקשת החזר להשלמה`)
    }
  }

  // Waitlist: a full session, a customer not booked there.
  for (const { who, event } of cast.waitlist) {
    const s = sessions[event]
    if (!s || occupancy[event] < s.capacity) {
      fail("waitlist", `${event} לא מלא, אי אפשר להמתין לו`)
    }
    if (bookings.some((b) => b.who === who && b.event === event && !b.cancelled)) {
      fail("waitlist", `${who} כבר רשומה ל-${event}`)
    }
  }

  // Emails and phones.
  const emails = new Set()
  const phones = new Set()
  for (const persona of cast.personas) {
    const pairs =
      persona.joins === false
        ? persona.liveEmail
          ? [[persona.liveEmail, persona.livePhone]]
          : []
        : [[persona.email, persona.phone]]
    for (const [email, phone] of pairs) {
      if (typeof email !== "string" || !EMAIL_LOCAL.test(email)) {
        fail("contacts", `${persona.fullName}: מייל לא תקין`)
      } else if (emails.has(email)) {
        fail("contacts", `המייל ${email} כפול`)
      }
      emails.add(email)
      if (typeof phone !== "string" || !PHONE.test(phone)) {
        fail("contacts", `${persona.fullName}: טלפון מחוץ לטווח 03-00002NN`)
      } else if (phones.has(phone)) {
        fail("contacts", `הטלפון ${phone} כפול`)
      }
      phones.add(phone)
    }
  }
  if (cast.conflict) {
    const a = cast.personas.find((p) => p.key === cast.conflict.customer)
    const b = cast.personas.find((p) => p.key === cast.conflict.phoneOf)
    if (!a || !b || a.joins === false || b.joins === false || a === b) {
      fail("contacts", "ההתנגשות צריכה שתי לקוחות שהצטרפו")
    }
  }

  // No "טל" in the fictional copy.
  const texts = [
    ...cast.personas.flatMap((p) => [
      p.fullName,
      p.dietaryNotes,
      ...(p.babies ?? []).map((b) => b.name),
    ]),
    ...cast.customerNotes.map((n) => n.body),
    ...cast.boardNotes.map((n) => n.body),
    cast.companionNote?.text,
    ...cast.workSheet.dishes.flatMap((d) => [d.name, ...d.tasks.map((t) => t.body)]),
    ...cast.workSheet.shopping.map((i) => i.body),
  ].filter((t) => typeof t === "string")
  for (const text of texts) {
    if (text.includes(FORBIDDEN_WORD)) {
      fail("copy", `"${text}" מכיל "${FORBIDDEN_WORD}"`)
    }
  }

  return errors
}
