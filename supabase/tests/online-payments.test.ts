// Online payments with Grow, PR A (spec-online-payments-grow-a.md and the
// umbrella spec-online-payments-grow.md): begin_checkout,
// begin_guest_checkout, checkout_for_confirm, mark_checkout_notified,
// record_online_payment, cancel_checkout, checkout_return,
// private.job_release_holds, the three attention kinds,
// admin_resolve_online_payment_issue, the settings, the checkout rate limit
// and job_cleanup. One test (or more) per row of both I/O matrices; the
// morning search itself is TS (lib/server/privileged/grow.test.ts), so here
// the server's outcome is passed as it would be. Fictitious data only:
// everything runs in inRollback, except the two concurrency tests, which
// commit their fixtures and remove them in onCleanup.

import { randomUUID } from "node:crypto"

import type { PoolClient } from "pg"
import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  getPool,
  inRollback,
  onCleanup,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"
import {
  approve,
  insertProduct,
  seedMoney,
  type MoneyFixture,
} from "./support/money"

const BEGIN = "select public.begin_checkout($1, $2, $3, $4, $5) as r"
const BEGIN_GUEST = "select public.begin_guest_checkout($1, $2, $3, $4) as r"
const FOR_CONFIRM = "select public.checkout_for_confirm($1, $2, $3) as r"
const MARK = "select public.mark_checkout_notified($1, $2) as r"
const RECORD =
  "select public.record_online_payment($1, $2, $3, $4, $5, $6, $7) as r"
const CANCEL = "select public.cancel_checkout($1, $2) as r"
const RETURN = "select public.checkout_return($1, $2) as r"
const RELEASE = "select private.job_release_holds() as r"
const ATTENTION = "select public.admin_get_attention_items() as r"
const RESOLVE = "select public.admin_resolve_online_payment_issue($1, $2) as r"
const CLOSE = "select public.admin_close_unconfirmed_checkout($1, $2) as r"
const CLAIM = "select public.claim_checkouts_to_reconcile($1) as r"
const FORM_CREATED = "select public.mark_checkout_form_created($1, $2) as r"
const SETTINGS =
  "select public.admin_update_business_settings($1::jsonb, $2, $3) as r"
const VOID = "select public.admin_void_purchase($1, $2, $3, $4) as r"
const FILL = "select public.admin_begin_join_fill($1, $2, $3, $4) as r"

type Fixture = MoneyFixture & {
  single: string
  concept: string
}

