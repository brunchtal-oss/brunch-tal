// Story 3.16: Tal changes a credit's alternatives (also how she extends it)
// or replaces it with a refund request. admin_change_credit_options and
// admin_refund_credit with their plans and previews,
// admin_list_credit_candidates, the refresh rule for options Tal added
// (private.refresh_credit_options), and the reads admin_list_customer_
// credits and admin_get_customer. One test per row of the spec's I/O matrix
// (the "all vars" row is in settings-and-templates.test.ts). Everything
// runs in inRollback, with the settings set inside the transaction and
// every other published session moved to draft there, so the "next
// sessions" are only this test's.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { asAuthenticated, inRollback, testName, type Db } from "./support/db"
import {
  approve,
  DEFAULT_PAYER,
  seedMoney,
  type MoneyFixture,
} from "./support/money"

const CHANGE =
  "select public.admin_change_credit_options($1, $2::uuid[], $3, $4, $5) as r"
const PREVIEW_CHANGE =
  "select public.preview_admin_change_credit_options($1, $2::uuid[]) as r"
const REFUND = "select public.admin_refund_credit($1, $2, $3, $4) as r"
const PREVIEW_REFUND = "select public.preview_admin_refund_credit($1) as r"
const CANDIDATES = "select public.admin_list_credit_candidates($1) as r"
const CUSTOMER_CREDITS = "select public.admin_list_customer_credits($1) as r"
const GET_CUSTOMER = "select public.admin_get_customer($1) as r"
const REFUND_LIST = "select public.admin_list_refund_requests() as r"
const ATTENTION = "select public.admin_get_attention_items() as r"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2, $3) as r"
const MOVE = "select public.move_booking($1, $2, $3) as r"
const MY_CREDITS = "select public.get_my_credits() as r"
const CANCEL_EVENT = "select public.admin_cancel_event($1, $2, $3, $4) as r"
const ADMIN_CANCEL =
  "select public.admin_cancel_booking($1, $2, $3, $4, $5) as r"
const PREVIEW_MOVE = "select public.preview_move_booking($1) as r"

type Fixture = MoneyFixture & {
  single: string
  mothers: string
  grandma: string
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         credit_options_count = 2`
  )
  // Only this test's sessions count as "the next sessions".
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 18000, 1, 'session', null, null, 'regular', 1)
     returning id`,
    [testName("single")]
  )
  const { rows: concepts } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  const byTheme = Object.fromEntries(concepts.map((c) => [c.theme_key, c.id]))
  return {
    ...f,
    single: rows[0].id,
    mothers: byTheme.mothers,
    grandma: byTheme.grandma,
  }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

// A published session `dayOffset` days from today at 10:00 Jerusalem time,
// open until it starts.
async function insertEvent(
  db: Db,
  f: Fixture,
  dayOffset: number,
  options: { capacity?: number; kind?: "regular" | "couple" } = {}
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $2, s.t, s.t + interval '2 hours', $3, s.t, true, 'published'
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + $4::int)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [
      options.kind === "couple" ? f.grandma : f.mothers,
      options.kind ?? "regular",
      options.capacity ?? 12,
      dayOffset,
    ]
  )
  return rows[0].id
}

// Customer A's pinned single on the session: its booking and payment.
async function pinned(db: Db, f: Fixture, eventId: string) {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId: f.customerA,
      productId: f.single,
      eventId,
      amount: 18000,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  const { rows } = await db.query(
    "select id from public.bookings where payment_id = $1",
    [r.payment_id]
  )
  return { booking: rows[0].id as string, payment: r.payment_id as string }
}

// A credit of customer A from her pinned single on `origin`, cancelled by
// her with "credit" (its options: the next two sessions after it).
async function creditOn(db: Db, f: Fixture, origin: string) {
  const p = await pinned(db, f, origin)
  const r = await as(db, f.customerA, async () => {
    const { rows } = await db.query(CANCEL, [p.booking, randomUUID(), "credit"])
    return rows[0].r
  })
  return { creditId: r.credit_id as string, ...p }
}

// Every option in date order: [event_id, state, replaced_reason, added_by].
async function options(db: Db, creditId: string) {
  const { rows } = await db.query(
    `select o.event_id, o.state, o.replaced_reason, o.added_by
     from public.credit_options o
     join public.events e on e.id = o.event_id
     where o.credit_id = $1
     order by e.starts_at, e.id`,
    [creditId]
  )
  return rows.map((r) => [r.event_id, r.state, r.replaced_reason, r.added_by])
}

