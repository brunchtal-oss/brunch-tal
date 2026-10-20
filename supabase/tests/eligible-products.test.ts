// Story 3.18: eligible products per session (public.event_products and
// private.event_accepts_product). One test per row of the spec's I/O
// matrix, plus the 3.19 manual-booking list and the audit rows. Everything
// runs in inRollback, with every other published session moved to draft
// there, so the open sessions are only this test's. The cards come from
// admin_approve_payment, so their eligibility_snapshot carries product_id
// as in production. Many round trips: 60 seconds per test.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import {
  APPROVE,
  approve,
  approveParams,
  insertProduct,
  seedMoney,
  type MoneyFixture,
} from "./support/money"

const PREVIEW = "select public.preview_book_session($1) as r"
const BOOK = "select public.book_session($1, $2) as r"
const ADMIN_BOOK = "select public.admin_book_customer($1, $2, $3) as r"
const CUSTOMER_LIST =
  "select public.admin_list_customer_bookable_events($1) as r"
const BOOKABLE = "select public.admin_list_bookable_events() as r"
const UPDATE = "select public.admin_update_event($1, $2::jsonb, $3) as r"
const CREATE = "select public.admin_create_event($1::jsonb, $2) as r"
const DUPLICATE =
  "select public.admin_duplicate_event($1, $2::date, $3::time, $4::time, $5) as r"
const MOVE = "select public.move_booking($1, $2, $3) as r"
const ADMIN_MOVE =
  "select public.admin_move_booking($1, $2, true, $3, null) as r"