type Begun = {
  checkout_id: string
  reference: string
  amount_agorot: number
  product_name: string
  product_kind: string
  event_id: string | null
  notify_secret: string
  browser_secret: string
  reissue_required: boolean
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set online_payment_window_minutes = 10, online_hold_grace_minutes = 5,
         public_online_purchase = true,
         cancel_window_hours = 48, reminder_lead_hours = 24`
  )
  const single = await insertProduct(db, {
    label: "online_single",
    type: "single",
    price: 12800,
    units: 1,
    validityMode: "session",
  })
  const { rows } = await db.query(
    "select id from public.concepts where theme_key = 'mothers' and archived_at is null limit 1"
  )
  return { ...f, single, concept: rows[0].id }
}

// As the owner: a published session in `dayOffset` days at 10:00 Jerusalem
// time, open until it starts (or closed a minute ago).
async function insertEvent(
  db: Db,
  f: Fixture,
  options: { capacity?: number; closed?: boolean } = {}
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', $2,
       case when $3::boolean then now() - interval '1 minute' else s.t end,
       true, 'published'
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + 5)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [f.concept, options.capacity ?? 1, options.closed ?? false]
  )
  return rows[0].id
}

async function asRole<T>(
  db: Db,
  role: string | "service",
  fn: () => Promise<T>
): Promise<T> {
  if (role === "service") await asServiceRole(db)
  else await asAuthenticated(db, role)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

async function one(
  db: Db,
  role: string | "service",
  text: string,
  params: unknown[]
): Promise<Record<string, unknown>> {
  return asRole(db, role, async () => (await db.query(text, params)).rows[0].r)
}

async function fails(
  db: Db,
  role: string | "service",
  text: string,
  params: unknown[]
): Promise<string | null> {
  return asRole(db, role, async () => {
    const error = await queryError(db, text, params)
    return error ? error.message : null
  })
}

async function begin(
  db: Db,
  customer: string,
  productId: string,
  eventId: string | null,
  key: string = randomUUID()
): Promise<Begun> {
  return (await one(db, "service", BEGIN, [
    customer,
    productId,
    eventId,
    true,
    key,
  ])) as Begun
}

async function beginGuest(
  db: Db,
  productId: string,
  eventId: string | null,
  key: string = randomUUID()
): Promise<Begun> {
  return (await one(db, "service", BEGIN_GUEST, [
    productId,
    eventId,
    true,
    key,
  ])) as Begun
}

async function record(
  db: Db,
  c: Begun,
  options: {
    doc?: string | null
    outcome?: string
    amount?: number | null
    kind?: "notify" | "browser"
  } = {}
): Promise<Record<string, unknown>> {
  const kind = options.kind ?? "notify"
  return one(db, "service", RECORD, [
    c.checkout_id,
    kind === "notify" ? c.notify_secret : c.browser_secret,
    kind,
    options.doc === undefined ? `doc-${c.reference}` : options.doc,
    options.outcome ?? "verified",
    options.amount === undefined ? c.amount_agorot : options.amount,
    new Date().toISOString(),
  ])
}

async function occupied(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query("select private.occupied_places($1) as n", [
    eventId,
  ])
  return rows[0].n
}

async function checkoutRow(db: Db, id: string) {
  const { rows } = await db.query(
    "select * from public.checkouts where id = $1",
    [id]
  )
  return rows[0]
}

async function issues(db: Db, checkoutId: string) {
  const { rows } = await db.query(
    "select reason, provider_transaction_id, resolved_at from public.online_payment_issues where checkout_id = $1 order by created_at, id",
    [checkoutId]
  )
  return rows
}

async function waitFor(db: Db, customer: string, eventId: string) {
  await db.query(
    "insert into public.waitlist_entries (customer_id, event_id, party_size) values ($1, $2, 1)",
    [customer, eventId]
  )
}

async function waitlistSpots(db: Db, customer: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.notifications where recipient_id = $1 and type = 'waitlist_spot'",
    [customer]
  )
  return rows[0].n
}

async function attention(db: Db, f: Fixture) {
  return (await one(db, f.admin, ATTENTION, [])) as unknown as Array<
    Record<string, unknown>
  >
}

describe("begin_checkout / begin_guest_checkout", { timeout: 60_000 }, () => {
  it("a card without a session: a checkout, no hold, the raw secrets once", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await begin(db, f.customerA, f.card, null)
      expect(c).toMatchObject({
        reference: expect.stringMatching(/^BT-[0-9A-F]{10}$/),
        amount_agorot: 47200,
        product_kind: "days",
        event_id: null,
        reissue_required: false,
      })
      expect(c.notify_secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(c.browser_secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(c.notify_secret).not.toBe(c.browser_secret)
      const row = await checkoutRow(db, c.checkout_id)
      expect(row).toMatchObject({
        customer_id: f.customerA,
        state: "open",
        hold_until: null,
        event_id: null,
      })
      // Only the hashes are stored.
      expect(JSON.stringify(row)).not.toContain(c.notify_secret)
      expect(JSON.stringify(row)).not.toContain(c.browser_secret)
      expect(row.reference).toBe(
        `BT-${c.checkout_id.replace(/-/g, "").slice(0, 10).toUpperCase()}`
      )
    })
  })

  it("a pinned product holds the seat: occupied_places counts it, pay_until + grace", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 2 })
      const c = await beginGuest(db, f.single, eventId)
      expect(await occupied(db, eventId)).toBe(1)
      const { rows } = await db.query(
        `select customer_id, party_size,
           round(extract(epoch from (pay_until - created_at)) / 60) as pay,
           round(extract(epoch from (hold_until - created_at)) / 60) as hold
         from public.checkouts where id = $1`,
        [c.checkout_id]
      )
      expect(rows[0]).toEqual({
        customer_id: null,
        party_size: 1,
        pay: "10",
        hold: "15",
      })
    })
  })

  it("pinned without a session, days with a session: no row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      expect(
        await fails(db, "service", BEGIN, [
          f.customerA,
          f.single,
          null,
          true,
          randomUUID(),
        ])
      ).toBe("PINNED_EVENT_REQUIRED")
      expect(
        await fails(db, "service", BEGIN, [
          f.customerA,
          f.card,
          eventId,
          true,
          randomUUID(),
        ])
      ).toBe("EVENT_NOT_ALLOWED")
      const { rows } = await db.query(
        "select count(*)::int as n from public.checkouts where customer_id = $1",
        [f.customerA]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("a full, closed or already booked session: the self-booking code, no hold", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const full = await insertEvent(db, f, { capacity: 1 })
      await beginGuest(db, f.single, full)
      expect(
        await fails(db, "service", BEGIN, [
          f.customerA,
          f.single,
          full,
          true,
          randomUUID(),
        ])
      ).toBe("EVENT_FULL")

      const closed = await insertEvent(db, f, { capacity: 5, closed: true })
      expect(
        await fails(db, "service", BEGIN, [
          f.customerA,
          f.single,
          closed,
          true,
          randomUUID(),
        ])
      ).toBe("REGISTRATION_CLOSED")

      const booked = await insertEvent(db, f, { capacity: 5 })
      await db.query(
        `insert into public.bookings (customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'customer', '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb)`,
        [f.customerA, booked]
      )
      expect(
        await fails(db, "service", BEGIN, [
          f.customerA,
          f.single,
          booked,
          true,
          randomUUID(),
        ])
      ).toBe("CUSTOMER_ALREADY_BOOKED")
      expect(await occupied(db, booked)).toBe(1)
    })
  })

  it("terms not accepted: TERMS_REQUIRED; inactive or free product: PRODUCT_NOT_PURCHASABLE", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await fails(db, "service", BEGIN, [
          f.customerA,
          f.card,
          null,
          false,
          randomUUID(),
        ])
      ).toBe("TERMS_REQUIRED")
      const inactive = await insertProduct(db, { label: "off", active: false })
      const free = await insertProduct(db, { label: "free", price: 0 })
      for (const product of [inactive, free]) {
        expect(
          await fails(db, "service", BEGIN, [
            f.customerA,
            product,
            null,
            true,
            randomUUID(),
          ])
        ).toBe("PRODUCT_NOT_PURCHASABLE")
      }
    })
  })

  it("a guest while public purchase is off: PUBLIC_PURCHASE_OFF; a customer is not affected", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        "update public.business_settings set public_online_purchase = false"
      )
      expect(
        await fails(db, "service", BEGIN_GUEST, [
          f.card,
          null,
          true,
          randomUUID(),
        ])
      ).toBe("PUBLIC_PURCHASE_OFF")
      expect((await begin(db, f.customerA, f.card, null)).checkout_id).toEqual(
        expect.any(String)
      )
    })
  })

  it("double tap: the same key opens one checkout and one hold; the replay has no secrets", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 3 })
      const key = randomUUID()
      const first = await begin(db, f.customerA, f.single, eventId, key)
      const again = await begin(db, f.customerA, f.single, eventId, key)
      expect(again.checkout_id).toBe(first.checkout_id)
      expect(again.reissue_required).toBe(true)
      expect(again.notify_secret).toBeUndefined()
      expect(again.browser_secret).toBeUndefined()
      expect(await occupied(db, eventId)).toBe(1)
    })
  })

  it("a second open checkout of a customer fails the first, releases its hold and tells the waitlist", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      await waitFor(db, f.customerB, eventId)
      const first = await begin(db, f.customerA, f.single, eventId)
      expect(await occupied(db, eventId)).toBe(1)

      await begin(db, f.customerA, f.card, null)

      expect(await checkoutRow(db, first.checkout_id)).toMatchObject({
        state: "failed",
        closed_at: expect.any(Date),
      })
      expect(await occupied(db, eventId)).toBe(0)
      expect(await waitlistSpots(db, f.customerB)).toBe(1)
    })
  })

  it("a guest's earlier checkout stays open", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const first = await beginGuest(db, f.card, null)
      await beginGuest(db, f.card, null)
      expect((await checkoutRow(db, first.checkout_id)).state).toBe("open")
    })
  })

  it("only the service role: begin_checkout and begin_guest_checkout are denied to authenticated", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await fails(db, f.customerA, BEGIN_GUEST, [
          f.card,
          null,
          true,
          randomUUID(),
        ])
      ).toMatch(/permission denied/)
      expect(
        await fails(db, f.customerA, BEGIN, [
          f.customerA,
          f.card,
          null,
          true,
          randomUUID(),
        ])
      ).toMatch(/permission denied/)
    })
  })

  it("p_auth_uid must be an active customer: an admin, a not activated or an anonymized one is NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const inactive = randomUUID()
      const anonymized = randomUUID()
      await db.query(
        `insert into public.profiles (id, full_name, activated_at, anonymized_at)
         values ($1, $2, null, null), ($3, $4, now(), now())`,
        [inactive, testName("op_inactive"), anonymized, testName("op_anon")]
      )
      for (const uid of [f.admin, inactive, anonymized, randomUUID()]) {
        expect(
          await fails(db, "service", BEGIN, [
            uid,
            f.card,
            null,
            true,
            randomUUID(),
          ]),
          uid
        ).toBe("NOT_AUTHORIZED")
      }
    })
  })

  it("re-holding the same session tells no waitlist; holding another one does", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      await waitFor(db, f.customerB, eventId)
      const first = await begin(db, f.customerA, f.single, eventId)
      const again = await begin(db, f.customerA, f.single, eventId)
      expect((await checkoutRow(db, first.checkout_id)).state).toBe("failed")
      expect((await checkoutRow(db, again.checkout_id)).state).toBe("open")
      expect(await occupied(db, eventId)).toBe(1)
      expect(await waitlistSpots(db, f.customerB)).toBe(0)
    })
  })

  it("the checkout keeps a snapshot of the product's grant fields", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await begin(db, f.customerA, f.card, null)
      expect((await checkoutRow(db, c.checkout_id)).product_snapshot).toEqual({
        type: "card",
        units: 4,
        validity_mode: "days",
        validity_days: 49,
        allowed_weekdays: null,
        eligible_event_kind: "regular",
        party_size: 1,
        intro_only: false,
        price_agorot: 47200,
      })
    })
  })
})

