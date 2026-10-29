// Story 2.14: voiding a purchase recorded by mistake (user decisions
// 2026-10-26). admin_void_purchase with its plan and preview, cancel_core's
// void mode, and the readers that treat a voided purchase consistently
// (get_my_entitlements, token_view, bind_purchase, lock_join_payment,
// admin_list_links, admin_list_payments, admin_get_entitlement,
// admin_get_home). One test per row of the spec's I/O matrix. Everything
// runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const VOID = "select public.admin_void_purchase($1, $2, $3, $4) as r"
const PREVIEW = "select public.preview_admin_void_purchase($1) as r"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2, $3) as r"
const JOIN_WAITLIST = "select public.join_waitlist($1, $2) as r"
const MINE = "select public.get_my_entitlements() as r"
const GET = "select public.admin_get_entitlement($1) as r"
const PAYMENTS = "select public.admin_list_payments() as r"
const LINKS = "select public.admin_list_links() as r"
const ISSUE = "select public.admin_issue_link('join', $1, $2) as r"
const HOME = "select public.admin_get_home() as r"
const VIEW = "select public.token_view($1) as r"

type Fixture = MoneyFixture & {
  single: string
  couple: string
  concept: string
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  const { rows: p } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1),
            ($2, 'couple', 25000, 1, 'session', null, null, 'couple', 2)
     returning id, type`,
    [testName("single"), testName("couple")]
  )
  const { rows } = await db.query<{ id: string }>(
    "select id from public.concepts where archived_at is null order by name limit 1"
  )
  return {
    ...f,
    single: p.find((r) => r.type === "single").id,
    couple: p.find((r) => r.type === "couple").id,
    concept: rows[0].id,
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

// A published session at 10:00 local, `dayOffset` days from today.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    dayOffset?: number
    kind?: "regular" | "couple"
    capacity?: number
  }
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
      f.concept,
      options.kind ?? "regular",
      options.capacity ?? 12,
      options.dayOffset ?? 10,
    ]
  )
  return rows[0].id
}

type Purchase = {
  paymentId: string
  entitlementId: string
  token: string | null
  tokenId: string | null
}

function buy(
  db: Db,
  f: Fixture,
  options: { customerId?: string | null } = {}
): Promise<Purchase> {
  return buyFor(
    db,
    f,
    options.customerId === undefined ? f.customerA : options.customerId,
    f.card
  )
}

async function buyFor(
  db: Db,
  f: Fixture,
  customerId: string | null,
  productId: string,
  eventId: string | null = null
): Promise<Purchase> {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId,
      productId,
      eventId,
      // The catalog price of each fixture product.
      amount:
        productId === f.single ? 12800 : productId === f.couple ? 25000 : 47200,
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
  return {
    paymentId: r.payment_id as string,
    entitlementId: rows[0].id as string,
    token: (r.token as string | undefined) ?? null,
    tokenId: (r.token_id as string | undefined) ?? null,
  }
}

async function book(db: Db, customer: string, eventId: string) {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    return rows[0].r.booking_id as string
  })
}

async function pinnedBooking(db: Db, paymentId: string): Promise<string> {
  const { rows } = await db.query(
    "select id from public.bookings where payment_id = $1",
    [paymentId]
  )
  return rows[0].id
}

async function voidAs(
  db: Db,
  user: string,
  paymentId: string,
  options: { reason?: string | null; confirmed?: boolean; key?: string } = {}
) {
  return as(db, user, async () => {
    const { rows } = await db.query(VOID, [
      paymentId,
      options.reason ?? null,
      options.confirmed ?? true,
      options.key ?? randomUUID(),
    ])
    return rows[0].r
  })
}

async function voidError(
  db: Db,
  user: string,
  paymentId: string,
  options: { reason?: string | null; confirmed?: boolean } = {}
) {
  return as(db, user, () =>
    queryError(db, VOID, [
      paymentId,
      options.reason ?? null,
      options.confirmed ?? true,
      randomUUID(),
    ])
  )
}

async function previewAs(db: Db, user: string, paymentId: string) {
  return as(db, user, async () => {
    const { rows } = await db.query(PREVIEW, [paymentId])
    return rows[0].r
  })
}

// What a refused void must leave as it was.
async function snapshot(db: Db, p: Purchase) {
  const { rows } = await db.query(
    `select pay.status as payment_status, pay.voided_at, e.status as entitlement_status,
       (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'status', b.status) order by b.id), '[]')
        from public.bookings b
        where b.payment_id = pay.id
           or b.id in (select a.booking_id from public.booking_allocations a where a.entitlement_id = e.id)) as bookings,
       (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'state', t.state) order by t.id), '[]')
        from public.activation_tokens t where t.payment_id = pay.id) as tokens,
       (select count(*)::int from public.entitlement_movements m where m.entitlement_id = e.id) as movements
     from public.payments pay
     join public.entitlements e on e.payment_id = pay.id
     where pay.id = $1`,
    [p.paymentId]
  )
  return rows[0]
}

async function occupied(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query("select private.occupied_places($1) as n", [
    eventId,
  ])
  return rows[0].n
}

async function notificationCount(db: Db, customer: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.notifications where recipient_id = $1",
    [customer]
  )
  return rows[0].n
}

describe("admin_void_purchase", { timeout: 60_000 }, () => {
  it("card with a future booking: cancelled and released with no credit, voided, revoked, place freed, waitlist told, no customer notification, gone from /me", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await buy(db, f)
      const event = await insertEvent(db, f, { capacity: 1 })
      const booking = await book(db, f.customerA, event)
      // The session is full; customer B waits for it.
      await as(db, f.customerB, () =>
        db.query(JOIN_WAITLIST, [event, randomUUID()])
      )
      expect(await occupied(db, event)).toBe(1)

      const plan = await previewAs(db, f.admin, card.paymentId)
      expect(plan).toMatchObject({
        ok: true,
        payment_id: card.paymentId,
        entitlement_id: card.entitlementId,
        kind: "card",
        customer_id: f.customerA,
        amount_agorot: 47200,
        link_will_be_revoked: false,
      })
      expect(plan.bookings).toHaveLength(1)
      expect(plan.bookings[0]).toMatchObject({
        booking_id: booking,
        event_id: event,
        party_size: 1,
      })

      const before = await notificationCount(db, f.customerA)
      const reason = testName("wrong customer")
      expect(
        await voidAs(db, f.admin, card.paymentId, { reason: ` ${reason} ` })
      ).toEqual({
        payment_id: card.paymentId,
        cancelled_count: 1,
        revoked_pending_user_id: null,
      })

      const { rows: b } = await db.query(
        "select status from public.bookings where id = $1",
        [booking]
      )
      expect(b[0].status).toBe("cancelled")
      const { rows: moves } = await db.query(
        "select action, units from public.entitlement_movements where booking_id = $1 order by created_at, action",
        [booking]
      )
      expect(moves).toEqual(
        expect.arrayContaining([{ action: "release", units: 1 }])
      )
      const { rows: credits } = await db.query(
        "select count(*)::int as n from public.cancellation_credits where origin_booking_id = $1 or source_entitlement_id = $2",
        [booking, card.entitlementId]
      )
      expect(credits[0].n).toBe(0)
      const { rows: balance } = await db.query(
        "select reserved from public.entitlement_balances where entitlement_id = $1",
        [card.entitlementId]
      )
      expect(balance[0].reserved).toBe(0)

      const { rows: state } = await db.query(
        `select pay.status, pay.voided_at is not null as has_voided_at, e.status as e_status
         from public.payments pay join public.entitlements e on e.payment_id = pay.id
         where pay.id = $1`,
        [card.paymentId]
      )
      expect(state[0]).toEqual({
        status: "voided",
        has_voided_at: true,
        e_status: "revoked",
      })

      // The place is free again, and the waiting customer hears of it.
      expect(await occupied(db, event)).toBe(0)
      const { rows: spot } = await db.query(
        "select count(*)::int as n from public.notifications where recipient_id = $1 and type = 'waitlist_spot'",
        [f.customerB]
      )
      expect(spot[0].n).toBe(1)

      // Nothing for the customer.
      expect(await notificationCount(db, f.customerA)).toBe(before)

      // Gone from her personal area.
      const mine = await as(
        db,
        f.customerA,
        async () => (await db.query(MINE)).rows[0].r
      )
      expect(
        mine.map((e: { entitlement_id: string }) => e.entitlement_id)
      ).not.toContain(card.entitlementId)

      // The page and the payments list.
      const page = await as(
        db,
        f.admin,
        async () => (await db.query(GET, [card.entitlementId])).rows[0].r
      )
      expect(page).toMatchObject({
        payment_id: card.paymentId,
        payment_status: "voided",
        void_reason: reason,
        status: "revoked",
        correctable: false,
      })
      expect(page.voided_at).not.toBeNull()
      const list = await as(
        db,
        f.admin,
        async () => (await db.query(PAYMENTS)).rows[0].r
      )
      expect(
        list.find(
          (row: { payment_id: string }) => row.payment_id === card.paymentId
        )
      ).toMatchObject({ status: "voided", entitlement_id: card.entitlementId })

      // One operation in the log: the booking, the entitlement and the
      // payment, each with the reason.
      const { rows: audit } = await db.query(
        `select entity_type, reason from public.audit_log
         where action = 'admin_void_purchase' and entity_id in ($1, $2, $3)
         order by entity_type`,
        [booking, card.entitlementId, card.paymentId]
      )
      expect(audit).toEqual([
        { entity_type: "bookings", reason },
        { entity_type: "entitlements", reason },
        { entity_type: "payments", reason },
      ])
    })
  })

  it("pinned couple, unbound: listed with party size 2 and the link; cancelled with no credit, link revoked, token_view voided, no bind, no new link", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, { kind: "couple", capacity: 14 })
      const couple = await buyFor(db, f, null, f.couple, event)
      const booking = await pinnedBooking(db, couple.paymentId)
      await db.query(
        "update public.bookings set guest_details = $1 where id = $2",
        [testName("partner"), booking]
      )
      expect(await occupied(db, event)).toBe(2)

      const plan = await previewAs(db, f.admin, couple.paymentId)
      expect(plan).toMatchObject({
        ok: true,
        kind: "couple",
        customer_id: null,
        link_will_be_revoked: true,
      })
      expect(plan.bookings).toEqual([
        expect.objectContaining({
          booking_id: booking,
          party_size: 2,
          guest_details: testName("partner"),
        }),
      ])

      expect(await voidAs(db, f.admin, couple.paymentId)).toMatchObject({
        cancelled_count: 1,
      })
      expect(await occupied(db, event)).toBe(0)
      const { rows: credits } = await db.query(
        "select count(*)::int as n from public.cancellation_credits where source_entitlement_id = $1",
        [couple.entitlementId]
      )
      expect(credits[0].n).toBe(0)
      const { rows: token } = await db.query(
        "select state from public.activation_tokens where id = $1",
        [couple.tokenId]
      )
      expect(token[0].state).toBe("revoked")

      // The join page reads "voided".
      await asServiceRole(db)
      const { rows: view } = await db.query(VIEW, [couple.token])
      await db.query("reset role")
      expect(view[0].r).toMatchObject({ state_public: "voided" })

      // Never bound, never a new link.
      expect(
        await queryError(db, "select private.bind_purchase($1, $2)", [
          couple.paymentId,
          f.customerA,
        ])
      ).toMatchObject({ code: "P0001", message: "PURCHASE_VOIDED" })
      expect(
        await as(db, f.admin, () =>
          queryError(db, ISSUE, [couple.paymentId, randomUUID()])
        )
      ).toMatchObject({ code: "P0001", message: "PURCHASE_VOIDED" })
      const links = await as(
        db,
        f.admin,
        async () => (await db.query(LINKS)).rows[0].r
      )
      const row = links.find(
        (l: { token_id: string }) => l.token_id === couple.tokenId
      )
      expect(row).toMatchObject({ can_revoke: false, can_replace: false })
    })
  })

  it("pinned single, bound: the plan's kind is single; cancelled with no credit and no notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, {})
      const single = await buyFor(db, f, f.customerA, f.single, event)
      const booking = await pinnedBooking(db, single.paymentId)

      const plan = await previewAs(db, f.admin, single.paymentId)
      expect(plan).toMatchObject({ ok: true, kind: "single" })
      expect(plan.bookings).toHaveLength(1)

      const before = await notificationCount(db, f.customerA)
      await voidAs(db, f.admin, single.paymentId)
      const { rows } = await db.query(
        `select b.status,
           (select count(*)::int from public.cancellation_credits c where c.origin_booking_id = b.id) as credits,
           (select count(*)::int from public.refund_requests r where r.booking_id = b.id) as refunds
         from public.bookings b where b.id = $1`,
        [booking]
      )
      expect(rows[0]).toEqual({ status: "cancelled", credits: 0, refunds: 0 })
      expect(await notificationCount(db, f.customerA)).toBe(before)
    })
  })

  it("mid-join (a claiming link in progress): LINK_IN_PROGRESS, nothing changes; a stuck one is revoked and its pending user returned", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const fresh = await buy(db, f, { customerId: null })
      await db.query(
        "update public.activation_tokens set state = 'claiming', claiming_at = now(), pending_user_id = gen_random_uuid() where id = $1",
        [fresh.tokenId]
      )
      const before = await snapshot(db, fresh)
      expect(await voidError(db, f.admin, fresh.paymentId)).toMatchObject({
        code: "P0001",
        message: "LINK_IN_PROGRESS",
      })
      expect(await snapshot(db, fresh)).toEqual(before)

      const stuck = await buy(db, f, { customerId: null })
      const pendingUser = randomUUID()
      await db.query(
        "update public.activation_tokens set state = 'claiming', claiming_at = now() - interval '20 minutes', pending_user_id = $2 where id = $1",
        [stuck.tokenId, pendingUser]
      )
      expect(await voidAs(db, f.admin, stuck.paymentId)).toMatchObject({
        cancelled_count: 0,
        revoked_pending_user_id: pendingUser,
      })
    })
  })

  it("used entry: a completed booking, or a confirmed one whose session started: PURCHASE_ENTRY_USED, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await buy(db, f)
      const event = await insertEvent(db, f, {})
      const booking = await book(db, f.customerA, event)
      await db.query(
        `update public.events
         set starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour',
           registration_closes_at = now() - interval '1 hour'
         where id = $1`,
        [event]
      )
      const before = await snapshot(db, card)
      expect(await previewAs(db, f.admin, card.paymentId)).toEqual({
        ok: false,
        code: "PURCHASE_ENTRY_USED",
      })
      expect(await voidError(db, f.admin, card.paymentId)).toMatchObject({
        code: "P0001",
        message: "PURCHASE_ENTRY_USED",
      })
      expect(await snapshot(db, card)).toEqual(before)

      await db.query(
        "update public.bookings set status = 'completed' where id = $1",
        [booking]
      )
      expect(await voidError(db, f.admin, card.paymentId)).toMatchObject({
        message: "PURCHASE_ENTRY_USED",
      })
    })
  })

  it("a credit from the purchase: PURCHASE_HAS_CREDIT, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, {})
      const single = await buyFor(db, f, f.customerA, f.single, event)
      const booking = await pinnedBooking(db, single.paymentId)
      await as(db, f.customerA, () =>
        db.query(CANCEL, [booking, randomUUID(), "credit"])
      )
      const before = await snapshot(db, single)
      expect(await previewAs(db, f.admin, single.paymentId)).toEqual({
        ok: false,
        code: "PURCHASE_HAS_CREDIT",
      })
      expect(await voidError(db, f.admin, single.paymentId)).toMatchObject({
        message: "PURCHASE_HAS_CREDIT",
      })
      expect(await snapshot(db, single)).toEqual(before)
    })
  })

  it("mixed funding: a future booking drawn from the card and a single: MANUAL_HANDLING_REQUIRED, nothing changes (6.5)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await buy(db, f)
      const event = await insertEvent(db, f, { dayOffset: 5 })
      const other = await insertEvent(db, f, { dayOffset: 6 })
      const single = await buyFor(db, f, f.customerA, f.single, other)
      // A booking for two offset from two kinds (as cancel-booking.test.ts).
      const { rows: mixed } = await db.query(
        `insert into public.bookings (customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 2, 'admin', '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb)
         returning id`,
        [f.customerA, event]
      )
      await db.query(
        `insert into public.booking_allocations (booking_id, entitlement_id, units)
         values ($1, $2, 1), ($1, $3, 1)`,
        [mixed[0].id, card.entitlementId, single.entitlementId]
      )

      // Both purchases fund the booking: each void is refused.
      for (const p of [card, single]) {
        const before = await snapshot(db, p)
        expect(await previewAs(db, f.admin, p.paymentId)).toEqual({
          ok: false,
          code: "MANUAL_HANDLING_REQUIRED",
        })
        expect(await voidError(db, f.admin, p.paymentId)).toMatchObject({
          code: "P0001",
          message: "MANUAL_HANDLING_REQUIRED",
        })
        expect(await snapshot(db, p)).toEqual(before)
      }
    })
  })

  it("again: an already voided purchase is PURCHASE_VOIDED (bound, and unbound through the link lock)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await buy(db, f)
      await voidAs(db, f.admin, card.paymentId)
      const before = await snapshot(db, card)
      expect(await voidError(db, f.admin, card.paymentId)).toMatchObject({
        message: "PURCHASE_VOIDED",
      })
      expect(await snapshot(db, card)).toEqual(before)
      expect(await previewAs(db, f.admin, card.paymentId)).toEqual({
        ok: false,
        code: "PURCHASE_VOIDED",
      })

      const unbound = await buy(db, f, { customerId: null })
      await voidAs(db, f.admin, unbound.paymentId)
      expect(await voidError(db, f.admin, unbound.paymentId)).toMatchObject({
        message: "PURCHASE_VOIDED",
      })
    })
  })

  it("no checkbox: CONFIRM_REQUIRED; a reason over 2000: INVALID_INPUT; nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await buy(db, f)
      const before = await snapshot(db, card)
      expect(
        await voidError(db, f.admin, card.paymentId, { confirmed: false })
      ).toMatchObject({ message: "CONFIRM_REQUIRED" })
      expect(
        await voidError(db, f.admin, card.paymentId, {
          reason: "x".repeat(2001),
        })
      ).toMatchObject({ message: "INVALID_INPUT" })
      expect(await snapshot(db, card)).toEqual(before)
    })
  })

  it("idempotent: the same key twice is one void and one set of audit rows", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await buy(db, f)
      const event = await insertEvent(db, f, {})
      await book(db, f.customerA, event)
      const key = randomUUID()
      const first = await voidAs(db, f.admin, card.paymentId, { key })
      const second = await voidAs(db, f.admin, card.paymentId, { key })
      expect(second).toEqual(first)
      const { rows } = await db.query(
        `select entity_type, count(*)::int as n from public.audit_log
         where action = 'admin_void_purchase' and (entity_id = $1 or entity_id = $2)
         group by entity_type order by entity_type`,
        [card.paymentId, card.entitlementId]
      )
      expect(rows).toEqual([
        { entity_type: "entitlements", n: 1 },
        { entity_type: "payments", n: 1 },
      ])
    })
  })

  it("a customer calling the void or its preview: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await buy(db, f)
      expect(await voidError(db, f.customerA, card.paymentId)).toMatchObject({
        message: "NOT_AUTHORIZED",
      })
      expect(
        await as(db, f.customerA, () =>
          queryError(db, PREVIEW, [card.paymentId])
        )
      ).toMatchObject({ message: "NOT_AUTHORIZED" })
    })
  })

  it("totals: a voided payment leaves the month's sum", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await buy(db, f)
      const home = () =>
        as(db, f.admin, async () => (await db.query(HOME)).rows[0].r.totals)
      const before = await home()
      await voidAs(db, f.admin, card.paymentId)
      const after = await home()
      expect(before.approved_agorot - after.approved_agorot).toBe(47200)
      expect(before.approved_count - after.approved_count).toBe(1)
    })
  })

  it("an unknown payment: the preview is NOT_FOUND and the void raises NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const missing = randomUUID()
      expect(await previewAs(db, f.admin, missing)).toEqual({
        ok: false,
        code: "NOT_FOUND",
      })
      expect(await voidError(db, f.admin, missing)).toMatchObject({
        code: "P0001",
        message: "NOT_FOUND",
      })
    })
  })

  it("an unbound purchase whose link is in conflict: listed as revoked, the void revokes it and token_view reads voided", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const unbound = await buy(db, f, { customerId: null })
      await db.query(
        "update public.activation_tokens set state = 'conflict', conflict_reason = 'two_accounts' where id = $1",
        [unbound.tokenId]
      )
      expect(await previewAs(db, f.admin, unbound.paymentId)).toMatchObject({
        ok: true,
        link_will_be_revoked: true,
        bookings: [],
      })
      expect(await voidAs(db, f.admin, unbound.paymentId)).toMatchObject({
        cancelled_count: 0,
        revoked_pending_user_id: null,
      })
      const { rows } = await db.query(
        "select state from public.activation_tokens where id = $1",
        [unbound.tokenId]
      )
      expect(rows[0].state).toBe("revoked")
      await asServiceRole(db)
      const { rows: view } = await db.query(VIEW, [unbound.token])
      await db.query("reset role")
      expect(view[0].r).toMatchObject({ state_public: "voided" })
    })
  })

  it("cancel_core's void mode is only for admin_void_purchase", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await buy(db, f)
      const event = await insertEvent(db, f, {})
      const booking = await book(db, f.customerA, event)
      expect(
        await queryError(
          db,
          "select private.cancel_core($1, $2, 'admin', 'admin_cancel_booking', null, 'void')",
          [booking, f.admin]
        )
      ).toMatchObject({ message: "INVALID_INPUT" })
    })
  })

  it("payments.voided_at is set exactly with the voided status", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const card = await buy(db, f)
      expect(
        await queryError(
          db,
          "update public.payments set status = 'voided' where id = $1",
          [card.paymentId]
        )
      ).toMatchObject({ code: "23514" })
      expect(
        await queryError(
          db,
          "update public.payments set voided_at = now() where id = $1",
          [card.paymentId]
        )
      ).toMatchObject({ code: "23514" })
    })
  })
})