async function credit(db: Db, creditId: string) {
  const { rows } = await db.query(
    `select status, choice_pending, options_count, monetary_basis_agorot
     from public.cancellation_credits where id = $1`,
    [creditId]
  )
  return rows[0]
}

async function change(
  db: Db,
  f: Fixture,
  creditId: string,
  eventIds: string[],
  input: { reason?: string | null; confirmed?: boolean; key?: string } = {}
) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(CHANGE, [
      creditId,
      eventIds,
      input.reason ?? null,
      input.confirmed ?? true,
      input.key ?? randomUUID(),
    ])
    return rows[0].r
  })
}

async function refund(
  db: Db,
  f: Fixture,
  creditId: string,
  input: { reason?: string | null; confirmed?: boolean; key?: string } = {}
) {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(REFUND, [
      creditId,
      input.reason ?? null,
      input.confirmed ?? true,
      input.key ?? randomUUID(),
    ])
    return rows[0].r
  })
}

// The refusal of a statement as `user`: its code and detail.field, or null.
async function failure(
  db: Db,
  user: string,
  text: string,
  params: unknown[]
): Promise<{ message: string; field: string | null } | null> {
  await asAuthenticated(db, user)
  await db.query("savepoint failure")
  try {
    await db.query(text, params)
    await db.query("release savepoint failure")
    return null
  } catch (error) {
    await db.query("rollback to savepoint failure")
    const { message, detail } = error as { message: string; detail?: string }
    return {
      message,
      field: detail
        ? ((JSON.parse(detail) as { field?: string }).field ?? null)
        : null,
    }
  } finally {
    await db.query("reset role")
  }
}

async function adminRead(db: Db, f: Fixture, text: string, params: unknown[]) {
  return as(db, f.admin, async () => (await db.query(text, params)).rows[0].r)
}

async function myCredits(db: Db, customer: string) {
  return as(db, customer, async () => (await db.query(MY_CREDITS)).rows[0].r)
}

async function notices(db: Db, customer: string, type: string) {
  const { rows } = await db.query(
    `select n.payload ->> 'title' as title, n.payload ->> 'body' as body,
       n.target_path, n.dedupe_key,
       (select count(*)::int from public.notification_jobs j
        where j.notification_id = n.id) as jobs
     from public.notifications n
     where n.recipient_id = $1 and n.type = $2
     order by n.created_at, n.id`,
    [customer, type]
  )
  return rows
}

async function auditRows(db: Db, action: string, creditId: string) {
  const { rows } = await db.query(
    `select id, entity_type, entity_id, customer_id, event_id, before, after,
       reason
     from public.audit_log
     where action = $1
       and (entity_id = $2 or entity_id in (
         select r.id from public.refund_requests r where r.credit_id = $2))
     order by entity_type`,
    [action, creditId]
  )
  return rows
}

async function dayMonthOf(db: Db, eventId: string): Promise<string> {
  const { rows } = await db.query(
    "select to_char(starts_at at time zone 'Asia/Jerusalem', 'DD.MM') as d from public.events where id = $1",
    [eventId]
  )
  return rows[0].d
}