describe("confirm and record", { timeout: 60_000 }, () => {
  it("pinned, new customer: payment + entitlement + booking without a customer, then a join link", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      const c = await beginGuest(db, f.single, eventId)

      expect(
        await one(db, "service", FOR_CONFIRM, [
          c.checkout_id,
          c.notify_secret,
          "notify",
        ])
      ).toEqual({
        state: "open",
        reference: c.reference,
        amount_agorot: 12800,
        created_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })

      const result = await record(db, c)
      expect(result).toEqual({ state: "paid", payment_id: expect.any(String) })
      const paymentId = result.payment_id as string

      const { rows: pay } = await db.query(
        "select customer_id, source, provider, provider_transaction_id, amount_agorot, recorded_by from public.payments where id = $1",
        [paymentId]
      )
      expect(pay[0]).toEqual({
        customer_id: null,
        source: "online",
        provider: "grow",
        provider_transaction_id: `doc-${c.reference}`,
        amount_agorot: 12800,
        recorded_by: null,
      })
      const { rows: booking } = await db.query(
        "select customer_id, status, booked_by from public.bookings where payment_id = $1",
        [paymentId]
      )
      expect(booking).toEqual([
        { customer_id: null, status: "confirmed", booked_by: "system" },
      ])
      expect(await occupied(db, eventId)).toBe(1)
      expect(await checkoutRow(db, c.checkout_id)).toMatchObject({
        state: "paid",
        payment_id: paymentId,
      })

      const back = await one(db, "service", RETURN, [
        c.checkout_id,
        c.browser_secret,
      ])
      expect(back).toEqual({
        state: "paid",
        product_kind: "session",
        event_id: eventId,
        customer_known: false,
        joined: false,
        join_token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      })
    })
  })

  it("return before the notification: the browser secret confirms; a re-issue within 10 minutes of the first link, then blocked", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      expect((await record(db, c, { kind: "browser" })).state).toBe("paid")

      const first = await one(db, "service", RETURN, [
        c.checkout_id,
        c.browser_secret,
      ])
      expect(first.join_token).toEqual(expect.any(String))
      const issuedAt = (await checkoutRow(db, c.checkout_id)).join_issued_at
      expect(issuedAt).toEqual(expect.any(Date))

      // Her first response was lost: within 10 minutes a new link, the
      // previous one revoked; the window does not move.
      const second = await one(db, "service", RETURN, [
        c.checkout_id,
        c.browser_secret,
      ])
      expect(second.join_token).toEqual(expect.any(String))
      expect(second.join_token).not.toBe(first.join_token)
      expect((await checkoutRow(db, c.checkout_id)).join_issued_at).toEqual(
        issuedAt
      )
      const { payment_id: paymentId } = await checkoutRow(db, c.checkout_id)
      const states = async () =>
        (
          await db.query(
            "select state from public.activation_tokens where payment_id = $1",
            [paymentId]
          )
        ).rows
          .map((r) => r.state)
          .sort()
      expect(await states()).toEqual(["pending", "revoked"])

      // After 10 minutes: blocked, no new token.
      await db.query(
        "update public.checkouts set join_issued_at = now() - interval '11 minutes' where id = $1",
        [c.checkout_id]
      )
      const third = await one(db, "service", RETURN, [
        c.checkout_id,
        c.browser_secret,
      ])
      expect(third).toMatchObject({ joined: false, join_blocked: true })
      expect(third.join_token).toBeUndefined()
      expect(await states()).toEqual(["pending", "revoked"])

      // The notification comes after: a replay, nothing new.
      expect(await record(db, c)).toMatchObject({
        payment_id: paymentId,
        replayed: true,
      })
    })
  })

  it("card, logged-in: entitlement on her account, purchase_repeat, no hold, return to her area", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await begin(db, f.customerA, f.card, null)
      const result = await record(db, c)
      const { rows } = await db.query(
        "select customer_id, kind from public.entitlements where payment_id = $1",
        [result.payment_id]
      )
      expect(rows).toEqual([{ customer_id: f.customerA, kind: "card" }])
      const { rows: notes } = await db.query(
        "select type from public.notifications where recipient_id = $1",
        [f.customerA]
      )
      expect(notes.map((n) => n.type)).toEqual(["purchase_repeat"])
      expect(
        await one(db, "service", RETURN, [c.checkout_id, c.browser_secret])
      ).toEqual({
        state: "paid",
        product_kind: "days",
        event_id: null,
        customer_known: true,
      })
    })
  })

  it("duplicate notification: one payment, one entitlement, one booking; the second returns the first", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 2 })
      const c = await beginGuest(db, f.single, eventId)
      const first = await record(db, c)
      const second = await record(db, c)
      expect(second).toEqual({
        state: "paid",
        payment_id: first.payment_id,
        replayed: true,
      })
      const { rows } = await db.query(
        `select
           (select count(*)::int from public.payments where provider_transaction_id = $1) as payments,
           (select count(*)::int from public.entitlements where payment_id = $2) as entitlements,
           (select count(*)::int from public.bookings where payment_id = $2) as bookings`,
        [`doc-${c.reference}`, first.payment_id]
      )
      expect(rows[0]).toEqual({ payments: 1, entitlements: 1, bookings: 1 })
    })
  })

  it("a wrong or missing secret: CHECKOUT_NOT_FOUND everywhere, nothing written", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      const wrong = "w".repeat(43)
      for (const [text, params] of [
        [FOR_CONFIRM, [c.checkout_id, wrong, "notify"]],
        // The browser secret is not the notify secret.
        [FOR_CONFIRM, [c.checkout_id, c.browser_secret, "notify"]],
        [MARK, [c.checkout_id, wrong]],
        [MARK, [c.checkout_id, null]],
        [
          RECORD,
          [c.checkout_id, wrong, "notify", "doc", "verified", 47200, null],
        ],
        [CANCEL, [c.checkout_id, c.notify_secret]],
        [RETURN, [randomUUID(), c.browser_secret]],
      ] as const) {
        expect(await fails(db, "service", text, [...params]), text).toBe(
          "CHECKOUT_NOT_FOUND"
        )
      }
      expect(await checkoutRow(db, c.checkout_id)).toMatchObject({
        state: "open",
        last_notified_at: null,
      })
      expect(await issues(db, c.checkout_id)).toEqual([])
    })
  })

  it("morning down: the notification wrote only the notified times; Grow may retry for 30 minutes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      expect(
        await one(db, "service", MARK, [c.checkout_id, c.notify_secret])
      ).toEqual({ ok: true, retry_allowed: true })
      expect(await checkoutRow(db, c.checkout_id)).toMatchObject({
        state: "open",
        payment_id: null,
        last_notified_at: expect.any(Date),
        first_notified_at: expect.any(Date),
      })

      // first_notified_at is set once: after 30 minutes, no more retries.
      await db.query(
        "update public.checkouts set first_notified_at = now() - interval '31 minutes' where id = $1",
        [c.checkout_id]
      )
      expect(
        await one(db, "service", MARK, [c.checkout_id, c.notify_secret])
      ).toEqual({ ok: true, retry_allowed: false })
      const { rows } = await db.query(
        "select first_notified_at < now() - interval '30 minutes' as old from public.checkouts where id = $1",
        [c.checkout_id]
      )
      expect(rows[0].old).toBe(true)
    })
  })

  it("a checkout no longer open: no retry, even just after the first notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      await one(db, "service", CANCEL, [c.checkout_id, c.browser_secret])
      expect(
        await one(db, "service", MARK, [c.checkout_id, c.notify_secret])
      ).toEqual({ ok: true, retry_allowed: false })
    })
  })

  it("kind 'system' (reconciliation) reads and records without a secret", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      expect(
        await one(db, "service", FOR_CONFIRM, [c.checkout_id, null, "system"])
      ).toMatchObject({ state: "open", reference: c.reference })
      const result = await one(db, "service", RECORD, [
        c.checkout_id,
        null,
        "system",
        "doc-system",
        "verified",
        c.amount_agorot,
        new Date().toISOString(),
      ])
      expect(result.state).toBe("paid")
      // Still service role only.
      expect(
        await fails(db, f.customerA, FOR_CONFIRM, [
          c.checkout_id,
          null,
          "system",
        ])
      ).toMatch(/permission denied/)
    })
  })

  it("claim_checkouts_to_reconcile: unpaid of the last 7 days with a form, past their window, the least recently checked first, stamped", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // Only this test's checkouts count: the others are made too old.
      await db.query(
        "update public.checkouts set created_at = now() - interval '8 days'"
      )
      const formMade = async (c: Begun) =>
        one(db, "service", FORM_CREATED, [c.checkout_id, c.browser_secret])
      const a = await beginGuest(db, f.card, null)
      const b = await beginGuest(db, f.card, null)
      const paid = await beginGuest(db, f.card, null)
      await record(db, paid)
      const old = await beginGuest(db, f.card, null)
      // No form (Grow never answered): skipped.
      const noForm = await beginGuest(db, f.card, null)
      // A form, still inside its pay window: skipped.
      const inWindow = await beginGuest(db, f.card, null)
      for (const c of [a, b, old, inWindow]) await formMade(c)
      await db.query(
        "update public.checkouts set pay_until = now() - interval '1 minute' where id = any($1::uuid[])",
        [[a.checkout_id, b.checkout_id, noForm.checkout_id]]
      )
      expect((await checkoutRow(db, a.checkout_id)).form_created_at).toEqual(
        expect.any(Date)
      )
      await db.query(
        "update public.checkouts set created_at = now() - interval '8 days' where id = $1",
        [old.checkout_id]
      )
      await db.query(
        "update public.checkouts set checked_at = now() - interval '1 hour' where id = $1",
        [a.checkout_id]
      )
      expect(await one(db, "service", CLAIM, [1])).toEqual([b.checkout_id])
      // The array's order is not part of the contract.
      expect(
        ((await one(db, "service", CLAIM, [20])) as unknown as string[]).sort()
      ).toEqual([a.checkout_id, b.checkout_id].sort())
      expect((await checkoutRow(db, b.checkout_id)).checked_at).toEqual(
        expect.any(Date)
      )
      expect(await fails(db, f.customerA, CLAIM, [20])).toMatch(
        /permission denied/
      )
    })
  })

  it("claim also takes a notified checkout without a form, and a closed one Grow notified again; confirming the closed one is only an issue", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        "update public.checkouts set created_at = now() - interval '8 days'"
      )
      // Notified, no form mark (the mark failed after Grow made the form).
      const notified = await beginGuest(db, f.card, null)
      await one(db, "service", MARK, [
        notified.checkout_id,
        notified.notify_secret,
      ])
      await db.query(
        "update public.checkouts set pay_until = now() - interval '1 minute' where id = $1",
        [notified.checkout_id]
      )
      // Tal closed it as unconfirmed; then Grow notified again.
      const closed = await beginGuest(db, f.card, null)
      await one(db, f.admin, CLOSE, [closed.checkout_id, randomUUID()])
      // Closed, never notified again: not taken.
      const quiet = await beginGuest(db, f.card, null)
      await one(db, f.admin, CLOSE, [quiet.checkout_id, randomUUID()])
      await db.query(
        "update public.checkouts set closed_at = now() - interval '5 minutes' where id = any($1::uuid[])",
        [[closed.checkout_id, quiet.checkout_id]]
      )
      await one(db, "service", MARK, [closed.checkout_id, closed.notify_secret])
      // mark_checkout_notified keeps updating last_notified_at.
      expect(
        (await checkoutRow(db, closed.checkout_id)).last_notified_at.getTime()
      ).toBeGreaterThan(
        (await checkoutRow(db, closed.checkout_id)).closed_at.getTime()
      )

      expect(
        ((await one(db, "service", CLAIM, [20])) as unknown as string[]).sort()
      ).toEqual([notified.checkout_id, closed.checkout_id].sort())

      // The reconciliation's confirm on the closed one: late_document.
      expect(
        await one(db, "service", RECORD, [
          closed.checkout_id,
          null,
          "system",
          "doc-after-close",
          "verified",
          closed.amount_agorot,
          new Date().toISOString(),
        ])
      ).toEqual({ state: "issue", issue: "late_document" })
      const { rows } = await db.query(
        "select count(*)::int as n from public.payments where provider_transaction_id = 'doc-after-close'"
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("not verified (no single document) and amount mismatch: an issue, no payment, the hold released", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      await waitFor(db, f.customerB, eventId)
      const many = await beginGuest(db, f.single, eventId)
      expect(
        await record(db, many, {
          doc: null,
          outcome: "not_verified",
          amount: null,
        })
      ).toEqual({ state: "issue", issue: "not_verified" })
      expect(await occupied(db, eventId)).toBe(0)
      expect(await waitlistSpots(db, f.customerB)).toBe(1)

      const wrong = await beginGuest(db, f.card, null)
      // The server says verified, the amount is not the checkout's.
      expect(await record(db, wrong, { amount: 100 })).toEqual({
        state: "issue",
        issue: "amount_mismatch",
      })
      // An issue checkout without a payment is not "paid": another wrong
      // document is its own amount_mismatch, not a second payment.
      expect(
        await record(db, wrong, {
          doc: "other",
          outcome: "amount_mismatch",
          amount: 1,
        })
      ).toEqual({ state: "issue", issue: "amount_mismatch" })
      expect(
        (await issues(db, wrong.checkout_id)).map((i) => i.reason).sort()
      ).toEqual(["amount_mismatch", "amount_mismatch"])
      const { rows } = await db.query(
        "select count(*)::int as n from public.payments where provider_transaction_id like $1",
        [`doc-${wrong.reference}%`]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("an issue checkout never grants: a verified document is late_document (once per document), also after Tal resolved the issue", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      await record(db, c, { doc: null, outcome: "not_verified", amount: null })
      expect((await checkoutRow(db, c.checkout_id)).state).toBe("issue")

      expect(await record(db, c, { doc: "doc-late" })).toEqual({
        state: "issue",
        issue: "late_document",
      })
      // The same document again: the issue is the answer.
      expect(await record(db, c, { doc: "doc-late" })).toMatchObject({
        issue: "late_document",
        replayed: true,
      })

      // Tal resolves them: a later document is still only an issue.
      const { rows: open } = await db.query(
        "select id from public.online_payment_issues where checkout_id = $1 and resolved_at is null",
        [c.checkout_id]
      )
      for (const row of open) {
        await one(db, f.admin, RESOLVE, [row.id, randomUUID()])
      }
      expect(await record(db, c, { doc: "doc-later" })).toEqual({
        state: "issue",
        issue: "late_document",
      })

      const { rows: late } = await db.query(
        "select provider_transaction_id, amount_agorot from public.online_payment_issues where checkout_id = $1 and reason = 'late_document' order by provider_transaction_id",
        [c.checkout_id]
      )
      expect(late).toEqual([
        { provider_transaction_id: "doc-late", amount_agorot: 47200 },
        { provider_transaction_id: "doc-later", amount_agorot: 47200 },
      ])
      expect(await checkoutRow(db, c.checkout_id)).toMatchObject({
        state: "issue",
        payment_id: null,
      })
      const { rows } = await db.query(
        "select count(*)::int as n from public.payments where provider_transaction_id like 'doc-late%'"
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("a price edit alone is not product_changed: the payment lands", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      await db.query(
        "update public.products set price_agorot = 50000 where id = $1",
        [f.card]
      )
      const result = await record(db, c)
      expect(result).toEqual({ state: "paid", payment_id: expect.any(String) })
    })
  })

  it("re-beginning the same session gets the full window and grace again", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      const first = await begin(db, f.customerA, f.single, eventId)
      // As if she began it a while ago: 3 minutes of hold left.
      await db.query(
        "update public.checkouts set hold_until = now() + interval '3 minutes', pay_until = now() + interval '1 minute' where id = $1",
        [first.checkout_id]
      )
      const again = await begin(db, f.customerA, f.single, eventId)
      const { rows } = await db.query(
        `select
           round(extract(epoch from (pay_until - now())) / 60) as pay,
           round(extract(epoch from (hold_until - now())) / 60) as hold
         from public.checkouts where id = $1`,
        [again.checkout_id]
      )
      expect(rows[0]).toEqual({ pay: "10", hold: "15" })
      expect((await checkoutRow(db, first.checkout_id)).state).toBe("failed")
    })
  })

  it("a product edited since the checkout started: product_changed, no payment", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      await db.query("update public.products set units = 8 where id = $1", [
        f.card,
      ])
      expect(await record(db, c)).toEqual({
        state: "issue",
        issue: "product_changed",
      })
      const { rows } = await db.query(
        "select count(*)::int as n from public.payments where provider_transaction_id = $1",
        [`doc-${c.reference}`]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("a customer anonymized since the checkout started: customer_unavailable, no payment", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await begin(db, f.customerA, f.card, null)
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerA]
      )
      expect(await record(db, c)).toEqual({
        state: "issue",
        issue: "customer_unavailable",
      })
      const { rows } = await db.query(
        "select count(*)::int as n from public.payments where provider_transaction_id = $1",
        [`doc-${c.reference}`]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("her other open hold on the session is closed first, so her late payment gets the seat", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      const first = await begin(db, f.customerA, f.single, eventId)
      // A second checkout of the same session (the first one failed).
      const second = await begin(db, f.customerA, f.single, eventId)
      expect((await checkoutRow(db, second.checkout_id)).state).toBe("open")
      // The first one is paid late: the second hold is hers, not a rival.
      const result = await record(db, first)
      expect(result.state).toBe("paid")
      expect((await checkoutRow(db, second.checkout_id)).state).toBe("failed")
      const { rows } = await db.query(
        "select customer_id, status from public.bookings where payment_id = $1",
        [result.payment_id]
      )
      expect(rows).toEqual([{ customer_id: f.customerA, status: "confirmed" }])
    })
  })

  it("a known customer's pinned purchase enqueues no purchase_repeat", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 2 })
      const c = await begin(db, f.customerA, f.single, eventId)
      expect((await record(db, c)).state).toBe("paid")
      const { rows } = await db.query(
        "select type from public.notifications where recipient_id = $1 order by type",
        [f.customerA]
      )
      expect(rows.map((r) => r.type)).not.toContain("purchase_repeat")
    })
  })

  it("another P0001 from the core: approve_failed issue, no payment", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 2 })
      const c = await beginGuest(db, f.single, eventId)
      // The product is deactivated meanwhile ("active" is not in the
      // snapshot): the core raises PRODUCT_NOT_AVAILABLE.
      await db.query(
        "update public.products set active = false where id = $1",
        [f.single]
      )
      expect(await record(db, c)).toEqual({
        state: "issue",
        issue: "approve_failed",
      })
      const { rows } = await db.query(
        "select detail from public.online_payment_issues where checkout_id = $1",
        [c.checkout_id]
      )
      expect(rows[0].detail).toEqual({ code: "PRODUCT_NOT_AVAILABLE" })
    })
  })

  it("a second document on a paid checkout: second_payment, the first payment stays", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      const paid = await record(db, c)
      expect(await record(db, c, { doc: "doc-two" })).toEqual({
        state: "paid",
        issue: "second_payment",
      })
      // And again: the issue is not written twice.
      await record(db, c, { doc: "doc-two" })
      expect(await issues(db, c.checkout_id)).toEqual([
        expect.objectContaining({
          reason: "second_payment",
          provider_transaction_id: "doc-two",
        }),
      ])
      expect((await checkoutRow(db, c.checkout_id)).payment_id).toBe(
        paid.payment_id
      )
    })
  })

  it("paid after cancel_checkout: payment, entitlement and the booking while the seat is free", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      const c = await begin(db, f.customerA, f.single, eventId)
      // She started another checkout: the first one failed.
      await begin(db, f.customerA, f.card, null)
      expect((await checkoutRow(db, c.checkout_id)).state).toBe("failed")

      const result = await record(db, c)
      expect(result.state).toBe("paid")
      const { rows } = await db.query(
        "select customer_id, status from public.bookings where payment_id = $1",
        [result.payment_id]
      )
      expect(rows).toEqual([{ customer_id: f.customerA, status: "confirmed" }])
    })
  })

  it("paid after expiry, the seat taken: payment and entitlement, no booking (paid_without_place)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      const c = await beginGuest(db, f.single, eventId)
      await db.query(
        "update public.checkouts set pay_until = now() - interval '6 minutes', hold_until = now() - interval '1 minute' where id = $1",
        [c.checkout_id]
      )
      expect(
        await db.query(RELEASE).then((r) => r.rows[0].r)
      ).toBeGreaterThanOrEqual(1)
      expect((await checkoutRow(db, c.checkout_id)).state).toBe("expired")
      // Another customer takes the place.
      await db.query(
        `insert into public.bookings (customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $2, 1, 'customer', '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb)`,
        [f.customerB, eventId]
      )

      const result = await record(db, c)
      expect(result.state).toBe("paid")
      const { rows } = await db.query(
        `select
           (select count(*)::int from public.entitlements where payment_id = $1 and status = 'active') as entitlements,
           (select count(*)::int from public.bookings where payment_id = $1) as bookings`,
        [result.payment_id]
      )
      expect(rows[0]).toEqual({ entitlements: 1, bookings: 0 })
      const items = await attention(db, f)
      expect(
        items.some(
          (i) =>
            i.kind === "paid_without_place" &&
            i.payment_id === result.payment_id
        )
      ).toBe(true)
    })
  })

  it("an intro race: intro_not_eligible issue, no payment row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const intro = await insertProduct(db, {
        label: "online_intro",
        type: "intro",
        price: 9900,
        units: 1,
      })
      const c = await begin(db, f.customerA, intro, null)
      // Meanwhile Tal recorded an intro for her by hand.
      await asRole(db, f.admin, () =>
        approve(db, {
          customerId: f.customerA,
          productId: intro,
          amount: 9900,
          paidOn: f.today,
          methodId: f.method,
          key: randomUUID(),
        })
      )
      expect(await record(db, c)).toEqual({
        state: "issue",
        issue: "intro_not_eligible",
      })
      const { rows } = await db.query(
        "select count(*)::int as n from public.payments where provider_transaction_id = $1",
        [`doc-${c.reference}`]
      )
      expect(rows[0].n).toBe(0)
      // The same document again: the issue is the answer.
      expect(await record(db, c)).toMatchObject({
        issue: "intro_not_eligible",
        replayed: true,
      })
    })
  })

  it("record_online_payment, cancel_checkout and checkout_return are service role only", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await begin(db, f.customerA, f.card, null)
      for (const [text, params] of [
        [
          RECORD,
          [
            c.checkout_id,
            c.notify_secret,
            "notify",
            "d",
            "verified",
            47200,
            null,
          ],
        ],
        [CANCEL, [c.checkout_id, c.browser_secret]],
        [RETURN, [c.checkout_id, c.browser_secret]],
        [MARK, [c.checkout_id, c.notify_secret]],
        [FOR_CONFIRM, [c.checkout_id, c.notify_secret, "notify"]],
      ] as const) {
        expect(await fails(db, f.customerA, text, [...params]), text).toMatch(
          /permission denied/
        )
      }
    })
  })
})

