// Story 4.1: the admin home. admin_get_attention_items ("to handle", AD-22):
// every kind appears from its stored state and disappears when the state
// changes. admin_get_home: upcoming sessions with occupied places, cards
// about to expire (threshold from business_settings) and the month's
// approved payments by paid_on (Asia/Jerusalem). One test per row of the
// spec's I/O matrix. The dev database may hold other rows, so every check
// looks only at this test's ids (or at the change in the totals). Everything
// runs in inRollback.

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
  approve,
  DEFAULT_PAYER,
  seedMoney,
  type ApproveInput,
  type MoneyFixture,
} from "./support/money"

const ITEMS = "select public.admin_get_attention_items() as r"
const HOME = "select public.admin_get_home() as r"
const ISSUE = "select public.admin_issue_link('join', $1, $2) as r"
const REVOKE = "select public.admin_revoke_link($1, $2) as r"
const PAYMENTS = "select public.admin_list_payments() as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Item = Record<string, unknown> & { kind: string; id: string }
type Home = {
  upcoming_sessions: Record<string, unknown>[]
  expiring_cards: Record<string, unknown>[]
  totals: {
    period_start: string
    period_end: string
    approved_count: number
    approved_agorot: number
    refunded_count: number
    refunded_agorot: number
    net_agorot: number
  }
  open_refunds: Record<string, unknown>[]
}

type Fixture = MoneyFixture & { single: string; concept: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  // A pinned single (validity_mode session, every weekday).
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1)
     returning id`,
    [testName("single")]
  )
  const { rows: concepts } = await db.query(
    "select id from public.concepts where archived_at is null order by sort_order, id limit 1"
  )
  return { ...f, single: rows[0].id, concept: concepts[0].id }
}

// As the owner: a session from `startDays` (negative: in the past) for
// `hours` hours.
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    startDays?: number
    hours?: number
    capacity?: number
    status?: string
  } = {}
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     values ($1, 'regular', now() + make_interval(days => $2::int),
       now() + make_interval(days => $2::int, hours => $3::int), $4,
       now() + make_interval(days => $2::int), $5)
     returning id`,
    [
      f.concept,
      options.startDays ?? 7,
      options.hours ?? 2,
      options.capacity ?? 12,
      options.status ?? "published",
    ]
  )
  return rows[0].id
}

async function asAdmin<T>(db: Db, f: Fixture, run: () => Promise<T>) {
  await asAuthenticated(db, f.admin)
  try {
    return await run()
  } finally {
    await db.query("reset role")
  }
}

async function items(db: Db, f: Fixture): Promise<Item[]> {
  return asAdmin(db, f, async () => (await db.query(ITEMS)).rows[0].r)
}

async function home(db: Db, f: Fixture): Promise<Home> {
  return asAdmin(db, f, async () => (await db.query(HOME)).rows[0].r)
}

async function approveAs(db: Db, f: Fixture, input: Partial<ApproveInput>) {
  return asAdmin(db, f, () =>
    approve(db, {
      productId: f.card,
      amount: 47200,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
      ...input,
    })
  )
}

async function issueReplacement(db: Db, f: Fixture, paymentId: string) {
  return asAdmin(
    db,
    f,
    async () => (await db.query(ISSUE, [paymentId, randomUUID()])).rows[0].r
  )
}

// Whether a timestamptz text from the RPC is the same instant as a column.
async function sameInstant(
  db: Db,
  value: unknown,
  column: string,
  tokenId: string
): Promise<boolean> {
  const { rows } = await db.query(
    `select $1::timestamptz = ${column} as same from public.activation_tokens where id = $2`,
    [value, tokenId]
  )
  return rows[0].same
}

function only(list: Item[], ids: string[]): Item[] {
  return list.filter((i) => ids.includes(i.id))
}