describe("admin_change_credit_options", { timeout: 60_000 }, () => {
  it("change: A, B -> C, D; A and B replaced (admin), C and D active (admin), count 2, one audit row, one notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const d = await insertEvent(db, f, 10)
      const { creditId } = await creditOn(db, f, origin)
      expect(await options(db, creditId)).toEqual([
        [a, "active", null, "system"],
        [b, "active", null, "system"],
      ])

      const plan = await adminRead(db, f, PREVIEW_CHANGE, [creditId, [d, c]])
      expect(plan).toMatchObject({
        ok: true,
        credit_id: creditId,
        customer_id: f.customerA,
        customer_label: testName("money_a"),
        origin_starts_at: expect.any(String),
        before: [{ event_id: a }, { event_id: b }],
        after: [{ event_id: c }, { event_id: d }],
      })

      const r = await change(db, f, creditId, [c, d], { reason: " ביקשה " })
      expect(r).toEqual({ credit_id: creditId, options_count: 2 })
      expect(await options(db, creditId)).toEqual([
        [a, "replaced", "admin", "system"],
        [b, "replaced", "admin", "system"],
        [c, "active", null, "admin"],
        [d, "active", null, "admin"],
      ])
      expect((await credit(db, creditId)).options_count).toBe(2)

      const audit = await auditRows(db, "admin_change_credit_options", creditId)
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        entity_type: "cancellation_credits",
        customer_id: f.customerA,
        event_id: origin,
        reason: "ביקשה",
        before: {
          options: [
            { event_id: a, starts_at: expect.any(String) },
            { event_id: b, starts_at: expect.any(String) },
          ],
        },
        after: {
          options: [
            { event_id: c, starts_at: expect.any(String) },
            { event_id: d, starts_at: expect.any(String) },
          ],
        },
      })

      const sent = await notices(db, f.customerA, "credit_options_changed")
      expect(sent).toEqual([
        {
          title: "עדכון בזיכוי שלך",
          body: `המפגשים שאפשר להירשם אליהם עם הזיכוי מ־${await dayMonthOf(db, origin)} עודכנו. הפרטים באזור האישי`,
          target_path: "/me/bookings",
          dedupe_key: `credit_options_changed:${f.customerA}:${audit[0].id}`,
          jobs: 1,
        },
      ])

      // "ההרשמות שלי": only the new alternatives.
      const [mine] = await myCredits(db, f.customerA)
      expect(mine.options.map((o: { event_id: string }) => o.event_id)).toEqual(
        [c, d]
      )
    })
  })

  it("no checkbox: CONFIRM_REQUIRED and nothing changes (both actions)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)

      expect(
        await failure(db, f.admin, CHANGE, [
          creditId,
          [c],
          null,
          false,
          randomUUID(),
        ])
      ).toEqual({ message: "CONFIRM_REQUIRED", field: null })
      expect(
        await failure(db, f.admin, REFUND, [
          creditId,
          null,
          false,
          randomUUID(),
        ])
      ).toEqual({ message: "CONFIRM_REQUIRED", field: null })
      expect(await options(db, creditId)).toEqual([
        [a, "active", null, "system"],
        [b, "active", null, "system"],
      ])
      expect(await credit(db, creditId)).toMatchObject({
        status: "active",
        options_count: 2,
      })
      expect(await notices(db, f.customerA, "credit_options_changed")).toEqual(
        []
      )
    })
  })

  it("she books a new alternative: it is funded by the credit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)
      await change(db, f, creditId, [c])

      const booked = await as(db, f.customerA, async () => {
        const { rows } = await db.query(BOOK, [c, randomUUID()])
        return rows[0].r
      })
      const { rows } = await db.query(
        "select credit_id, entitlement_id from public.booking_allocations where booking_id = $1",
        [booked.booking_id]
      )
      expect(rows).toEqual([{ credit_id: creditId, entitlement_id: null }])
      expect((await options(db, creditId)).find((o) => o[0] === c)).toEqual([
        c,
        "used",
        null,
        "admin",
      ])
    })
  })

  it("a removed alternative stays out after a refresh, even with room; the count never tops up to N", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      await insertEvent(db, f, 8)
      const { creditId } = await creditOn(db, f, origin)
      await change(db, f, creditId, [b])

      await myCredits(db, f.customerA)
      await db.query("select private.refresh_credit_options($1)", [creditId])
      expect(await options(db, creditId)).toEqual([
        [a, "replaced", "admin", "system"],
        [b, "active", null, "system"],
      ])
      expect((await credit(db, creditId)).options_count).toBe(1)
    })
  })

  it("an early pick (before the cancelled session) stays active after a refresh, and she can book it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const early = await insertEvent(db, f, 3)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const { creditId } = await creditOn(db, f, origin)
      await change(db, f, creditId, [early])

      await myCredits(db, f.customerA)
      expect(await options(db, creditId)).toContainEqual([
        early,
        "active",
        null,
        "admin",
      ])
      const booked = await as(db, f.customerA, async () => {
        const { rows } = await db.query(BOOK, [early, randomUUID()])
        return rows[0].r
      })
      const { rows } = await db.query(
        "select credit_id from public.booking_allocations where booking_id = $1",
        [booked.booking_id]
      )
      expect(rows).toEqual([{ credit_id: creditId }])
    })
  })

  it("a picked alternative that fills is replaced by the next matching session", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9, { capacity: 1 })
      const next = await insertEvent(db, f, 11)
      const { creditId } = await creditOn(db, f, origin)
      await change(db, f, creditId, [c])

      // Customer B takes the last place with a card.
      await as(db, f.admin, () =>
        approve(db, {
          customerId: f.customerB,
          productId: f.card,
          amount: 47200,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      await as(db, f.customerB, () => db.query(BOOK, [c, randomUUID()]))
      await myCredits(db, f.customerA)

      const all = await options(db, creditId)
      expect(all).toContainEqual([c, "replaced", "full", "admin"])
      // The fill takes the first matching session after the origin that was
      // never an option: removed ones (6, 7) stay out.
      expect(all.filter((o) => o[1] === "active")).toEqual([
        [next, "active", null, "system"],
      ])
    })
  })

  it("a couple session, the origin, none, 11, a repeated or a missing one: INVALID_INPUT (events), nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const couple = await insertEvent(db, f, 9, { kind: "couple" })
      const { creditId } = await creditOn(db, f, origin)
      const many = await Promise.all(
        Array.from({ length: 11 }, (_, n) => insertEvent(db, f, 12 + n))
      )

      for (const eventIds of [
        [couple],
        [origin],
        [],
        many,
        [a, a],
        [randomUUID()],
      ]) {
        expect(
          await failure(db, f.admin, CHANGE, [
            creditId,
            eventIds,
            null,
            true,
            randomUUID(),
          ]),
          JSON.stringify(eventIds)
        ).toEqual({ message: "INVALID_INPUT", field: "events" })
      }
      expect(await options(db, creditId)).toEqual([
        [a, "active", null, "system"],
        [b, "active", null, "system"],
      ])
    })
  })

  it("a full session is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const full = await insertEvent(db, f, 9, { capacity: 1 })
      await as(db, f.admin, () =>
        approve(db, {
          customerId: f.customerB,
          productId: f.card,
          amount: 47200,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      await as(db, f.customerB, () => db.query(BOOK, [full, randomUUID()]))
      const { creditId } = await creditOn(db, f, origin)
      expect(
        await failure(db, f.admin, CHANGE, [
          creditId,
          [full],
          null,
          true,
          randomUUID(),
        ])
      ).toEqual({ message: "INVALID_INPUT", field: "events" })
    })
  })

  it("the same set as now: NO_CHANGE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const { creditId } = await creditOn(db, f, origin)
      expect(
        await adminRead(db, f, PREVIEW_CHANGE, [creditId, [b, a]])
      ).toEqual({ ok: false, code: "NO_CHANGE" })
      expect(
        await failure(db, f.admin, CHANGE, [
          creditId,
          [b, a],
          null,
          true,
          randomUUID(),
        ])
      ).toEqual({ message: "NO_CHANGE", field: null })
    })
  })

  it("extend an exhausted credit: every option passed, Tal picks E; count = passed + 1 and she books E", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const { creditId } = await creditOn(db, f, origin)
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 minute' where id = any($1::uuid[])",
        [[a, b]]
      )
      const [before] = await myCredits(db, f.customerA)
      expect(before).toMatchObject({ exhausted: true })
      const [listed] = await adminRead(db, f, CUSTOMER_CREDITS, [f.customerA])
      expect(listed).toMatchObject({ exhausted: true, in_use: false })

      const e = await insertEvent(db, f, 12)
      const r = await change(db, f, creditId, [e])
      expect(r.options_count).toBe(3)
      expect(await options(db, creditId)).toEqual([
        [a, "passed", null, "system"],
        [b, "passed", null, "system"],
        [e, "active", null, "admin"],
      ])
      const [after] = await myCredits(db, f.customerA)
      expect(after).toMatchObject({ exhausted: false, waiting: false })

      const booked = await as(db, f.customerA, async () => {
        const { rows } = await db.query(BOOK, [e, randomUUID()])
        return rows[0].r
      })
      const { rows } = await db.query(
        "select credit_id from public.booking_allocations where booking_id = $1",
        [booked.booking_id]
      )
      expect(rows).toEqual([{ credit_id: creditId }])
    })
  })

  it("in use: a credit that funds a confirmed booking cannot be changed or refunded (CREDIT_IN_USE)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)
      const booked = await as(db, f.customerA, async () => {
        const { rows } = await db.query(BOOK, [a, randomUUID()])
        return rows[0].r.booking_id as string
      })

      expect(
        await failure(db, f.admin, CHANGE, [
          creditId,
          [c],
          null,
          true,
          randomUUID(),
        ])
      ).toEqual({ message: "CREDIT_IN_USE", field: null })
      expect(
        await failure(db, f.admin, REFUND, [creditId, null, true, randomUUID()])
      ).toEqual({ message: "CREDIT_IN_USE", field: null })
      const [listed] = await adminRead(db, f, CUSTOMER_CREDITS, [f.customerA])
      expect(listed).toMatchObject({
        in_use: true,
        exhausted: false,
        in_use_booking: {
          booking_id: booked,
          event_id: a,
          starts_at: expect.any(String),
          concept_name: expect.any(String),
        },
      })
    })
  })

  it("a credit waiting for her choice: change is CREDIT_CHOICE_PENDING; a refund closes the choice", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const p = await pinned(db, f, origin)
      await as(db, f.admin, () =>
        db.query(CANCEL_EVENT, [origin, true, "בוטל", randomUUID()])
      )
      const { rows } = await db.query(
        "select id from public.cancellation_credits where origin_booking_id = $1",
        [p.booking]
      )
      const creditId = rows[0].id as string
      expect(await credit(db, creditId)).toMatchObject({ choice_pending: true })

      expect(
        await failure(db, f.admin, CHANGE, [
          creditId,
          [c],
          null,
          true,
          randomUUID(),
        ])
      ).toEqual({ message: "CREDIT_CHOICE_PENDING", field: null })

      expect(await adminRead(db, f, PREVIEW_REFUND, [creditId])).toMatchObject({
        ok: true,
        amount_agorot: 18000,
        choice_pending: true,
      })
      await refund(db, f, creditId)
      expect(await credit(db, creditId)).toMatchObject({
        status: "refund_requested",
        choice_pending: false,
      })
      const items = await adminRead(db, f, ATTENTION, [])
      expect(
        items.filter(
          (i: { kind: string; id: string }) =>
            i.kind === "choice_pending" && i.id === creditId
        )
      ).toEqual([])
      const [mine] = await myCredits(db, f.customerA)
      expect(mine).toMatchObject({
        choice_pending: false,
        status: "refund_requested",
      })
    })
  })
})