describe(
  "release: failure return and the hold job",
  { timeout: 60_000 },
  () => {
    it("failure return: failed, the hold released, the waitlist told", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const eventId = await insertEvent(db, f, { capacity: 1 })
        await waitFor(db, f.customerB, eventId)
        const c = await beginGuest(db, f.single, eventId)
        expect(
          await one(db, "service", CANCEL, [c.checkout_id, c.browser_secret])
        ).toEqual({
          state: "failed",
          product_kind: "session",
          event_id: eventId,
          // A guest's checkout (the failure path picks /sessions or /).
          customer_known: false,
        })
        expect(await occupied(db, eventId)).toBe(0)
        expect(await waitlistSpots(db, f.customerB)).toBe(1)
        // Again: nothing changes.
        await one(db, "service", CANCEL, [c.checkout_id, c.browser_secret])
        expect(await waitlistSpots(db, f.customerB)).toBe(1)
      })
    })

    it("the job expires a hold after hold_until, telling the waitlist as if the hold still counted", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const eventId = await insertEvent(db, f, { capacity: 1 })
        await waitFor(db, f.customerB, eventId)
        const c = await beginGuest(db, f.single, eventId)
        await db.query(
          "update public.checkouts set hold_until = now() - interval '1 second' where id = $1",
          [c.checkout_id]
        )
        // Past hold_until the hold no longer counts, before the job too.
        expect(await occupied(db, eventId)).toBe(0)
        await db.query(RELEASE)
        expect(await checkoutRow(db, c.checkout_id)).toMatchObject({
          state: "expired",
          closed_at: expect.any(Date),
        })
        expect(await waitlistSpots(db, f.customerB)).toBe(1)
      })
    })

    it("the job expires a non-pinned checkout after pay_until + grace, not before", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const c = await beginGuest(db, f.card, null)
        await db.query(
          "update public.checkouts set pay_until = now() - interval '4 minutes' where id = $1",
          [c.checkout_id]
        )
        await db.query(RELEASE)
        expect((await checkoutRow(db, c.checkout_id)).state).toBe("open")
        await db.query(
          "update public.checkouts set pay_until = now() - interval '6 minutes' where id = $1",
          [c.checkout_id]
        )
        await db.query(RELEASE)
        expect((await checkoutRow(db, c.checkout_id)).state).toBe("expired")
      })
    })

    it("release_holds runs every minute", async () => {
      const rows = await sql(
        "select schedule, command from cron.job where jobname = 'release_holds'"
      )
      expect(rows).toEqual([
        {
          schedule: "* * * * *",
          command: "select private.job_release_holds()",
        },
      ])
    })

    it("reconcile_payments runs every 10 minutes", async () => {
      const rows = await sql(
        "select schedule, command from cron.job where jobname = 'reconcile_payments'"
      )
      expect(rows).toEqual([
        {
          schedule: "*/10 * * * *",
          command: "select private.job_reconcile_payments()",
        },
      ])
    })
  }
)

