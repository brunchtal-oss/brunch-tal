// Story 3.13: entitlement corrections. admin_correct_entitlement with its
// plan and preview, the fit helper, the warned bookings in "to handle" and
// admin_set_correction_booking_handled, admin_get_entitlement, is_extended,
// the three templates, and admin_settle_parked_purchase (a purchase paid
// without a place in a session the business cancelled). One test per row
// of the spec's I/O matrix. Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const CORRECT =
  "select public.admin_correct_entitlement($1, $2, $3::jsonb, $4, $5, $6, $7) as r"
const PREVIEW =
  "select public.preview_admin_correct_entitlement($1, $2, $3::jsonb) as r"
const GET = "select public.admin_get_entitlement($1) as r"
const HANDLED = "select public.admin_set_correction_booking_handled($1) as r"
const SETTLE = "select public.admin_settle_parked_purchase($1, $2, $3, $4) as r"
const PREVIEW_SETTLE =
  "select public.preview_admin_settle_parked_purchase($1) as r"
const ATTENTION = "select public.admin_get_attention_items() as r"
const OPEN_CARDS = "select public.admin_list_open_cards('all') as r"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL_EVENT =
  "select public.admin_cancel_event($1, true, 'בוטל', $2, true) as r"

type Fixture = MoneyFixture & { single: string; mothers: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  const { rows: p } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1)
     returning id`,
    [testName("single")]
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.concepts where archived_at is null order by name limit 1"
  )
  return { ...f, single: p[0].id, mothers: rows[0].id }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// A published regular session at 10:00 local, `dayOffset` days from today;
// weekday: the next such weekday (0 = Sunday) at least a week ahead.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: { dayOffset?: number; weekday?: number }
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true, 'published'
     from (
       select ((d.today + coalesce(
                 $2::int,
                 7 + (($3::int - extract(dow from d.today)::int + 7) % 7)
               )) + time '10:00') at time zone 'Asia/Jerusalem' as t
       from (select (now() at time zone 'Asia/Jerusalem')::date as today) d
     ) s
     returning id`,
    [f.mothers, options.dayOffset ?? null, options.weekday ?? null]
  )
  return rows[0].id
}

async function grantCard(
  db: Db,
  f: Fixture,
  customerId: string | null = f.customerA
) {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId,
      productId: f.card,
      amount: 47200,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  const { rows } = await db.query(
    "select id from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  return rows[0].id as string
}

async function book(
  db: Db,
  customer: string,
  eventId: string
): Promise<string> {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    return rows[0].r.booking_id as string
  })
}

async function correct(
  db: Db,
  f: Fixture,
  entitlementId: string,
  field: string,
  value: unknown,
  options: {
    reason?: string | null
    related?: string | null
    confirmed?: boolean | null
    key?: string
  } = {}
) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(CORRECT, [
      entitlementId,
      field,
      JSON.stringify(value),
      options.related ?? null,
      options.reason ?? null,
      options.confirmed === undefined ? true : options.confirmed,
      options.key ?? randomUUID(),
    ])
    return rows[0].r
  })
}

// The error of a statement with its detail (queryError keeps only the code).
async function errorOf(
  db: Db,
  user: string,
  text: string,
  params: unknown[]
): Promise<{ message: string; detail: unknown }> {
  return as(db, user, async () => {
    await db.query("savepoint e")
    try {
      await db.query(text, params)
      await db.query("release savepoint e")
      return { message: "", detail: null }
    } catch (error) {
      await db.query("rollback to savepoint e")
      const e = error as { message: string; detail?: string }
      return {
        message: e.message,
        detail: e.detail ? JSON.parse(e.detail) : null,
      }
    }
  })
}

async function entitlement(db: Db, id: string) {
  const { rows } = await db.query(
    `select e.expires_on::text, e.allowed_weekdays, e.eligible_event_kind,
       b.available, b.reserved, b.used
     from public.entitlements e
     join public.entitlement_balances b on b.entitlement_id = e.id
     where e.id = $1`,
    [id]
  )
  return rows[0]
}

async function notifications(db: Db, customer: string) {
  const { rows } = await db.query(
    "select type, payload, target_path from public.notifications where recipient_id = $1 order by created_at",
    [customer]
  )
  return rows
}

async function attention(db: Db, f: Fixture) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(ATTENTION)
    return rows[0].r as Array<Record<string, unknown>>
  })
}