describe("admin_refund_credit", { timeout: 60_000 }, () => {
  it("refund: the credit refund_requested, a request of its basis in payments and in לטיפול, audited, one notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const { creditId, booking, payment } = await creditOn(db, f, origin)

      expect(await adminRead(db, f, PREVIEW_REFUND, [creditId])).toEqual({
        ok: true,
        credit_id: creditId,
        customer_id: f.customerA,
        customer_label: testName("money_a"),
        concept_name: expect.any(String),
        origin_starts_at: expect.any(String),
        amount_agorot: 18000,
        choice_pending: false,
      })
      const r = await refund(db, f, creditId, { reason: "ביקשה כסף" })
      expect(r).toEqual({
        credit_id: creditId,
        refund_request_id: expect.any(String),
        amount_agorot: 18000,
      })
      expect(await credit(db, creditId)).toMatchObject({
        status: "refund_requested",
        choice_pending: false,
      })
      const { rows: requests } = await db.query(
        `select customer_id, payment_id, booking_id, amount_agorot, status
         from public.refund_requests where credit_id = $1`,
        [creditId]
      )
      expect(requests).toEqual([
        {
          customer_id: f.customerA,
          payment_id: payment,
          booking_id: booking,
          amount_agorot: 18000,
          status: "requested",
        },
      ])
      // Its options are left as they were.
      expect(await options(db, creditId)).toEqual([
        [a, "active", null, "system"],
        [b, "active", null, "system"],
      ])

      const listed = await adminRead(db, f, REFUND_LIST, [])
      expect(
        listed.filter(
          (x: { refund_request_id: string }) =>
            x.refund_request_id === r.refund_request_id
        )
      ).toEqual([
        expect.objectContaining({ status: "requested", amount_agorot: 18000 }),
      ])
      const items = await adminRead(db, f, ATTENTION, [])
      expect(
        items.filter(
          (i: { kind: string; id: string }) =>
            i.kind === "refund_requested" && i.id === r.refund_request_id
        )
      ).toEqual([
        expect.objectContaining({
          customer_id: f.customerA,
          amount_agorot: 18000,
          event_id: origin,
        }),
      ])

      const audit = await auditRows(db, "admin_refund_credit", creditId)
      expect(audit.map((x) => x.entity_type)).toEqual([
        "cancellation_credits",
        "refund_requests",
      ])
      expect(audit[0]).toMatchObject({
        customer_id: f.customerA,
        event_id: origin,
        reason: "ביקשה כסף",
        before: { status: "active" },
        after: { status: "refund_requested" },
      })
      expect(audit[1].after).toMatchObject({ amount_agorot: 18000 })

      expect(await notices(db, f.customerA, "credit_refund_requested")).toEqual(
        [
          {
            title: "בקשת ההחזר התקבלה",
            body: `במקום הזיכוי מ־${await dayMonthOf(db, origin)} יוחזרו לך 180 ₪. נעדכן אותך כשההחזר יבוצע`,
            target_path: "/me/bookings",
            dedupe_key: `credit_refund_requested:${f.customerA}:${audit[0].id}`,
            jobs: 1,
          },
        ]
      )
    })
  })

  it("twice: CREDIT_NOT_ACTIVE, one request", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      const { creditId } = await creditOn(db, f, origin)
      await refund(db, f, creditId)
      expect(
        await failure(db, f.admin, REFUND, [creditId, null, true, randomUUID()])
      ).toEqual({ message: "CREDIT_NOT_ACTIVE", field: null })
      expect(
        await failure(db, f.admin, CHANGE, [
          creditId,
          [origin],
          null,
          true,
          randomUUID(),
        ])
      ).toEqual({ message: "CREDIT_NOT_ACTIVE", field: null })
      const { rows } = await db.query(
        "select count(*)::int as n from public.refund_requests where credit_id = $1",
        [creditId]
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("after a move: the credit of a moved then cancelled booking can be refunded", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const target = await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const p = await pinned(db, f, origin)
      const moved = await as(db, f.customerA, async () => {
        const { rows } = await db.query(MOVE, [p.booking, target, randomUUID()])
        return rows[0].r
      })
      const cancelled = await as(db, f.customerA, async () => {
        const { rows } = await db.query(CANCEL, [
          moved.booking_id,
          randomUUID(),
          null,
        ])
        return rows[0].r
      })
      expect(cancelled).toMatchObject({ outcome: "credit" })
      const creditId = cancelled.credit_id as string
      // The cancelled booking the credit points to: the moved one (the
      // credit's allocation), before its origin booking.
      const { rows: expected } = await db.query(
        "select private.credit_cancelled_booking($1) as id",
        [creditId]
      )
      expect(expected[0].id).toBe(moved.booking_id)

      const r = await refund(db, f, creditId)
      expect(r.amount_agorot).toBe(18000)
      const { rows } = await db.query(
        "select booking_id from public.refund_requests where id = $1",
        [r.refund_request_id]
      )
      expect(rows[0].booking_id).toBe(moved.booking_id)
      expect(await credit(db, creditId)).toMatchObject({
        status: "refund_requested",
      })
    })
  })
})