const CANDIDATES = "select private.move_option_candidates($1) as ids"
const JOB = "select private.job_auto_extend($1::date, $2::uuid[]) as n"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & {
  holiday: string
  couple: string
  pinned: string
  concept: string
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         credit_options_count = 1`
  )
  // Only this test's sessions are open.
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
  const { rows: concepts } = await db.query<{ id: string }>(
    "select id from public.concepts where archived_at is null and default_kind = 'regular' order by name limit 1"
  )
  const holiday = await insertProduct(db, { label: "holiday" })
  const { rows: couple } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'couple', 25000, 1, 'session', null, null, 'couple', 2)
     returning id`,
    [testName("couple")]
  )
  const { rows: pinned } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1)
     returning id`,
    [testName("pinned")]
  )
  return {
    ...f,
    holiday,
    couple: couple[0].id,
    pinned: pinned[0].id,
    concept: concepts[0].id,
  }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// As the admin: a card of `productId` (the fixture's card by default) for
// customerA, approved today (valid from today, 49 days).
async function card(
  db: Db,
  f: Fixture,
  productId: string = f.card,
  customerId: string = f.customerA
): Promise<string> {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId,
      productId,
      amount: 47200,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  return rows[0].id
}

// As the owner: a regular 2-hour session at 10:00 local on today +
// dayOffset, closing at its start; or on a fixed local `day`.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: { dayOffset?: number; day?: string; status?: string } = {}
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true, $2
     from (
       select (coalesce($4::date,
                 (now() at time zone 'Asia/Jerusalem')::date + $3::int)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [
      f.concept,
      options.status ?? "published",
      options.dayOffset ?? 7,
      options.day ?? null,
    ]
  )
  return rows[0].id
}

// As the admin: the session's product set (admin_update_event).
async function mark(
  db: Db,
  f: Fixture,
  eventId: string,
  productIds: string[]
): Promise<void> {
  await as(db, f.admin, () =>
    db.query(UPDATE, [
      eventId,
      JSON.stringify({ product_ids: productIds }),
      randomUUID(),
    ])
  )
}

async function preview(db: Db, f: Fixture, eventId: string) {
  return as(db, f.customerA, async () => {
    const { rows } = await db.query(PREVIEW, [eventId])
    return rows[0].r as Record<string, unknown>
  })
}

async function book(db: Db, f: Fixture, eventId: string): Promise<string> {
  return as(db, f.customerA, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    return rows[0].r.booking_id as string
  })
}

async function bookError(db: Db, f: Fixture, eventId: string) {
  return as(db, f.customerA, () =>
    queryError(db, BOOK, [eventId, randomUUID()])
  )
}

async function occupied(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query("select private.occupied_places($1) as n", [
    eventId,
  ])
  return rows[0].n
}

async function productAudits(db: Db, eventId: string) {
  const { rows } = await db.query(
    `select action, event_id, before, after
     from public.audit_log
     where entity_type = 'event_products' and entity_id = $1
     order by created_at, id`,
    [eventId]
  )
  return rows
}

// As the owner: a cancellation credit of customerA from a cancelled booking
// at `originEvent` (its start is the credit's origin_starts_at), on the card
// `entitlement`, with `optionsCount` options and none assigned yet.
async function insertCredit(
  db: Db,
  f: Fixture,
  entitlement: string,
  originEvent: string,
  optionsCount = 1
): Promise<string> {
  const { rows: origin } = await db.query(
    `insert into public.bookings (
       customer_id, event_id, party_size, booked_by, policy_snapshot,
       status, confirmed_at, cancelled_at)
     values ($1, $2, 1, 'admin', ${SNAPSHOT}, 'cancelled', now(), now())
     returning id`,
    [f.customerA, originEvent]
  )
  const { rows } = await db.query(
    `insert into public.cancellation_credits (
       customer_id, origin_booking_id, source_entitlement_id, event_kind,
       party_size, options_count, origin_starts_at, original_cancelled_at,
       monetary_basis_agorot, status)
     select $1, $2, $3, 'regular', 1, $5, e.starts_at, now(), 11800, 'active'
     from public.events e where e.id = $4
     returning id`,
    [f.customerA, origin[0].id, entitlement, originEvent, optionsCount]
  )
  return rows[0].id
}

async function creditOptions(db: Db, credit: string) {
  const { rows } = await db.query(
    `select event_id, state, replaced_reason
     from public.credit_options where credit_id = $1
     order by state desc, event_id`,
    [credit]
  )
  return rows
}

async function candidates(db: Db, booking: string): Promise<string[]> {
  const { rows } = await db.query(CANDIDATES, [booking])
  return rows[0].ids
}

const PRODUCT_CODE = { code: "P0001", message: "PRODUCT_NOT_VALID_FOR_EVENT" }

describe("eligible products", { timeout: 60_000 }, () => {
  it("no product marked: as today, every fitting product books", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await card(db, f)
      const event = await insertEvent(db, f)
      expect(await preview(db, f, event)).toMatchObject({ ok: true })
      expect(await book(db, f, event)).toEqual(expect.any(String))
    })
  })

  it("card excluded, self: preview and book refuse with the new code, no place taken", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await card(db, f)
      const event = await insertEvent(db, f)
      await mark(db, f, event, [f.holiday])
      expect(await preview(db, f, event)).toMatchObject({
        ok: false,
        code: "PRODUCT_NOT_VALID_FOR_EVENT",
      })
      expect(await bookError(db, f, event)).toMatchObject(PRODUCT_CODE)
      expect(await occupied(db, event)).toBe(0)
    })
  })

  it("card excluded, Tal: admin_book_customer refuses; the manual list hides it and counts it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await card(db, f)
      const open = await insertEvent(db, f, { dayOffset: 6 })
      const excluded = await insertEvent(db, f)
      await mark(db, f, excluded, [f.holiday])
      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_BOOK, [f.customerA, excluded, randomUUID()])
        )
      ).toMatchObject(PRODUCT_CODE)
      const listed = await as(db, f.admin, async () => {
        const { rows } = await db.query(CUSTOMER_LIST, [f.customerA])
        return rows[0].r as { events: { id: string }[]; hidden: number }
      })
      expect(listed.events.map((e) => e.id)).toEqual([open])
      expect(listed.hidden).toBe(1)
    })
  })

  it("card marked: books from the card", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await card(db, f)
      const event = await insertEvent(db, f)
      await mark(db, f, event, [f.holiday, f.card])
      const booking = await book(db, f, event)
      const { rows } = await db.query(
        "select entitlement_id from public.booking_allocations where booking_id = $1",
        [booking]
      )
      expect(rows).toEqual([{ entitlement_id: entitlement }])
    })
  })

  it("an existing booking stays confirmed with its allocations when the card is unmarked", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await card(db, f)
      const event = await insertEvent(db, f)
      const booking = await book(db, f, event)
      const before = await db.query(
        "select entitlement_id, credit_id, units from public.booking_allocations where booking_id = $1",
        [booking]
      )
      await mark(db, f, event, [f.holiday])
      const { rows } = await db.query(
        "select status from public.bookings where id = $1",
        [booking]
      )
      expect(rows[0].status).toBe("confirmed")
      const after = await db.query(
        "select entitlement_id, credit_id, units from public.booking_allocations where booking_id = $1",
        [booking]
      )
      expect(after.rows).toEqual(before.rows)
    })
  })

  it("move: a card booking to a session that excludes the card is refused, the source kept", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await card(db, f)
      const source = await insertEvent(db, f)
      const target = await insertEvent(db, f, { dayOffset: 9 })
      const booking = await book(db, f, source)
      await mark(db, f, target, [f.holiday])
      expect(
        await as(db, f.customerA, () =>
          queryError(db, MOVE, [booking, target, randomUUID()])
        )
      ).toMatchObject(PRODUCT_CODE)
      const { rows } = await db.query(
        "select status from public.bookings where id = $1",
        [booking]
      )
      expect(rows[0].status).toBe("confirmed")
    })
  })

  it("expired on that date and excluded: PRODUCT_NOT_VALID_FOR_EVENT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await card(db, f)
      const event = await insertEvent(db, f, { dayOffset: 10 })
      await db.query(
        "update public.entitlements set expires_on = $2::date + 2 where id = $1",
        [entitlement, f.today]
      )
      // Expired only (no product rows): the date code, as before.
      expect(await preview(db, f, event)).toMatchObject({
        ok: false,
        code: "ENTITLEMENT_EXPIRED_ON_DATE",
      })
      await mark(db, f, event, [f.holiday])
      expect(await preview(db, f, event)).toMatchObject({
        ok: false,
        code: "PRODUCT_NOT_VALID_FOR_EVENT",
      })
    })
  })

  it("pinned: the picker lists the session's products; approving another product is EVENT_NOT_FIT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      const open = await insertEvent(db, f, { dayOffset: 8 })
      await mark(db, f, event, [f.holiday])
      const listed = await as(db, f.admin, async () => {
        const { rows } = await db.query(BOOKABLE)
        return rows[0].r as { id: string; product_ids: string[] }[]
      })
      expect(listed.find((e) => e.id === event)?.product_ids).toEqual([
        f.holiday,
      ])
      expect(listed.find((e) => e.id === open)?.product_ids).toEqual([])
      const input = {
        customerId: f.customerA,
        productId: f.pinned,
        eventId: event,
        amount: 12800,
        paidOn: f.today,
        methodId: f.method,
        duplicateConfirmed: true,
        key: randomUUID(),
      }
      expect(
        await as(db, f.admin, () =>
          queryError(db, APPROVE, approveParams(input))
        )
      ).toMatchObject({ code: "P0001", message: "EVENT_NOT_FIT" })
      // Marked: placed.
      await mark(db, f, event, [f.holiday, f.pinned])
      const r = await as(db, f.admin, () =>
        approve(db, { ...input, key: randomUUID() })
      )
      expect(r.payment_id).toEqual(expect.any(String))
    })
  })

  it("credit: a session that does not accept the credit's product is skipped and replaced; booking it with the credit is refused", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await card(db, f)
      const past = await insertEvent(db, f, {
        dayOffset: -3,
        status: "completed",
      })
      const { rows: origin } = await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot,
           status, confirmed_at, cancelled_at)
         values ($1, $2, 1, 'admin', ${SNAPSHOT}, 'cancelled', now(), now())
         returning id`,
        [f.customerA, past]
      )
      // The card itself no longer funds anything: only the credit can.
      await db.query(
        "update public.entitlements set status = 'revoked' where id = $1",
        [entitlement]
      )
      const holidayOnly = await insertEvent(db, f, { dayOffset: 3 })
      const open = await insertEvent(db, f, { dayOffset: 5 })
      const { rows: credits } = await db.query(
        `insert into public.cancellation_credits (
           customer_id, origin_booking_id, source_entitlement_id, event_kind,
           party_size, options_count, origin_starts_at, original_cancelled_at,
           monetary_basis_agorot, status)
         values ($1, $2, $3, 'regular', 1, 1, now() - interval '3 days',
           now(), 11800, 'active')
         returning id`,
        [f.customerA, origin[0].id, entitlement]
      )
      const credit = credits[0].id
      await mark(db, f, holidayOnly, [f.holiday])
      // An option still active on it (as before a refresh ran).
      await db.query(
        "insert into public.credit_options (credit_id, event_id) values ($1, $2)",
        [credit, holidayOnly]
      )

      // The preview refreshes her credits first, so the option is already
      // replaced and nothing funds the session.
      expect(await preview(db, f, holidayOnly)).toMatchObject({
        ok: false,
        code: "NO_MATCHING_ENTITLEMENT",
      })
      // Booking it with the credit is refused (book_session refreshes her
      // credits first too), no place taken.
      expect(await bookError(db, f, holidayOnly)).toMatchObject({
        code: "P0001",
        message: "NO_MATCHING_ENTITLEMENT",
      })
      expect(await occupied(db, holidayOnly)).toBe(0)

      // The refresh replaces it like a full one; the fill skips it.
      await db.query("select private.refresh_credit_options($1)", [credit])
      const { rows: options } = await db.query(
        `select event_id, state, replaced_reason
         from public.credit_options where credit_id = $1
         order by state desc, event_id`,
        [credit]
      )
      expect(options).toEqual([
        { event_id: holidayOnly, state: "replaced", replaced_reason: "full" },
        { event_id: open, state: "active", replaced_reason: null },
      ])
      expect(await book(db, f, open)).toEqual(expect.any(String))
    })
  })

  it("credit: admin_update_event itself replaces an active option on a session that stops accepting the credit's product", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await card(db, f)
      const past = await insertEvent(db, f, {
        dayOffset: -3,
        status: "completed",
      })
      const first = await insertEvent(db, f, { dayOffset: 3 })
      const next = await insertEvent(db, f, { dayOffset: 5 })
      const credit = await insertCredit(db, f, entitlement, past)
      // Setup only: the credit's one option is the first session.
      await db.query("select private.refresh_credit_options($1)", [credit])
      expect(await creditOptions(db, credit)).toEqual([
        { event_id: first, state: "active", replaced_reason: null },
      ])

      await mark(db, f, first, [f.holiday])

      // Read directly: no preview and no refresh of this credit.
      expect(await creditOptions(db, credit)).toEqual([
        { event_id: first, state: "replaced", replaced_reason: "full" },
      ])
      // The next session comes with the scheduled refresh
      // (job_refresh_credit_options): admin_update_event only replaces, as a
      // capacity change does (refresh_credits_for_event, p_fill false).
      await db.query("select private.job_refresh_credit_options()")
      expect(await creditOptions(db, credit)).toEqual([
        { event_id: first, state: "replaced", replaced_reason: "full" },
        { event_id: next, state: "active", replaced_reason: null },
      ])
    })
  })

  it("Tal's move of a credit-funded booking to a session that excludes the credit's product: refused, and not a candidate", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await card(db, f)
      const past = await insertEvent(db, f, {
        dayOffset: -3,
        status: "completed",
      })
      const first = await insertEvent(db, f, { dayOffset: 3 })
      const excluded = await insertEvent(db, f, { dayOffset: 5 })
      const later = await insertEvent(db, f, { dayOffset: 7 })
      await mark(db, f, excluded, [f.holiday])
      // Only the credit funds her bookings.
      await db.query(
        "update public.entitlements set status = 'revoked' where id = $1",
        [entitlement]
      )
      const credit = await insertCredit(db, f, entitlement, past, 2)
      await db.query("select private.refresh_credit_options($1)", [credit])
      expect(await creditOptions(db, credit)).toEqual(
        expect.arrayContaining([
          { event_id: first, state: "active", replaced_reason: null },
          { event_id: later, state: "active", replaced_reason: null },
        ])
      )
      const booking = await book(db, f, first)
      const { rows: funded } = await db.query(
        "select credit_id from public.booking_allocations where booking_id = $1",
        [booking]
      )
      expect(funded).toEqual([{ credit_id: credit }])

      const ids = await candidates(db, booking)
      expect(ids).not.toContain(excluded)
      expect(ids).toContain(later)
      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_MOVE, [booking, excluded, randomUUID()])
        )
      ).toMatchObject(PRODUCT_CODE)
      const { rows } = await db.query(
        "select status from public.bookings where id = $1",
        [booking]
      )
      expect(rows[0].status).toBe("confirmed")
    })
  })

  it("Tal's move of a pinned booking to a session that excludes its product: refused, and not a candidate", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const source = await insertEvent(db, f, { dayOffset: 3 })
      const excluded = await insertEvent(db, f, { dayOffset: 5 })
      const later = await insertEvent(db, f, { dayOffset: 7 })
      await mark(db, f, excluded, [f.holiday])
      const r = await as(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: f.pinned,
          eventId: source,
          amount: 12800,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      const { rows: placed } = await db.query(
        "select id from public.bookings where payment_id = $1",
        [r.payment_id]
      )
      const booking = placed[0].id

      // credit_options_count = 1: the first later session that fits.
      expect(await candidates(db, booking)).toEqual([later])
      expect(
        await as(db, f.admin, () =>
          queryError(db, ADMIN_MOVE, [booking, excluded, randomUUID()])
        )
      ).toMatchObject(PRODUCT_CODE)
      const { rows } = await db.query(
        "select status from public.bookings where id = $1",
        [booking]
      )
      expect(rows[0].status).toBe("confirmed")
    })
  })

  it("credit: its origin session, once it excludes the credit's product, is not funded by it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await card(db, f)
      const origin = await insertEvent(db, f, { dayOffset: 4 })
      await db.query(
        "update public.entitlements set status = 'revoked' where id = $1",
        [entitlement]
      )
      await insertCredit(db, f, entitlement, origin)
      // Before: the credit funds its origin session.
      expect(await preview(db, f, origin)).toMatchObject({
        ok: true,
        source: "credit",
      })

      await mark(db, f, origin, [f.holiday])
      expect(await preview(db, f, origin)).toMatchObject({
        ok: false,
        code: "PRODUCT_NOT_VALID_FOR_EVENT",
      })
      expect(await bookError(db, f, origin)).toMatchObject(PRODUCT_CODE)
      expect(await occupied(db, origin)).toBe(0)
    })
  })

  it("auto-extend: a week whose only session excludes the card extends it by 7 days", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const entitlement = await card(db, f)
      await db.query(
        "update public.entitlements set valid_from = '2099-03-01', expires_on = '2099-03-05' where id = $1",
        [entitlement]
      )
      const event = await insertEvent(db, f, { day: "2099-03-03" })
      await mark(db, f, event, [f.holiday])
      const { rows } = await db.query(JOB, ["2099-03-08", [entitlement]])
      expect(rows[0].n).toBe(1)
      const { rows: after } = await db.query(
        "select expires_on::text as d from public.entitlements where id = $1",
        [entitlement]
      )
      expect(after[0].d).toBe("2099-03-12")
    })
  })

  it("wrong kind: a couple product for a regular session is INVALID_INPUT on product_ids", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      const error = await as(db, f.admin, async () => {
        await db.query("savepoint wrong_kind")
        try {
          await db.query(UPDATE, [
            event,
            JSON.stringify({ product_ids: [f.couple] }),
            randomUUID(),
          ])
          return null
        } catch (e) {
          await db.query("rollback to savepoint wrong_kind")
          return e as { message: string; detail?: string }
        }
      })
      expect(error?.message).toBe("INVALID_INPUT")
      expect(JSON.parse(error?.detail ?? "{}")).toEqual({
        field: "product_ids",
      })
      for (const bad of [[f.card, f.card], ["nope"], "x"]) {
        expect(
          await as(db, f.admin, () =>
            queryError(db, UPDATE, [
              event,
              JSON.stringify({ product_ids: bad }),
              randomUUID(),
            ])
          )
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
    })
  })

  it("audit: a changed set writes old and new names; the same set writes nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await mark(db, f, event, [f.holiday, f.card])
      await mark(db, f, event, [f.card, f.holiday])
      await mark(db, f, event, [f.holiday])
      await mark(db, f, event, [])
      const sorted = [f.card, f.holiday].sort()
      // One transaction: the same created_at, so in any order.
      const rows = await productAudits(db, event)
      expect(rows).toHaveLength(3)
      expect(rows).toEqual(
        expect.arrayContaining([
          {
            action: "admin_update_event",
            event_id: event,
            before: { product_ids: [], product_names: [] },
            after: {
              product_ids: sorted,
              product_names: [testName("card"), testName("holiday")],
            },
          },
          {
            action: "admin_update_event",
            event_id: event,
            before: {
              product_ids: sorted,
              product_names: [testName("card"), testName("holiday")],
            },
            after: {
              product_ids: [f.holiday],
              product_names: [testName("holiday")],
            },
          },
          {
            action: "admin_update_event",
            event_id: event,
            before: {
              product_ids: [f.holiday],
              product_names: [testName("holiday")],
            },
            after: { product_ids: [], product_names: [] },
          },
        ])
      )
    })
  })

  it("create and duplicate: the set is saved and copied, each with its audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const created = await as(db, f.admin, async () => {
        const { rows } = await db.query(CREATE, [
          JSON.stringify({
            concept_id: f.concept,
            date: "2099-05-05",
            start_time: "10:00",
            end_time: "12:00",
            product_ids: [f.holiday],
          }),
          randomUUID(),
        ])
        return rows[0].r.event_id as string
      })
      expect(await productAudits(db, created)).toEqual([
        {
          action: "admin_create_event",
          event_id: created,
          before: { product_ids: [], product_names: [] },
          after: {
            product_ids: [f.holiday],
            product_names: [testName("holiday")],
          },
        },
      ])
      const copy = await as(db, f.admin, async () => {
        const { rows } = await db.query(DUPLICATE, [
          created,
          "2099-06-06",
          "10:00",
          "12:00",
          randomUUID(),
        ])
        return rows[0].r.event_id as string
      })
      const { rows } = await db.query(
        "select product_id from public.event_products where event_id = $1",
        [copy]
      )
      expect(rows).toEqual([{ product_id: f.holiday }])
      expect((await productAudits(db, copy))[0]).toMatchObject({
        action: "admin_duplicate_event",
        after: { product_ids: [f.holiday] },
      })
      // A session made without products has no such row.
      const plain = await as(db, f.admin, async () => {
        const { rows: made } = await db.query(CREATE, [
          JSON.stringify({
            concept_id: f.concept,
            date: "2099-05-06",
            start_time: "10:00",
            end_time: "12:00",
          }),
          randomUUID(),
        ])
        return made[0].r.event_id as string
      })
      expect(await productAudits(db, plain)).toEqual([])
    })
  })

  it("a customer cannot write or read event_products", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await mark(db, f, event, [f.holiday])
      expect(
        await as(db, f.customerA, () =>
          queryError(
            db,
            "insert into public.event_products (event_id, product_id) values ($1, $2)",
            [event, f.card]
          )
        )
      ).toMatchObject({ code: "42501" })
      const { rows } = await as(db, f.customerA, () =>
        db.query("select * from public.event_products where event_id = $1", [
          event,
        ])
      )
      expect(rows).toEqual([])
      const admin = await as(db, f.admin, () =>
        db.query(
          "select product_id from public.event_products where event_id = $1",
          [event]
        )
      )
      expect(admin.rows).toEqual([{ product_id: f.holiday }])
    })
  })
})