async function addDays(db: Db, day: string, n: number): Promise<string> {
  const { rows } = await db.query("select ($1::date + $2::int)::text as d", [
    day,
    n,
  ])
  return rows[0].d
}

describe("admin_correct_entitlement", { timeout: 60_000 }, () => {
  it("extend: expiry later, correction and audit with the reason, entitlement_changed, is_extended on the page and the open cards", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      const before = await entitlement(db, card)
      const later = await addDays(db, before.expires_on, 14)

      const r = await correct(db, f, card, "expires_on", later, {
        reason: testName("extend"),
      })
      expect(r).toMatchObject({ affected_count: 0 })
      expect((await entitlement(db, card)).expires_on).toBe(later)

      const { rows: corr } = await db.query(
        "select field, old_value, new_value, reason, actor_kind, actor_id from public.entitlement_corrections where entitlement_id = $1",
        [card]
      )
      expect(corr).toEqual([
        {
          field: "expires_on",
          old_value: before.expires_on,
          new_value: later,
          reason: testName("extend"),
          actor_kind: "admin",
          actor_id: f.admin,
        },
      ])
      const { rows: audit } = await db.query(
        "select before, after, reason from public.audit_log where action = 'admin_correct_entitlement' and entity_id = $1",
        [card]
      )
      // expires_at is generated from expires_on and changes with it.
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        before: { expires_on: before.expires_on },
        after: { expires_on: later },
        reason: testName("extend"),
      })

      const notes = await notifications(db, f.customerA)
      const changed = notes.filter((n) => n.type === "entitlement_changed")
      expect(changed).toHaveLength(1)
      expect(changed[0].target_path).toBe(`/me/purchases/${card}`)
      expect(changed[0].payload.title).toBe("תוקף הכרטיסייה עודכן")
      const [y, m, d] = later.split("-")
      expect(changed[0].payload.body).toBe(
        `הכרטיסייה שלך בתוקף עד ${d}.${m}, ונשארו בה 4 כניסות פנויות. הפרטים באזור האישי`
      )
      void y

      const page = await as(db, f.admin, async () => {
        const { rows } = await db.query(GET, [card])
        return rows[0].r
      })
      expect(page).toMatchObject({
        is_extended: true,
        correctable: true,
        expires_on: later,
      })
      expect(page.corrections[0]).toMatchObject({
        field: "expires_on",
        old_value: before.expires_on,
        new_value: later,
        reason: testName("extend"),
        actor_kind: "admin",
      })

      const open = await as(db, f.admin, async () => {
        const { rows } = await db.query(OPEN_CARDS)
        return rows[0].r
      })
      expect(
        open.find((c: { entitlement_id: string }) => c.entitlement_id === card)
      ).toMatchObject({ is_extended: true })

      // Earlier than the original: no longer "extended".
      await correct(
        db,
        f,
        card,
        "expires_on",
        await addDays(db, before.expires_on, -1)
      )
      const again = await as(db, f.admin, async () => {
        const { rows } = await db.query(GET, [card])
        return rows[0].r
      })
      expect(again.is_extended).toBe(false)
    })
  })

  it("an expired card with a returned entry: extended, the entry is bookable at once", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      await db.query(
        `update public.entitlements
         set valid_from = $2::date - 60, expires_on = $2::date - 1
         where id = $1`,
        [card, f.today]
      )
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      expect(
        await as(db, f.customerA, () =>
          queryError(db, BOOK, [ev, randomUUID()])
        )
      ).toMatchObject({ message: "ENTITLEMENT_EXPIRED_ON_DATE" })

      await correct(db, f, card, "expires_on", await addDays(db, f.today, 14))
      const booking = await book(db, f.customerA, ev)
      expect(booking).toBeTruthy()
    })
  })

  it("no checkbox: CONFIRM_REQUIRED, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      const before = await entitlement(db, card)
      for (const [field, value] of [
        ["expires_on", await addDays(db, before.expires_on, 7)],
        ["units", 2],
        ["allowed_weekdays", [0]],
        // A card's kind never changes (user decision 2026-10-19).
        ["allowed_weekdays", [1, 2]],
      ] as const) {
        for (const confirmed of [false, null]) {
          const e = await errorOf(db, f.admin, CORRECT, [
            card,
            field,
            JSON.stringify(value),
            null,
            null,
            confirmed,
            randomUUID(),
          ])
          expect(e.message).toBe("CONFIRM_REQUIRED")
        }
      }
      expect(await entitlement(db, card)).toEqual(before)
      const { rows } = await db.query(
        "select count(*)::int as n from public.entitlement_corrections where entitlement_id = $1",
        [card]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("a card's kind cannot become couple: INVALID_INPUT eligible_event_kind, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      const before = await entitlement(db, card)
      expect(
        await errorOf(db, f.admin, CORRECT, [
          card,
          "eligible_event_kind",
          JSON.stringify("couple"),
          null,
          null,
          true,
          randomUUID(),
        ])
      ).toEqual({
        message: "INVALID_INPUT",
        detail: { field: "eligible_event_kind" },
      })
      expect(await entitlement(db, card)).toEqual(before)
      const { rows } = await db.query(
        "select count(*)::int as n from public.entitlement_corrections where entitlement_id = $1",
        [card]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("balance down 2 → 0: one adjust of -2, the reserved entries untouched; the related session and entitlement_units_changed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      const e1 = await insertEvent(db, f, { dayOffset: 3 })
      const e2 = await insertEvent(db, f, { dayOffset: 4 })
      await book(db, f.customerA, e1)
      await book(db, f.customerA, e2)
      expect(await entitlement(db, card)).toMatchObject({
        available: 2,
        reserved: 2,
      })

      const preview = await as(db, f.admin, async () => {
        const { rows } = await db.query(PREVIEW, [card, "units", "0"])
        return rows[0].r
      })
      expect(preview).toMatchObject({
        ok: true,
        old_value: 2,
        new_value: 0,
        available: 2,
        affected: [],
      })

      await correct(db, f, card, "units", 0, {
        related: e1,
        reason: testName("fix"),
      })
      expect(await entitlement(db, card)).toMatchObject({
        available: 0,
        reserved: 2,
      })
      const { rows: m } = await db.query(
        "select units, reason, actor_id from public.entitlement_movements where entitlement_id = $1 and action = 'adjust'",
        [card]
      )
      expect(m).toEqual([
        { units: -2, reason: testName("fix"), actor_id: f.admin },
      ])
      const { rows: c } = await db.query(
        "select related_event_id from public.entitlement_corrections where entitlement_id = $1",
        [card]
      )
      expect(c[0].related_event_id).toBe(e1)
      const n = (await notifications(db, f.customerA)).filter(
        (x) => x.type === "entitlement_units_changed"
      )
      expect(n).toHaveLength(1)
      expect(n[0].payload.body).toMatch(
        /^יש לך עכשיו 0 כניסות פנויות בכרטיסייה/
      )

      // NO_CHANGE at the same number; a session not of this card.
      expect(
        (
          await errorOf(db, f.admin, CORRECT, [
            card,
            "units",
            "0",
            null,
            null,
            true,
            randomUUID(),
          ])
        ).message
      ).toBe("NO_CHANGE")
      const other = await insertEvent(db, f, { dayOffset: 6 })
      expect(
        await errorOf(db, f.admin, CORRECT, [
          card,
          "units",
          "1",
          other,
          null,
          true,
          randomUUID(),
        ])
      ).toEqual({
        message: "INVALID_INPUT",
        detail: { field: "related_event" },
      })
    })
  })

  it("below zero, a bad value or a long reason: INVALID_INPUT with the field, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      const before = await entitlement(db, card)
      const cases: Array<[string, unknown, string]> = [
        ["units", -1, "units"],
        ["units", 1.5, "units"],
        ["units", 100, "units"],
        ["expires_on", "2020-01-01", "expires_on"],
        ["expires_on", "2026-02-30", "expires_on"],
        ["allowed_weekdays", [], "allowed_weekdays"],
        ["allowed_weekdays", [1, 1], "allowed_weekdays"],
        ["allowed_weekdays", [7], "allowed_weekdays"],
        ["eligible_event_kind", "vip", "eligible_event_kind"],
        ["validity_days", 3, "field"],
      ]
      for (const [field, value, detail] of cases) {
        expect(
          await errorOf(db, f.admin, CORRECT, [
            card,
            field,
            JSON.stringify(value),
            null,
            null,
            true,
            randomUUID(),
          ]),
          `${field} ${JSON.stringify(value)}`
        ).toEqual({ message: "INVALID_INPUT", detail: { field: detail } })
      }
      expect(
        await errorOf(db, f.admin, CORRECT, [
          card,
          "units",
          "2",
          null,
          "x".repeat(2001),
          true,
          randomUUID(),
        ])
      ).toEqual({ message: "INVALID_INPUT", detail: { field: "reason" } })
      expect(await entitlement(db, card)).toEqual(before)
    })
  })

  it("weekdays Sunday only: the preview lists the future Tuesday booking; after it the booking is unchanged and 'to handle' shows it; a new Tuesday booking is refused; טופל removes it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      const tue = await insertEvent(db, f, { weekday: 2 })
      const booking = await book(db, f.customerA, tue)

      const preview = await as(db, f.admin, async () => {
        const { rows } = await db.query(PREVIEW, [
          card,
          "allowed_weekdays",
          "[0]",
        ])
        return rows[0].r
      })
      expect(preview).toMatchObject({
        ok: true,
        old_value: null,
        new_value: [0],
      })
      expect(preview.affected).toHaveLength(1)
      expect(preview.affected[0]).toMatchObject({
        booking_id: booking,
        event_id: tue,
      })

      const r = await correct(db, f, card, "allowed_weekdays", [0])
      expect(r.affected_count).toBe(1)
      const { rows: b } = await db.query(
        "select status from public.bookings where id = $1",
        [booking]
      )
      expect(b[0].status).toBe("confirmed")
      expect((await entitlement(db, card)).allowed_weekdays).toEqual([0])
      expect(
        (await notifications(db, f.customerA)).filter(
          (n) => n.type === "entitlement_terms_changed"
        )
      ).toHaveLength(1)

      const item = (await attention(db, f)).find((i) => i.id === booking)
      expect(item).toMatchObject({
        kind: "correction_affected",
        entitlement_id: card,
        event_id: tue,
        customer_id: f.customerA,
        field: "allowed_weekdays",
      })

      // Booking after the correction.
      const tue2 = await insertEvent(db, f, {
        weekday: 2,
        dayOffset: undefined,
      })
      const tueLater = await db.query(
        "update public.events set starts_at = starts_at + interval '7 days', ends_at = ends_at + interval '7 days', registration_closes_at = registration_closes_at + interval '7 days' where id = $1",
        [tue2]
      )
      void tueLater
      expect(
        await as(db, f.customerA, () =>
          queryError(db, BOOK, [tue2, randomUUID()])
        )
      ).toMatchObject({ message: "NO_MATCHING_ENTITLEMENT" })

      // Handled.
      const h = await as(db, f.admin, async () => {
        const { rows } = await db.query(HANDLED, [booking])
        return rows[0].r
      })
      expect(h).toEqual({ booking_id: booking, handled_count: 1 })
      expect(
        (await attention(db, f)).find((i) => i.id === booking)
      ).toBeUndefined()
      const { rows: b2 } = await db.query(
        "select status from public.bookings where id = $1",
        [booking]
      )
      expect(b2[0].status).toBe("confirmed")
      expect(
        await as(db, f.admin, () => queryError(db, HANDLED, [randomUUID()]))
      ).toMatchObject({ message: "NOT_FOUND" })
      // A booking never warned about; a second tap changes nothing.
      await grantCard(db, f, f.customerB)
      const other = await book(
        db,
        f.customerB,
        await insertEvent(db, f, { dayOffset: 4 })
      )
      expect(
        await as(db, f.admin, () => queryError(db, HANDLED, [other]))
      ).toMatchObject({ message: "NOT_FOUND" })
      const again = await as(db, f.admin, async () => {
        const { rows } = await db.query(HANDLED, [booking])
        return rows[0].r
      })
      expect(again).toEqual({ booking_id: booking, handled_count: 0 })
    })
  })

  it("an earlier expiry: the preview lists the future booking after it, affected_count 1, and correction_affected with field expires_on", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      const ev = await insertEvent(db, f, { dayOffset: 10 })
      const booking = await book(db, f.customerA, ev)
      const earlier = await addDays(db, f.today, 5)
      const preview = await as(db, f.admin, async () => {
        const { rows } = await db.query(PREVIEW, [
          card,
          "expires_on",
          JSON.stringify(earlier),
        ])
        return rows[0].r
      })
      expect(
        preview.affected.map((a: { booking_id: string }) => a.booking_id)
      ).toEqual([booking])
      const r = await correct(db, f, card, "expires_on", earlier)
      expect(r.affected_count).toBe(1)
      expect(
        (await attention(db, f)).find((i) => i.id === booking)
      ).toMatchObject({
        kind: "correction_affected",
        field: "expires_on",
        entitlement_id: card,
      })
    })
  })

  it("admin_get_entitlement: NOT_FOUND for a missing id, correctable false for a pinned purchase; admin_get_customer has is_extended after an extension", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await as(db, f.admin, () => queryError(db, GET, [randomUUID()]))
      ).toMatchObject({ message: "NOT_FOUND" })
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      const r = await as(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: f.single,
          eventId: ev,
          amount: 12800,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      const { rows } = await db.query(
        "select id from public.entitlements where payment_id = $1",
        [r.payment_id]
      )
      const pinnedPage = await as(db, f.admin, async () => {
        const { rows: g } = await db.query(GET, [rows[0].id])
        return g[0].r
      })
      expect(pinnedPage.correctable).toBe(false)

      const card = await grantCard(db, f)
      const before = await entitlement(db, card)
      await correct(
        db,
        f,
        card,
        "expires_on",
        await addDays(db, before.expires_on, 7)
      )
      const customer = await as(db, f.admin, async () => {
        const { rows: c } = await db.query(
          "select public.admin_get_customer($1) as r",
          [f.customerA]
        )
        return c[0].r
      })
      expect(
        customer.entitlements.find(
          (e: { entitlement_id: string }) => e.entitlement_id === card
        )
      ).toMatchObject({ is_extended: true })
    })
  })

  it("a later correction that makes the booking fit again ends the item", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      const tue = await insertEvent(db, f, { weekday: 2 })
      const booking = await book(db, f.customerA, tue)
      await correct(db, f, card, "allowed_weekdays", [0])
      expect((await attention(db, f)).some((i) => i.id === booking)).toBe(true)
      await correct(db, f, card, "allowed_weekdays", null)
      expect((await entitlement(db, card)).allowed_weekdays).toBeNull()
      expect((await attention(db, f)).some((i) => i.id === booking)).toBe(false)
    })
  })

  it("a pinned purchase: NOT_A_CARD", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const ev = await insertEvent(db, f, { dayOffset: 5 })
      const r = await as(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: f.single,
          eventId: ev,
          amount: 12800,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      const { rows } = await db.query(
        "select id from public.entitlements where payment_id = $1",
        [r.payment_id]
      )
      expect(
        (
          await errorOf(db, f.admin, CORRECT, [
            rows[0].id,
            "units",
            "0",
            null,
            null,
            true,
            randomUUID(),
          ])
        ).message
      ).toBe("NOT_A_CARD")
      expect(
        (
          await errorOf(db, f.admin, CORRECT, [
            randomUUID(),
            "units",
            "0",
            null,
            null,
            true,
            randomUUID(),
          ])
        ).message
      ).toBe("NOT_FOUND")
    })
  })

  it("idempotent: the same key twice gives one correction and one notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      const key = randomUUID()
      const a = await correct(db, f, card, "units", 3, { key })
      const b = await correct(db, f, card, "units", 3, { key })
      expect(b).toEqual(a)
      const { rows } = await db.query(
        "select count(*)::int as n from public.entitlement_corrections where entitlement_id = $1",
        [card]
      )
      expect(rows[0].n).toBe(1)
      expect(
        (await notifications(db, f.customerA)).filter(
          (n) => n.type === "entitlement_units_changed"
        )
      ).toHaveLength(1)
    })
  })

  it("a customer calling any new admin RPC or preview: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await grantCard(db, f)
      for (const [text, params] of [
        [CORRECT, [card, "units", "1", null, null, true, randomUUID()]],
        [PREVIEW, [card, "units", "1"]],
        [GET, [card]],
        [HANDLED, [randomUUID()]],
        [SETTLE, [card, null, true, randomUUID()]],
        [PREVIEW_SETTLE, [card]],
      ] as const) {
        expect(
          await as(db, f.customerA, () => queryError(db, text, [...params])),
          text
        ).toMatchObject({ message: "NOT_AUTHORIZED" })
      }
      // The tables: admin select only.
      const rows = await as(db, f.customerA, async () => {
        const a = await db.query("select * from public.entitlement_corrections")
        const b = await db.query(
          "select * from public.entitlement_correction_bookings"
        )
        return a.rows.length + b.rows.length
      })
      expect(rows).toBe(0)
    })
  })

  it("every template, edited to use every allowed var, renders in the real flow", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      for (const type of [
        "entitlement_changed",
        "entitlement_units_changed",
        "entitlement_terms_changed",
      ]) {
        const { rows } = await db.query(
          "select allowed_vars from public.notification_templates where type = $1",
          [type]
        )
        expect(rows[0].allowed_vars).toEqual(["expires_on", "units"])
        await db.query(
          "update public.notification_templates set title = 'T {expires_on} {units}', body = 'B {units} {expires_on}' where type = $1",
          [type]
        )
      }
      const card = await grantCard(db, f)
      const before = await entitlement(db, card)
      await correct(
        db,
        f,
        card,
        "expires_on",
        await addDays(db, before.expires_on, 7)
      )
      await correct(db, f, card, "units", 2)
      await correct(db, f, card, "allowed_weekdays", [0])
      const notes = (await notifications(db, f.customerA)).filter((n) =>
        n.type.startsWith("entitlement_")
      )
      expect(notes.map((n) => n.type).sort()).toEqual([
        "entitlement_changed",
        "entitlement_terms_changed",
        "entitlement_units_changed",
      ])
      for (const n of notes) {
        expect(n.payload.title).toMatch(/^T \d\d\.\d\d \d+$/)
        expect(n.payload.body).toMatch(/^B \d+ \d\d\.\d\d$/)
      }
    })
  })
})