describe("both actions", { timeout: 60_000 }, () => {
  it("the same key twice: one change, one refund, one notification each", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)

      const key = randomUUID()
      const first = await change(db, f, creditId, [c], { key })
      const second = await change(db, f, creditId, [c], { key })
      expect(second).toEqual(first)
      expect(
        await notices(db, f.customerA, "credit_options_changed")
      ).toHaveLength(1)
      expect(
        await auditRows(db, "admin_change_credit_options", creditId)
      ).toHaveLength(1)

      const refundKey = randomUUID()
      const r1 = await refund(db, f, creditId, { key: refundKey })
      const r2 = await refund(db, f, creditId, { key: refundKey })
      expect(r2).toEqual(r1)
      expect(
        await notices(db, f.customerA, "credit_refund_requested")
      ).toHaveLength(1)
    })
  })

  it("a customer on any admin RPC or preview: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      const c = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)
      for (const [text, params] of [
        [CHANGE, [creditId, [c], null, true, randomUUID()]],
        [PREVIEW_CHANGE, [creditId, [c]]],
        [REFUND, [creditId, null, true, randomUUID()]],
        [PREVIEW_REFUND, [creditId]],
        [CANDIDATES, [creditId]],
      ] as const) {
        expect(await failure(db, f.customerA, text, [...params]), text).toEqual(
          { message: "NOT_AUTHORIZED", field: null }
        )
      }
      expect((await credit(db, creditId)).status).toBe("active")
    })
  })
})