describe("attention and resolve", { timeout: 60_000 }, () => {
  it("never confirmed: online_payment_unconfirmed after 30 minutes of silence", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      await one(db, "service", MARK, [c.checkout_id, c.notify_secret])
      const has = async () =>
        (await attention(db, f)).some(
          (i) =>
            i.kind === "online_payment_unconfirmed" && i.id === c.checkout_id
        )
      await db.query(
        "update public.checkouts set first_notified_at = now() - interval '29 minutes' where id = $1",
        [c.checkout_id]
      )
      expect(await has()).toBe(false)
      await db.query(
        "update public.checkouts set first_notified_at = now() - interval '31 minutes' where id = $1",
        [c.checkout_id]
      )
      expect(await has()).toBe(true)
      // Paid: gone.
      await record(db, c)
      expect(await has()).toBe(false)
    })
  })

  it("unconfirmed is not shown while an unresolved issue exists for the checkout", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      await one(db, "service", MARK, [c.checkout_id, c.notify_secret])
      await db.query(
        "update public.checkouts set first_notified_at = now() - interval '31 minutes' where id = $1",
        [c.checkout_id]
      )
      await db.query(
        "insert into public.online_payment_issues (checkout_id, provider_transaction_id, reason) values ($1, 'x', 'second_payment')",
        [c.checkout_id]
      )
      expect(
        (await attention(db, f)).some(
          (i) =>
            i.kind === "online_payment_unconfirmed" && i.id === c.checkout_id
        )
      ).toBe(false)
    })
  })

  it("Tal closes an unconfirmed checkout: issue, a resolved closed_by_admin row, logged; a later document is a second payment", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f, { capacity: 1 })
      await waitFor(db, f.customerB, eventId)
      const c = await begin(db, f.customerA, f.single, eventId)
      await one(db, "service", MARK, [c.checkout_id, c.notify_secret])
      await db.query(
        "update public.checkouts set first_notified_at = now() - interval '31 minutes' where id = $1",
        [c.checkout_id]
      )

      const key = randomUUID()
      const closed = await one(db, f.admin, CLOSE, [c.checkout_id, key])
      expect(closed).toEqual({ checkout_id: c.checkout_id, state: "issue" })
      expect(await one(db, f.admin, CLOSE, [c.checkout_id, key])).toEqual(
        closed
      )
      expect(await occupied(db, eventId)).toBe(0)
      expect(await waitlistSpots(db, f.customerB)).toBe(1)
      expect(await issues(db, c.checkout_id)).toEqual([
        expect.objectContaining({
          reason: "closed_by_admin",
          resolved_at: expect.any(Date),
        }),
      ])
      expect((await attention(db, f)).some((i) => i.id === c.checkout_id)).toBe(
        false
      )
      const { rows: audit } = await db.query(
        "select before, after, reason from public.audit_log where action = 'admin_close_unconfirmed_checkout' and entity_id = $1",
        [c.checkout_id]
      )
      expect(audit).toEqual([
        {
          before: { state: "open" },
          after: { state: "issue" },
          reason: c.reference,
        },
      ])

      // Tal approved it by hand: the late document never grants again.
      expect(await record(db, c)).toEqual({
        state: "issue",
        issue: "late_document",
      })
      expect(
        await fails(db, f.admin, CLOSE, [c.checkout_id, randomUUID()])
      ).toBe("CHECKOUT_NOT_CLOSABLE")
      expect(
        await fails(db, f.customerA, CLOSE, [c.checkout_id, randomUUID()])
      ).toBe("NOT_AUTHORIZED")
    })
  })

  it("an issue shows until Tal resolves it; the resolve is logged and idempotent", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await begin(db, f.customerA, f.card, null)
      await record(db, c, { amount: 1 })
      const items = await attention(db, f)
      const item = items.find(
        (i) => i.kind === "online_payment_issue" && i.reference === c.reference
      )
      expect(item).toMatchObject({
        reason: "amount_mismatch",
        customer_id: f.customerA,
        amount_agorot: 1,
      })

      const key = randomUUID()
      const resolved = await one(db, f.admin, RESOLVE, [item!.id, key])
      expect(resolved).toEqual({
        issue_id: item!.id,
        resolved_at: expect.any(String),
      })
      expect(await one(db, f.admin, RESOLVE, [item!.id, key])).toEqual(resolved)
      expect((await attention(db, f)).some((i) => i.id === item!.id)).toBe(
        false
      )
      const { rows } = await db.query(
        "select actor_id, customer_id, reason, before, after from public.audit_log where action = 'admin_resolve_online_payment_issue' and entity_id = $1",
        [item!.id]
      )
      expect(rows).toEqual([
        {
          actor_id: f.admin,
          customer_id: f.customerA,
          reason: c.reference,
          before: { resolved_at: null, resolved_by: null },
          after: {
            resolved_at: expect.any(String),
            resolved_by: f.admin,
          },
        },
      ])
      expect(
        await fails(db, f.customerA, RESOLVE, [item!.id, randomUUID()])
      ).toBe("NOT_AUTHORIZED")
    })
  })

  it("the issue item carries the morning document and the checkout's earlier issue", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      await record(db, c, { doc: null, outcome: "not_verified", amount: null })
      const { rows: first } = await db.query(
        "update public.online_payment_issues set created_at = now() - interval '1 hour' where checkout_id = $1 returning id",
        [c.checkout_id]
      )
      await one(db, f.admin, RESOLVE, [first[0].id, randomUUID()])
      await record(db, c, { doc: "doc-late" })

      const item = (await attention(db, f)).find(
        (i) => i.kind === "online_payment_issue" && i.reference === c.reference
      )
      expect(item).toMatchObject({
        reason: "late_document",
        provider_transaction_id: "doc-late",
        earlier_issue: { reason: "not_verified", resolved: true },
      })

      // A first issue has no earlier one.
      const other = await beginGuest(db, f.card, null)
      await record(db, other, { amount: 1 })
      const single = (await attention(db, f)).find(
        (i) =>
          i.kind === "online_payment_issue" && i.reference === other.reference
      )
      expect(single).toMatchObject({
        reason: "amount_mismatch",
        provider_transaction_id: "doc-" + other.reference,
        earlier_issue: null,
      })
    })
  })

  it("an unjoined online purchase: not purchase_without_link; online_purchase_incomplete after 24 hours", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const c = await beginGuest(db, f.card, null)
      const { payment_id: paymentId } = await record(db, c)
      const kinds = async () =>
        (await attention(db, f))
          .filter((i) => i.id === paymentId)
          .map((i) => i.kind)
      expect(await kinds()).toEqual([])
      await db.query(
        "update public.payments set created_at = now() - interval '25 hours' where id = $1",
        [paymentId]
      )
      expect(await kinds()).toEqual(["online_purchase_incomplete"])

      // A live conflict link already shows as link_conflict: one item only.
      await one(db, "service", RETURN, [c.checkout_id, c.browser_secret])
      await db.query(
        "update public.activation_tokens set state = 'conflict', conflict_reason = 'bind_conflict' where payment_id = $1 and state = 'pending'",
        [paymentId]
      )
      const items = await attention(db, f)
      expect(
        items.some(
          (i) => i.kind === "online_purchase_incomplete" && i.id === paymentId
        )
      ).toBe(false)
      expect(
        items.some(
          (i) => i.kind === "link_conflict" && i.payment_id === paymentId
        )
      ).toBe(true)
    })
  })
})