describe("admin_settle_parked_purchase", { timeout: 60_000 }, () => {
  // holder: who takes the only place (customer B unless given).
  async function parked(
    db: Db,
    f: Fixture,
    customer: string | null,
    holder: string = f.customerB
  ) {
    const ev = await insertEvent(db, f, { dayOffset: 5 })
    await db.query(
      "update public.events set capacity_adults = 1 where id = $1",
      [ev]
    )
    await grantCard(db, f, holder)
    await book(db, holder, ev)
    const { rows } = await db.query(
      `select private.approve_payment_core(
         'online', null, 'system', $5, $1, $2, 12800, null, $3::date,
         null, null, null, 'test_provider', $4, 'park') as id`,
      [f.single, ev, f.today, testName(`tx_${randomUUID()}`), customer]
    )
    const { rows: e } = await db.query(
      "select id from public.entitlements where payment_id = $1",
      [rows[0].id]
    )
    return { ev, payment: rows[0].id as string, entitlement: e[0].id as string }
  }

  it("the same key twice: one cancelled booking, one credit, one notification; a new key is NOT_PARKED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const p = await parked(db, f, f.customerA)
      await as(db, f.admin, () => db.query(CANCEL_EVENT, [p.ev, randomUUID()]))
      const key = randomUUID()
      const settle = (k: string) =>
        as(db, f.admin, async () => {
          const { rows } = await db.query(SETTLE, [
            p.entitlement,
            null,
            true,
            k,
          ])
          return rows[0].r
        })
      const a = await settle(key)
      expect(await settle(key)).toEqual(a)
      const { rows: b } = await db.query(
        "select count(*)::int as n from public.bookings where payment_id = $1",
        [p.payment]
      )
      expect(b[0].n).toBe(1)
      const { rows: c } = await db.query(
        "select count(*)::int as n from public.cancellation_credits where source_entitlement_id = $1",
        [p.entitlement]
      )
      expect(c[0].n).toBe(1)
      expect(
        (await notifications(db, f.customerA)).filter(
          (n) => n.type === "event_cancelled"
        )
      ).toHaveLength(1)
      expect(
        (
          await errorOf(db, f.admin, SETTLE, [
            p.entitlement,
            null,
            true,
            randomUUID(),
          ])
        ).message
      ).toBe("NOT_PARKED")
    })
  })

  it("she had a placed booking too: the cancel and the settle each send her event_cancelled", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // Customer A holds the only place and also paid without a place.
      const p = await parked(db, f, f.customerA, f.customerA)
      await as(db, f.admin, () => db.query(CANCEL_EVENT, [p.ev, randomUUID()]))
      const sent = async () =>
        (await notifications(db, f.customerA)).filter(
          (n) => n.type === "event_cancelled"
        ).length
      expect(await sent()).toBe(1)
      await as(db, f.admin, () =>
        db.query(SETTLE, [p.entitlement, null, true, randomUUID()])
      )
      expect(await sent()).toBe(2)
    })
  })

  it("not cancelled: NOT_PARKED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const p = await parked(db, f, f.customerA)
      expect(
        await as(db, f.admin, async () => {
          const { rows } = await db.query(PREVIEW_SETTLE, [p.entitlement])
          return rows[0].r
        })
      ).toEqual({ ok: false, code: "NOT_PARKED" })
      expect(
        (
          await errorOf(db, f.admin, SETTLE, [
            p.entitlement,
            null,
            true,
            randomUUID(),
          ])
        ).message
      ).toBe("NOT_PARKED")
    })
  })

  it("bound, in a cancelled session: a cancelled booking and a credit choice_pending; she gets event_cancelled; the parked item ends and the choice item starts", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const p = await parked(db, f, f.customerA)
      await as(db, f.admin, () => db.query(CANCEL_EVENT, [p.ev, randomUUID()]))
      expect(
        (await attention(db, f)).find((i) => i.id === p.entitlement)
      ).toMatchObject({ kind: "paid_without_place", event_status: "cancelled" })

      const plan = await as(db, f.admin, async () => {
        const { rows } = await db.query(PREVIEW_SETTLE, [p.entitlement])
        return rows[0].r
      })
      expect(plan).toMatchObject({
        ok: true,
        customer_id: f.customerA,
        event_id: p.ev,
        amount_agorot: 12800,
      })
      expect(
        (
          await errorOf(db, f.admin, SETTLE, [
            p.entitlement,
            null,
            false,
            randomUUID(),
          ])
        ).message
      ).toBe("CONFIRM_REQUIRED")

      const r = await as(db, f.admin, async () => {
        const { rows } = await db.query(SETTLE, [
          p.entitlement,
          testName("settle"),
          true,
          randomUUID(),
        ])
        return rows[0].r
      })
      const { rows: b } = await db.query(
        "select status, customer_id, payment_id from public.bookings where id = $1",
        [r.booking_id]
      )
      expect(b[0]).toEqual({
        status: "cancelled",
        customer_id: f.customerA,
        payment_id: p.payment,
      })
      const { rows: c } = await db.query(
        "select status, choice_pending, monetary_basis_agorot, customer_id from public.cancellation_credits where id = $1",
        [r.credit_id]
      )
      expect(c[0]).toEqual({
        status: "active",
        choice_pending: true,
        monetary_basis_agorot: 12800,
        customer_id: f.customerA,
      })
      expect(await entitlement(db, p.entitlement)).toMatchObject({
        available: 0,
        reserved: 0,
        used: 1,
      })
      expect(
        (await notifications(db, f.customerA)).filter(
          (n) => n.type === "event_cancelled"
        )
      ).toHaveLength(1)
      const items = await attention(db, f)
      expect(items.find((i) => i.id === p.entitlement)).toBeUndefined()
      expect(items.find((i) => i.id === r.credit_id)).toMatchObject({
        kind: "choice_pending",
      })
      // She chooses, as after a business cancel (3.8).
      const chosen = await as(db, f.customerA, async () => {
        const { rows } = await db.query(
          "select public.choose_credit_outcome($1, 'credit', $2) as r",
          [r.credit_id, randomUUID()]
        )
        return rows[0].r
      })
      expect(chosen).toBeTruthy()
    })
  })

  it("unbound: settled without a notification; the bind moves the credit and sends event_cancelled", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const p = await parked(db, f, null)
      await as(db, f.admin, () => db.query(CANCEL_EVENT, [p.ev, randomUUID()]))
      const r = await as(db, f.admin, async () => {
        const { rows } = await db.query(SETTLE, [
          p.entitlement,
          null,
          true,
          randomUUID(),
        ])
        return rows[0].r
      })
      const fresh = randomUUID()
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
        [fresh, testName("fresh")]
      )
      await db.query("select private.bind_purchase($1, $2)", [p.payment, fresh])
      const { rows: c } = await db.query(
        "select customer_id, choice_pending from public.cancellation_credits where id = $1",
        [r.credit_id]
      )
      expect(c[0]).toEqual({ customer_id: fresh, choice_pending: true })
      expect(
        (await notifications(db, fresh)).filter(
          (n) => n.type === "event_cancelled"
        )
      ).toHaveLength(1)
    })
  })
})