describe("admin_get_attention_items", () => {
  it("a link in conflict is link_conflict; after a replacement link it is gone", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const r = await approveAs(db, f, {})
      const tokenId = r.token_id as string
      const paymentId = r.payment_id as string
      await db.query(
        "update public.activation_tokens set state = 'conflict', conflict_reason = 'two_accounts' where id = $1",
        [tokenId]
      )

      expect(only(await items(db, f), [tokenId, paymentId])).toEqual([
        expect.objectContaining({
          kind: "link_conflict",
          id: tokenId,
          customer_label: DEFAULT_PAYER,
          conflict_reason: "two_accounts",
          payment_id: paymentId,
          product_name: testName("card"),
          amount_agorot: 47200,
          paid_on: f.today,
          since: expect.any(String),
        }),
      ])

      await issueReplacement(db, f, paymentId)
      expect(only(await items(db, f), [tokenId, paymentId])).toEqual([])
    })
  })

  it("a failed bind with a place: link_conflict and pinned_seat_held, until the session ends", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const r = await approveAs(db, f, {
        productId: f.single,
        eventId,
        amount: 12800,
      })
      const tokenId = r.token_id as string
      const { rows } = await db.query(
        "select id from public.bookings where payment_id = $1",
        [r.payment_id]
      )
      const bookingId = rows[0].id
      await db.query(
        "update public.activation_tokens set state = 'conflict', conflict_reason = 'bind_conflict' where id = $1",
        [tokenId]
      )

      const found = only(await items(db, f), [
        tokenId,
        bookingId,
        r.payment_id as string,
        r.entitlement_id as string,
      ])
      expect(found.map((i) => i.kind).sort()).toEqual([
        "link_conflict",
        "pinned_seat_held",
      ])
      expect(found.find((i) => i.kind === "pinned_seat_held")).toEqual(
        expect.objectContaining({
          id: bookingId,
          event_id: eventId,
          customer_label: DEFAULT_PAYER,
          concept_name: expect.any(String),
          starts_at: expect.any(String),
        })
      )

      // A live replacement link: neither item stays (the old link is
      // revoked).
      await db.query("savepoint before_replacement")
      await issueReplacement(db, f, r.payment_id as string)
      expect(only(await items(db, f), [tokenId, bookingId])).toEqual([])
      await db.query("rollback to savepoint before_replacement")

      // The session ends: only the conflict stays.
      await db.query(
        `update public.events
         set registration_closes_at = now() - interval '4 hours',
             starts_at = now() - interval '3 hours',
             ends_at = now() - interval '1 hour'
         where id = $1`,
        [eventId]
      )
      expect(
        only(await items(db, f), [tokenId, bookingId]).map((i) => i.kind)
      ).toEqual(["link_conflict"])
    })
  })

  it("an unbound purchase whose only link expired (since = its expiry) or was revoked (since = its revoke) is purchase_without_link; a live replacement removes it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const r = await approveAs(db, f, {})
      const paymentId = r.payment_id as string
      const tokenId = r.token_id as string

      expect(only(await items(db, f), [paymentId, tokenId])).toEqual([])

      await db.query(
        "update public.activation_tokens set expires_at = now() - interval '1 minute' where id = $1",
        [tokenId]
      )
      const expired = only(await items(db, f), [paymentId, tokenId])
      expect(expired).toEqual([
        expect.objectContaining({
          kind: "purchase_without_link",
          id: paymentId,
          customer_label: DEFAULT_PAYER,
          product_name: testName("card"),
          amount_agorot: 47200,
          paid_on: f.today,
        }),
      ])
      expect(
        await sameInstant(db, expired[0].since, "expires_at", tokenId)
      ).toBe(true)

      await issueReplacement(db, f, paymentId)
      expect(only(await items(db, f), [paymentId, tokenId])).toEqual([])

      // Another purchase whose only link Tal revoked.
      const other = await approveAs(db, f, {})
      const otherToken = other.token_id as string
      await asAdmin(db, f, () => db.query(REVOKE, [otherToken, randomUUID()]))
      const revoked = only(await items(db, f), [
        other.payment_id as string,
        otherToken,
      ])
      expect(revoked).toEqual([
        expect.objectContaining({
          kind: "purchase_without_link",
          id: other.payment_id,
        }),
      ])
      expect(
        await sameInstant(db, revoked[0].since, "revoked_at", otherToken)
      ).toBe(true)
    })
  })

  it("claiming 16 minutes ago is link_stuck; 14 minutes ago is nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const r = await approveAs(db, f, {})
      const tokenId = r.token_id as string
      const ids = [tokenId, r.payment_id as string]

      await db.query(
        "update public.activation_tokens set state = 'claiming', claiming_at = now() - interval '14 minutes' where id = $1",
        [tokenId]
      )
      expect(only(await items(db, f), ids)).toEqual([])

      await db.query(
        "update public.activation_tokens set claiming_at = now() - interval '16 minutes' where id = $1",
        [tokenId]
      )
      expect(only(await items(db, f), ids)).toEqual([
        expect.objectContaining({
          kind: "link_stuck",
          id: tokenId,
          payment_id: r.payment_id,
          customer_label: DEFAULT_PAYER,
        }),
      ])
    })
  })

  it("a parked pinned entitlement bound to a customer is paid_without_place with her name; revoked, it is gone", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      // The session is full: a booking on an unrelated card payment.
      const card = await approveAs(db, f, { customerId: f.customerA })
      await db.query(
        `insert into public.bookings (
           payment_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'admin', ${SNAPSHOT})`,
        [card.payment_id, eventId]
      )
      const { rows } = await db.query(
        `select private.approve_payment_core(
           'online', null, 'system', $5, $1, $2, 12800, null, $3::date,
           null, null, null, 'test_provider', $4, 'park') as id`,
        [f.single, eventId, f.today, testName("tx"), f.customerB]
      )
      const paymentId = rows[0].id
      const { rows: ent } = await db.query(
        "select id from public.entitlements where payment_id = $1",
        [paymentId]
      )
      const entitlementId = ent[0].id

      const found = only(await items(db, f), [entitlementId])
      expect(found).toEqual([
        expect.objectContaining({
          kind: "paid_without_place",
          id: entitlementId,
          // A bound payment: the customer's full name.
          customer_label: testName("money_b"),
          payment_id: paymentId,
          event_id: eventId,
          product_name: testName("single"),
          amount_agorot: 12800,
          concept_name: expect.any(String),
          starts_at: expect.any(String),
        }),
      ])

      await db.query(
        "update public.entitlements set status = 'revoked' where id = $1",
        [entitlementId]
      )
      expect(only(await items(db, f), [entitlementId])).toEqual([])
    })
  })

  it("an image copying for 16 minutes is media_stuck; 14 minutes or published is nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const [stuck, recent, published] = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ]
      for (const [id, state, minutes] of [
        [stuck, "copying", 16],
        [recent, "copying", 14],
        [published, "published", 30],
      ] as const) {
        await db.query(
          `insert into public.media_assets (
             id, storage_path, public_path, publish_state, publish_started_at)
           values ($1, $2, $3, $4, now() - make_interval(mins => $5::int))`,
          [id, id, `${id}.jpg`, state, minutes]
        )
      }
      expect(only(await items(db, f), [stuck, recent, published])).toEqual([
        expect.objectContaining({
          kind: "media_stuck",
          id: stuck,
          customer_label: null,
          since: expect.any(String),
        }),
      ])
    })
  })

  it("the accessibility statement never published is accessibility_unpublished; its first publish removes it (5.5)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // From the migration's state: the page and its block never published
      // (the shared dev database may hold a published statement).
      await db.query(
        `update public.content_pages
         set published_content = null, published_at = null, published_version = 0
         where slug = 'accessibility'`
      )
      await db.query(
        `update public.content_sections
         set draft_content = null, published_content = null, published_at = null
         where page_slug = 'accessibility'`
      )
      const { rows } = await db.query(
        "select created_at from public.content_pages where slug = 'accessibility'"
      )

      const found = (await items(db, f)).filter(
        (i) => i.kind === "accessibility_unpublished"
      )
      expect(found).toEqual([
        {
          kind: "accessibility_unpublished",
          id: "accessibility",
          customer_label: null,
          since: expect.any(String),
        },
      ])
      expect(new Date(found[0].since as string).getTime()).toBe(
        new Date(rows[0].created_at).getTime()
      )

      await asAdmin(db, f, async () => {
        await db.query(
          "select public.admin_set_content_draft('accessibility', 'statement', $1::jsonb)",
          [
            JSON.stringify({
              body: testName("statement"),
              contact_name: "n",
              contact_phone: "054-4256456",
              contact_email: "a11y@example.test",
            }),
          ]
        )
        await db.query(
          "select public.admin_publish_content('accessibility', $1)",
          [randomUUID()]
        )
      })
      expect(
        (await items(db, f)).filter(
          (i) => i.kind === "accessibility_unpublished"
        )
      ).toEqual([])
    })
  })

  it("a publish that changes nothing keeps accessibility_unpublished (5.5)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        `update public.content_pages
         set published_content = null, published_at = null, published_version = 0
         where slug = 'accessibility'`
      )
      await db.query(
        `update public.content_sections
         set draft_content = null, published_content = null, published_at = null
         where page_slug = 'accessibility'`
      )
      const published = await asAdmin(
        db,
        f,
        async () =>
          (
            await db.query(
              "select public.admin_publish_content('accessibility', $1) as r",
              [randomUUID()]
            )
          ).rows[0].r
      )
      expect(published).toMatchObject({ changed: 0 })
      expect(
        (await items(db, f)).filter(
          (i) => i.kind === "accessibility_unpublished"
        )
      ).toEqual([expect.objectContaining({ id: "accessibility" })])
    })
  })

  it("is ordered by since, newest first", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const [older, newer] = [randomUUID(), randomUUID()]
      for (const [id, minutes] of [
        [older, 40],
        [newer, 20],
      ] as const) {
        await db.query(
          `insert into public.media_assets (
             id, storage_path, public_path, publish_state, publish_started_at)
           values ($1, $2, $3, 'copying', now() - make_interval(mins => $4::int))`,
          [id, id, `${id}.jpg`, minutes]
        )
      }
      expect(only(await items(db, f), [older, newer]).map((i) => i.id)).toEqual(
        [newer, older]
      )
    })
  })
})

describe("admin_get_home", () => {
  it("totals: approved payments of the local month to today by paid_on; the previous month's last day and a voided one are out", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { rows: period } = await db.query(
        `select
           date_trunc('month', (now() at time zone 'Asia/Jerusalem')::date)::date::text as start,
           (date_trunc('month', (now() at time zone 'Asia/Jerusalem')::date)::date - 1)::text as prev`
      )
      const before = (await home(db, f)).totals
      expect(before).toMatchObject({
        period_start: period[0].start,
        period_end: f.today,
      })

      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        const r = await approveAs(db, f, { customerId: f.customerA })
        ids.push(r.payment_id as string)
      }
      // paid_on is a date: the first day of the local month counts, the
      // previous month's last day does not, and a voided payment does not.
      await db.query("update public.payments set paid_on = $1 where id = $2", [
        period[0].start,
        ids[1],
      ])
      await db.query("update public.payments set paid_on = $1 where id = $2", [
        period[0].prev,
        ids[3],
      ])
      await db.query(
        "update public.payments set status = 'voided' where id = $1",
        [ids[4]]
      )

      const after = (await home(db, f)).totals
      expect(after.approved_count - before.approved_count).toBe(3)
      expect(after.approved_agorot - before.approved_agorot).toBe(3 * 47200)
      expect(after.net_agorot).toBe(
        after.approved_agorot - after.refunded_agorot
      )

      // "Recent payments" on the home are the first rows of
      // admin_list_payments: newest created_at first.
      await db.query(
        "update public.payments set created_at = now() + interval '1 minute' where id = $1",
        [ids[0]]
      )
      await db.query(
        "update public.payments set created_at = now() + interval '2 minutes' where id = $1",
        [ids[2]]
      )
      const list = await asAdmin(
        db,
        f,
        async () => (await db.query(PAYMENTS)).rows[0].r
      )
      expect(
        list.slice(0, 2).map((row: { payment_id: string }) => row.payment_id)
      ).toEqual([ids[2], ids[0]])
    })
  })

  it("expiring cards: threshold 21, only days_left 21 with free entries (not 22, not 0 free, not expired, not revoked); the threshold is read at call time", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const cards: string[] = []
      for (let i = 0; i < 5; i++) {
        const r = await approveAs(db, f, { customerId: f.customerA })
        cards.push(r.entitlement_id as string)
      }
      const [in21, in22, empty, expired, revoked] = cards
      await db.query(
        "update public.business_settings set admin_expiring_days = 21"
      )
      await db.query(
        `update public.entitlements
         set expires_on = (now() at time zone 'Asia/Jerusalem')::date + 21
         where id = any($1)`,
        [[in21, empty, revoked]]
      )
      // Within the threshold with free entries, but revoked.
      await db.query(
        "update public.entitlements set status = 'revoked' where id = $1",
        [revoked]
      )
      await db.query(
        `update public.entitlements
         set expires_on = (now() at time zone 'Asia/Jerusalem')::date + 22
         where id = $1`,
        [in22]
      )
      await db.query(
        `update public.entitlements
         set valid_from = (now() at time zone 'Asia/Jerusalem')::date - 60,
             expires_on = (now() at time zone 'Asia/Jerusalem')::date - 1
         where id = $1`,
        [expired]
      )
      await db.query(
        `insert into public.entitlement_movements (entitlement_id, action, units, reason)
         values ($1, 'adjust', -4, 'test')`,
        [empty]
      )

      const mine = (h: Home) =>
        h.expiring_cards.filter((c) =>
          cards.includes(c.entitlement_id as string)
        )
      expect(mine(await home(db, f))).toEqual([
        {
          entitlement_id: in21,
          // The card's customer (story 4.2).
          customer_id: f.customerA,
          customer_label: testName("money_a"),
          product_name: testName("card"),
          available: 4,
          expires_on: expect.any(String),
          days_left: 21,
        },
      ])

      await db.query(
        "update public.business_settings set admin_expiring_days = 22"
      )
      expect(
        mine(await home(db, f)).map((c) => [c.entitlement_id, c.days_left])
      ).toEqual([
        [in21, 21],
        [in22, 22],
      ])
    })
  })

  it("upcoming sessions: published and not ended, with occupied places; a draft and an ended session are out", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // Started a month ago and still running, so it comes first whatever
      // the dev data holds.
      const running = await insertEvent(db, f, {
        startDays: -30,
        hours: 30 * 24 + 1,
        capacity: 9,
      })
      const draft = await insertEvent(db, f, {
        startDays: -30,
        hours: 30 * 24 + 1,
        status: "draft",
      })
      const ended = await insertEvent(db, f, { startDays: -3 })
      const card = await approveAs(db, f, { customerId: f.customerA })
      await db.query(
        `insert into public.bookings (
           payment_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 2, 'admin', ${SNAPSHOT})`,
        [card.payment_id, running]
      )

      const sessions = (await home(db, f)).upcoming_sessions
      expect(sessions.length).toBeLessThanOrEqual(4)
      expect(sessions[0]).toEqual({
        event_id: running,
        concept_name: expect.any(String),
        kind: "regular",
        starts_at: expect.any(String),
        ends_at: expect.any(String),
        occupied: 2,
        capacity: 9,
      })
      const ids = sessions.map((s) => s.event_id)
      expect(ids).not.toContain(draft)
      expect(ids).not.toContain(ended)
    })
  })
})

// Story 3.7: a refund request she opened by cancelling a pinned booking.
describe("refund requests", { timeout: 30_000 }, () => {
  // Customer B's pinned single on a session in 7 days, cancelled by her with
  // a refund. Returns the refund request and the session.
  async function openRefund(db: Db, f: Fixture) {
    const eventId = await insertEvent(db, f)
    const approved = await approveAs(db, f, {
      customerId: f.customerB,
      productId: f.single,
      eventId,
      amount: 12800,
    })
    const { rows: booking } = await db.query(
      "select id from public.bookings where payment_id = $1",
      [approved.payment_id]
    )
    await asAuthenticated(db, f.customerB)
    const { rows } = await db.query(
      "select public.cancel_booking($1, $2, 'refund') as r",
      [booking[0].id, randomUUID()]
    )
    await db.query("reset role")
    return { refundId: rows[0].r.refund_request_id as string, eventId }
  }

  it("an open request: in open_refunds and in 'to handle' (refund_requested); the month's totals do not change", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const before = await home(db, f)
      const { refundId, eventId } = await openRefund(db, f)
      const after = await home(db, f)

      expect(
        after.open_refunds.filter((r) => r.refund_request_id === refundId)
      ).toEqual([
        {
          refund_request_id: refundId,
          customer_id: f.customerB,
          customer_label: testName("money_b"),
          amount_agorot: 12800,
          requested_at: expect.any(String),
          event_id: eventId,
          concept_name: expect.any(String),
          starts_at: expect.any(String),
        },
      ])
      // Only the approval of this test's purchase is new; no refund yet.
      expect(after.totals.approved_count - before.totals.approved_count).toBe(1)
      expect(after.totals.refunded_count).toBe(before.totals.refunded_count)
      expect(after.totals.refunded_agorot).toBe(before.totals.refunded_agorot)

      expect(only(await items(db, f), [refundId])).toEqual([
        {
          kind: "refund_requested",
          id: refundId,
          customer_label: testName("money_b"),
          since: expect.any(String),
          customer_id: f.customerB,
          amount_agorot: 12800,
          event_id: eventId,
          concept_name: expect.any(String),
          starts_at: expect.any(String),
        },
      ])
    })
  })

  it("a completed request (3.9) leaves both lists and counts in the month: net = approved - refunded", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { refundId } = await openRefund(db, f)
      const before = (await home(db, f)).totals
      await db.query(
        "update public.refund_requests set status = 'completed', completed_at = now() where id = $1",
        [refundId]
      )
      const after = await home(db, f)
      expect(after.totals.refunded_count - before.refunded_count).toBe(1)
      expect(after.totals.refunded_agorot - before.refunded_agorot).toBe(12800)
      expect(after.totals.net_agorot).toBe(
        after.totals.approved_agorot - after.totals.refunded_agorot
      )
      expect(
        after.open_refunds.filter((r) => r.refund_request_id === refundId)
      ).toEqual([])
      expect(only(await items(db, f), [refundId])).toEqual([])
    })
  })
})

describe("permissions", () => {
  it("a customer gets NOT_AUTHORIZED on both", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      for (const query of [ITEMS, HOME]) {
        await asAuthenticated(db, f.customerA)
        const error = await queryError(db, query)
        await db.query("reset role")
        expect(error, query).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
    })
  })

  it("anon gets 42501 on both", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      for (const query of [ITEMS, HOME]) {
        expect((await queryError(db, query))?.code, query).toBe("42501")
      }
    })
  })
})