describe("the reads", { timeout: 60_000 }, () => {
  it("candidates: matching sessions with is_option; not the origin, another kind, a full one or one she is booked to", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const early = await insertEvent(db, f, 3)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const couple = await insertEvent(db, f, 8, { kind: "couple" })
      const booked = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)
      await as(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: f.card,
          amount: 47200,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      await as(db, f.customerA, () => db.query(BOOK, [booked, randomUUID()]))

      const list = await adminRead(db, f, CANDIDATES, [creditId])
      expect(
        list.map((x: { event_id: string; is_option: boolean }) => [
          x.event_id,
          x.is_option,
        ])
      ).toEqual([
        [early, false],
        [a, true],
        [b, true],
      ])
      expect(list.map((x: { event_id: string }) => x.event_id)).not.toContain(
        couple
      )
    })
  })

  it("admin_list_customer_credits: options with state and added_by, options_count, in_use, exhausted", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)
      await change(db, f, creditId, [c])
      const [listed] = await adminRead(db, f, CUSTOMER_CREDITS, [f.customerA])
      expect(listed).toMatchObject({
        credit_id: creditId,
        options_count: 1,
        in_use: false,
        exhausted: false,
        in_use_booking: null,
        options: [
          {
            event_id: c,
            starts_at: expect.any(String),
            concept_name: expect.any(String),
            state: "active",
            added_by: "admin",
          },
        ],
      })
    })
  })

  it("admin_get_customer: a cancelled booking carries its credit_id; others null", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const { creditId, booking } = await creditOn(db, f, origin)
      const onCredit = await as(db, f.customerA, async () => {
        const { rows } = await db.query(BOOK, [a, randomUUID()])
        return rows[0].r.booking_id as string
      })
      const card = await adminRead(db, f, GET_CUSTOMER, [f.customerA])
      const byId = Object.fromEntries(
        card.bookings.map((b: { booking_id: string; credit_id: string }) => [
          b.booking_id,
          b.credit_id,
        ])
      )
      expect(byId[booking]).toBe(creditId)
      // Funded by the credit (the history links only a cancelled one).
      expect(byId[onCredit]).toBe(creditId)
    })
  })
})