describe(
  "void and assisted join of an online purchase",
  { timeout: 60_000 },
  () => {
    it("admin_void_purchase works as for a manual one", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const eventId = await insertEvent(db, f, { capacity: 1 })
        const c = await beginGuest(db, f.single, eventId)
        const { payment_id: paymentId } = await record(db, c)
        await one(db, f.admin, VOID, [
          paymentId,
          testName("void"),
          true,
          randomUUID(),
        ])
        const { rows } = await db.query(
          `select
           (select status from public.payments where id = $1) as payment,
           (select status from public.entitlements where payment_id = $1) as entitlement,
           (select status from public.bookings where payment_id = $1) as booking`,
          [paymentId]
        )
        expect(rows[0]).toEqual({
          payment: "voided",
          entitlement: "revoked",
          booking: "cancelled",
        })
        expect(await occupied(db, eventId)).toBe(0)
      })
    })

    it("admin_begin_join_fill works unchanged on an unbound online purchase", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const c = await beginGuest(db, f.card, null)
        const { payment_id: paymentId } = await record(db, c)
        await one(db, "service", RETURN, [c.checkout_id, c.browser_secret])
        const digits = String(Date.now() % 10_000_000).padStart(7, "0")
        const result = await one(db, f.admin, FILL, [
          paymentId,
          `${testName("online_fill")}@example.test`.toLowerCase(),
          `058${digits}`,
          randomUUID(),
        ])
        expect(result.outcome).toBe("ready")
        const { rows } = await db.query(
          "select state from public.activation_tokens where payment_id = $1 order by created_at, id",
          [paymentId]
        )
        // One transaction: the same created_at, so compared as a set.
        expect(rows.map((r) => r.state).sort()).toEqual(["pending", "revoked"])
      })
    })

    it("checkout_return after admin_void_purchase: join_blocked, no token", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const c = await beginGuest(db, f.card, null)
        const { payment_id: paymentId } = await record(db, c)
        await one(db, f.admin, VOID, [
          paymentId,
          testName("void"),
          true,
          randomUUID(),
        ])
        expect(
          await one(db, "service", RETURN, [c.checkout_id, c.browser_secret])
        ).toEqual({
          state: "paid",
          product_kind: "days",
          event_id: null,
          customer_known: false,
          joined: false,
          join_blocked: true,
        })
        const { rows } = await db.query(
          "select count(*)::int as n from public.activation_tokens where payment_id = $1 and state <> 'revoked'",
          [paymentId]
        )
        expect(rows[0].n).toBe(0)
      })
    })

    it("checkout_return after the join completed: joined, no token", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const c = await beginGuest(db, f.card, null)
        const { payment_id: paymentId } = await record(db, c)
        // As join_complete leaves it: the payment bound to her.
        await db.query(
          "update public.payments set customer_id = $1 where id = $2",
          [f.customerA, paymentId]
        )
        const back = await one(db, "service", RETURN, [
          c.checkout_id,
          c.browser_secret,
        ])
        expect(back).toMatchObject({ state: "paid", joined: true })
        expect(back.join_token).toBeUndefined()
      })
    })

    it("checkout_return with a live conflict link: join_blocked, the link unchanged", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const c = await beginGuest(db, f.card, null)
        const { payment_id: paymentId } = await record(db, c)
        await one(db, "service", RETURN, [c.checkout_id, c.browser_secret])
        await db.query(
          "update public.activation_tokens set state = 'conflict', conflict_reason = 'bind_conflict' where payment_id = $1 and state = 'pending'",
          [paymentId]
        )
        const back = await one(db, "service", RETURN, [
          c.checkout_id,
          c.browser_secret,
        ])
        expect(back).toMatchObject({ joined: false, join_blocked: true })
        expect(back.join_token).toBeUndefined()
        const { rows } = await db.query(
          "select state from public.activation_tokens where payment_id = $1",
          [paymentId]
        )
        expect(rows).toEqual([{ state: "conflict" }])
      })
    })
  }
)