describe("review fixes", { timeout: 60_000 }, () => {
  it("a stale option (registration closed, not refreshed yet) is passed, not replaced (admin), and counts", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 minute' where id = $1",
        [a]
      )

      const r = await change(db, f, creditId, [b, c])
      expect(r.options_count).toBe(3)
      expect(await options(db, creditId)).toEqual([
        [a, "passed", null, "system"],
        [b, "active", null, "system"],
        [c, "active", null, "admin"],
      ])
      const [audit] = await auditRows(
        db,
        "admin_change_credit_options",
        creditId
      )
      expect(audit.before.options).toEqual([
        { event_id: b, starts_at: expect.any(String) },
      ])
    })
  })

  it("an early pick E and a later C: booked on C, she moves to E (preview lists it) and stays on the credit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const early = await insertEvent(db, f, 3)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)
      await change(db, f, creditId, [early, c])

      const booked = await as(db, f.customerA, async () => {
        const { rows } = await db.query(BOOK, [c, randomUUID()])
        return rows[0].r.booking_id as string
      })
      const preview = await as(
        db,
        f.customerA,
        async () => (await db.query(PREVIEW_MOVE, [booked])).rows[0].r
      )
      expect(preview).toMatchObject({ ok: true, funding: "credit" })
      expect(
        preview.targets.map((t: { event_id: string }) => t.event_id)
      ).toContain(early)

      const moved = await as(db, f.customerA, async () => {
        const { rows } = await db.query(MOVE, [booked, early, randomUUID()])
        return rows[0].r
      })
      const { rows } = await db.query(
        "select credit_id, entitlement_id from public.booking_allocations where booking_id = $1",
        [moved.booking_id]
      )
      expect(rows).toEqual([{ credit_id: creditId, entitlement_id: null }])
    })
  })

  it("a reason of 2001 characters: INVALID_INPUT (reason) on both, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const { creditId } = await creditOn(db, f, origin)
      const long = "x".repeat(2001)

      expect(
        await failure(db, f.admin, CHANGE, [
          creditId,
          [c],
          long,
          true,
          randomUUID(),
        ])
      ).toEqual({ message: "INVALID_INPUT", field: "reason" })
      expect(
        await failure(db, f.admin, REFUND, [creditId, long, true, randomUUID()])
      ).toEqual({ message: "INVALID_INPUT", field: "reason" })
      expect(await options(db, creditId)).toEqual([
        [a, "active", null, "system"],
        [b, "active", null, "system"],
      ])
      expect(await credit(db, creditId)).toMatchObject({
        status: "active",
        options_count: 2,
      })
    })
  })

  it("re-picking a session Tal removed: the same row is active again (admin), counted once", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      const a = await insertEvent(db, f, 6)
      const b = await insertEvent(db, f, 7)
      const { creditId } = await creditOn(db, f, origin)
      await change(db, f, creditId, [b])
      expect(await options(db, creditId)).toEqual([
        [a, "replaced", "admin", "system"],
        [b, "active", null, "system"],
      ])

      const r = await change(db, f, creditId, [a, b])
      expect(r.options_count).toBe(2)
      expect(await options(db, creditId)).toEqual([
        [a, "active", null, "admin"],
        [b, "active", null, "system"],
      ])
      const { rows } = await db.query(
        `select count(*)::int as n, bool_and(replaced_at is null) as cleared
         from public.credit_options where credit_id = $1 and event_id = $2`,
        [creditId, a]
      )
      expect(rows[0]).toEqual({ n: 1, cleared: true })
    })
  })

  it("an unbound credit: change and refund succeed, no notification, the payer label", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const origin = await insertEvent(db, f, 5)
      await insertEvent(db, f, 6)
      await insertEvent(db, f, 7)
      const c = await insertEvent(db, f, 9)
      const approved = await as(db, f.admin, () =>
        approve(db, {
          customerId: null,
          productId: f.single,
          eventId: origin,
          amount: 18000,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      const { rows: seat } = await db.query(
        "select id from public.bookings where payment_id = $1",
        [approved.payment_id]
      )
      const cancelled = await adminRead(db, f, ADMIN_CANCEL, [
        seat[0].id,
        true,
        randomUUID(),
        null,
        "credit",
      ])
      const creditId = cancelled.credit_id as string
      const { rows: before } = await db.query(
        "select count(*)::int as n from public.notifications"
      )

      expect(
        await adminRead(db, f, PREVIEW_CHANGE, [creditId, [c]])
      ).toMatchObject({
        ok: true,
        customer_id: null,
        customer_label: DEFAULT_PAYER,
      })
      expect(await adminRead(db, f, PREVIEW_REFUND, [creditId])).toMatchObject({
        ok: true,
        customer_label: DEFAULT_PAYER,
      })
      await change(db, f, creditId, [c])
      const r = await refund(db, f, creditId)
      const { rows: request } = await db.query(
        "select customer_id from public.refund_requests where id = $1",
        [r.refund_request_id]
      )
      expect(request).toEqual([{ customer_id: null }])
      const { rows: after } = await db.query(
        "select count(*)::int as n from public.notifications"
      )
      expect(after[0].n).toBe(before[0].n)
    })
  })

  it("a missing credit: NOT_FOUND from both previews and from the candidates", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await insertEvent(db, f, 9)
      const missing = randomUUID()
      expect(await adminRead(db, f, PREVIEW_CHANGE, [missing, [c]])).toEqual({
        ok: false,
        code: "NOT_FOUND",
      })
      expect(await adminRead(db, f, PREVIEW_REFUND, [missing])).toEqual({
        ok: false,
        code: "NOT_FOUND",
      })
      expect(await failure(db, f.admin, CANDIDATES, [missing])).toEqual({
        message: "NOT_FOUND",
        field: null,
      })
    })
  })
})