describe("settings, rate limit and cleanup", { timeout: 60_000 }, () => {
  it("defaults and admin_update_business_settings bounds", async () => {
    await inRollback(async (db) => {
      const { rows: defaults } = await db.query(
        `select column_name, column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'business_settings'
           and column_name in ('online_payment_window_minutes', 'online_hold_grace_minutes', 'public_online_purchase')
         order by column_name`
      )
      expect(defaults).toEqual([
        { column_name: "online_hold_grace_minutes", column_default: "5" },
        { column_name: "online_payment_window_minutes", column_default: "10" },
        { column_name: "public_online_purchase", column_default: "false" },
      ])

      const f = await seed(db)
      const version = async () =>
        (await db.query("select version from public.business_settings")).rows[0]
          .version
      const saved = await one(db, f.admin, SETTINGS, [
        JSON.stringify({
          online_payment_window_minutes: 20,
          online_hold_grace_minutes: 0,
          public_online_purchase: false,
        }),
        await version(),
        randomUUID(),
      ])
      expect(saved).toMatchObject({
        online_payment_window_minutes: 20,
        online_hold_grace_minutes: 0,
        public_online_purchase: false,
      })
      for (const change of [
        { online_payment_window_minutes: 0 },
        { online_payment_window_minutes: 61 },
        { online_hold_grace_minutes: 31 },
        { public_online_purchase: "yes" },
      ]) {
        expect(
          await fails(db, f.admin, SETTINGS, [
            JSON.stringify(change),
            await version(),
            randomUUID(),
          ]),
          JSON.stringify(change)
        ).toBe("INVALID_INPUT")
      }
    })
  })

  it("the checkout bucket: 3 an hour per customer id; the peek checks without counting", async () => {
    await inRollback(async (db) => {
      const id = "id:" + testName("checkout_customer")
      const call = (fn: string, ip: string) =>
        one(db, "service", `select public.${fn}('checkout', $1) as r`, [
          [ip, id],
        ])
      // The peek never counts: as often as she likes, still allowed.
      for (let i = 0; i < 5; i++) {
        expect(
          await call("rate_limit_peek", "ip:" + testName("p" + i))
        ).toEqual({ allowed: true })
      }
      // Each hit from another IP: only the id key can block.
      for (let i = 0; i < 3; i++) {
        expect(await call("rate_limit_hit", "ip:" + testName("c" + i))).toEqual(
          { allowed: true }
        )
      }
      expect(await call("rate_limit_peek", "ip:" + testName("c9"))).toEqual({
        allowed: false,
      })
      expect(await call("rate_limit_hit", "ip:" + testName("c3"))).toEqual({
        allowed: false,
      })
      const { rows } = await db.query(
        "select count(*)::int as n from private.rate_limits where bucket = 'checkout' and key_hash = encode(extensions.digest($1, 'sha256'), 'hex')",
        ["ip:" + testName("p0")]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("the checkout bucket: 10 an hour per IP", async () => {
    await inRollback(async (db) => {
      const ip = `ip:${testName("checkout")}`
      const hit = () =>
        one(
          db,
          "service",
          "select public.rate_limit_hit('checkout', $1) as r",
          // A guest's checkout sends the IP key only.
          [[ip]]
        )
      for (let i = 0; i < 10; i++) {
        expect(await hit()).toEqual({ allowed: true })
      }
      expect(await hit()).toEqual({ allowed: false })
      const { rows } = await db.query(
        "select window_start = date_trunc('hour', now()) as hourly from private.rate_limits where bucket = 'checkout' limit 1"
      )
      expect(rows[0].hourly).toBe(true)
    })
  })

  it("job_cleanup deletes failed and expired checkouts older than 90 days, keeps a notified one and one with an issue", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const old = await beginGuest(db, f.card, null)
      const young = await beginGuest(db, f.card, null)
      const withIssue = await beginGuest(db, f.card, null)
      const notified = await beginGuest(db, f.card, null)
      const recent = await beginGuest(db, f.card, null)
      await one(db, "service", MARK, [
        notified.checkout_id,
        notified.notify_secret,
      ])
      for (const c of [notified, recent]) {
        await one(db, "service", CANCEL, [c.checkout_id, c.browser_secret])
      }
      await one(db, "service", CANCEL, [old.checkout_id, old.browser_secret])
      await one(db, "service", CANCEL, [
        young.checkout_id,
        young.browser_secret,
      ])
      await record(db, withIssue, {
        doc: null,
        outcome: "not_verified",
        amount: null,
      })
      await db.query(
        "update public.checkouts set created_at = now() - interval '91 days' where id = any($1::uuid[])",
        [[old.checkout_id, withIssue.checkout_id, notified.checkout_id]]
      )
      await db.query(
        "update public.checkouts set created_at = now() - interval '60 days' where id = $1",
        [recent.checkout_id]
      )
      await db.query("select private.job_cleanup()")
      const { rows } = await db.query(
        "select id from public.checkouts where id = any($1::uuid[]) order by id",
        [
          [
            old.checkout_id,
            young.checkout_id,
            withIssue.checkout_id,
            notified.checkout_id,
            recent.checkout_id,
          ],
        ]
      )
      expect(rows.map((r) => r.id).sort()).toEqual(
        [
          young.checkout_id,
          withIssue.checkout_id,
          notified.checkout_id,
          recent.checkout_id,
        ].sort()
      )
    })
  })

  it("checkouts and online_payment_issues: RLS on, no API role can read them", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { rows } = await db.query(
        `select relname, relrowsecurity from pg_class
         where oid in ('public.checkouts'::regclass, 'public.online_payment_issues'::regclass)
         order by relname`
      )
      expect(rows).toEqual([
        { relname: "checkouts", relrowsecurity: true },
        { relname: "online_payment_issues", relrowsecurity: true },
      ])
      for (const table of ["checkouts", "online_payment_issues"]) {
        for (const role of [f.customerA, "service"] as const) {
          expect(
            await fails(db, role, `select count(*) from public.${table}`, []),
            `${table} ${role}`
          ).toMatch(/permission denied/)
        }
      }
    })
  })
})

// --- Concurrency: committed fixtures, two connections -----------------------

async function waitsOnLock(watcher: PoolClient, pid: number): Promise<boolean> {
  for (let tries = 0; tries < 50; tries++) {
    await watcher.query("select pg_stat_clear_snapshot()")
    const { rows } = await watcher.query<{ wait_event_type: string | null }>(
      "select wait_event_type from pg_stat_activity where pid = $1",
      [pid]
    )
    if (rows[0]?.wait_event_type === "Lock") return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

type Committed = {
  customers: string[]
  product: string
  eventId: string
}

// A session of capacity 1, a pinned product and two customers, committed and
// removed in onCleanup with everything an online payment creates for them.
async function seedCommitted(label: string): Promise<Committed> {
  const customers = [randomUUID(), randomUUID()]
  const product = randomUUID()
  const eventId = randomUUID()

  onCleanup(async () => {
    const client = await getPool().connect()
    try {
      await client.query("begin")
      const payments = "select id from public.payments where product_id = $1"
      await client.query(
        "delete from public.notifications where recipient_id = any($1::uuid[])",
        [customers]
      )
      await client.query(
        "delete from public.audit_log where event_id = $1 or customer_id = any($2::uuid[])",
        [eventId, customers]
      )
      await client.query(
        "delete from private.idempotency_results where actor_scope = any($1::text[])",
        [customers]
      )
      await client.query(
        `delete from public.online_payment_issues where checkout_id in (
           select id from public.checkouts where product_id = $1)`,
        [product]
      )
      await client.query("delete from public.checkouts where product_id = $1", [
        product,
      ])
      await client.query(
        `delete from public.activation_tokens where payment_id in (${payments})`,
        [product]
      )
      await client.query(
        "delete from public.booking_allocations where booking_id in (select id from public.bookings where event_id = $1)",
        [eventId]
      )
      await client.query(
        "alter table public.entitlement_movements disable trigger entitlement_movements_no_update_delete"
      )
      await client.query(
        `delete from public.entitlement_movements where entitlement_id in (
           select id from public.entitlements where payment_id in (${payments}))`,
        [product]
      )
      await client.query(
        "alter table public.entitlement_movements enable trigger entitlement_movements_no_update_delete"
      )
      await client.query("delete from public.bookings where event_id = $1", [
        eventId,
      ])
      await client.query(
        `delete from public.entitlements where payment_id in (${payments})`,
        [product]
      )
      await client.query("delete from public.payments where product_id = $1", [
        product,
      ])
      await client.query("delete from public.events where id = $1", [eventId])
      await client.query("delete from public.products where id = $1", [product])
      await client.query(
        "delete from public.profiles where id = any($1::uuid[])",
        [customers]
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => {})
      throw error
    } finally {
      client.release()
    }
  })

  await sql(
    `insert into public.profiles (id, full_name, activated_at)
     values ($1, $2, now()), ($3, $4, now())`,
    [customers[0], testName(`${label}_a`), customers[1], testName(`${label}_b`)]
  )
  await sql(
    `insert into public.products (
       id, name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, $2, 'single', 12800, 1, 'session', null, null, 'regular', 1)`,
    [product, testName(`${label}_single`)]
  )
  await sql(
    `insert into public.events (
       id, concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, c.id, 'regular', now() + interval '5 days',
       now() + interval '5 days 2 hours', 1, now() + interval '4 days', true,
       'published'
     from public.concepts c where c.theme_key = 'mothers' limit 1`,
    [eventId]
  )
  return { customers, product, eventId }
}

describe("concurrency", { timeout: 60_000 }, () => {
  it("two begin_checkout calls for the last seat: exactly one gets a hold", async () => {
    const f = await seedCommitted("hold_race")
    const a = await getPool().connect()
    const b = await getPool().connect()
    try {
      await a.query("begin")
      await asServiceRole(a)
      await a.query(BEGIN, [
        f.customers[0],
        f.product,
        f.eventId,
        true,
        randomUUID(),
      ])

      await b.query("begin")
      await asServiceRole(b)
      const { rows: pid } = await b.query("select pg_backend_pid() as pid")
      const second = b.query(BEGIN, [
        f.customers[1],
        f.product,
        f.eventId,
        true,
        randomUUID(),
      ])
      second.catch(() => {})

      await a.query("reset role")
      expect(await waitsOnLock(a, pid[0].pid)).toBe(true)
      await a.query("commit")

      await expect(second).rejects.toMatchObject({
        code: "P0001",
        message: "EVENT_FULL",
      })
      await b.query("rollback")

      // The pool holds two clients (a, b): read on a, never a third one.
      const { rows } = await a.query<{ customer_id: string }>(
        "select customer_id from public.checkouts where event_id = $1 and state = 'open'",
        [f.eventId]
      )
      expect(rows).toEqual([{ customer_id: f.customers[0] }])
    } finally {
      await a.query("rollback").catch(() => {})
      await b.query("rollback").catch(() => {})
      a.release()
      b.release()
    }
  })

  it("the same notification twice at once: one payment, one entitlement, one booking", async () => {
    const f = await seedCommitted("notify_race")
    // The checkout, committed: begun by the first customer.
    const starter = await getPool().connect()
    let c: Begun
    try {
      await starter.query("begin")
      await asServiceRole(starter)
      const { rows } = await starter.query(BEGIN, [
        f.customers[0],
        f.product,
        f.eventId,
        true,
        randomUUID(),
      ])
      c = rows[0].r
      await starter.query("commit")
    } catch (error) {
      await starter.query("rollback").catch(() => {})
      throw error
    } finally {
      starter.release()
    }
    const params = [
      c.checkout_id,
      c.notify_secret,
      "notify",
      `doc-${c.reference}`,
      "verified",
      12800,
      new Date().toISOString(),
    ]

    const a = await getPool().connect()
    const b = await getPool().connect()
    try {
      await a.query("begin")
      await asServiceRole(a)
      const first = await a.query(RECORD, params)

      await b.query("begin")
      await asServiceRole(b)
      const { rows: pid } = await b.query("select pg_backend_pid() as pid")
      const second = b.query(RECORD, params)
      second.catch(() => {})

      await a.query("reset role")
      expect(await waitsOnLock(a, pid[0].pid)).toBe(true)
      await a.query("commit")

      const replay = await second
      await b.query("commit")
      expect(replay.rows[0].r).toEqual({
        state: "paid",
        payment_id: first.rows[0].r.payment_id,
        replayed: true,
      })

      // The pool holds two clients (a, b): read on a, never a third one.
      const {
        rows: [counts],
      } = await a.query(
        `select
           (select count(*)::int from public.payments where provider_transaction_id = $1) as payments,
           (select count(*)::int from public.entitlements where payment_id = $2) as entitlements,
           (select count(*)::int from public.bookings where payment_id = $2) as bookings`,
        [`doc-${c.reference}`, first.rows[0].r.payment_id]
      )
      expect(counts).toEqual({ payments: 1, entitlements: 1, bookings: 1 })
    } finally {
      await a.query("rollback").catch(() => {})
      await b.query("rollback").catch(() => {})
      a.release()
      b.release()
    }
  })
})
