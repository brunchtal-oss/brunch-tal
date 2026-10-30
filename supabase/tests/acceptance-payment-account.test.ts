// Story 6.6: the acceptance suite, "payment and account" (P1-P9) and the
// payment and purchase-binding completions (SP1, SP7, SP8). Each test
// proves a claim the story-by-story tests left missing or weak (T1-T7,
// T20, T23, T24 of the spec's coverage map). Everything runs in inRollback;
// Auth users are rows in auth.users inside the rolled-back transaction.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  insertAuthUser,
  queryError,
  testName,
  type Db,
} from "./support/db"
import {
  APPROVE,
  approve,
  approveParams,
  seedMoney,
  type MoneyFixture,
} from "./support/money"

const BEGIN = "select public.join_begin($1, $2, $3, $4) as r"
const COMPLETE = "select public.join_complete($1, $2::jsonb, $3) as r"
const VIEW = "select public.token_view($1) as r"
const CLAIM = "select public.claim_join($1, $2) as r"
const PREVIEW =
  "select public.preview_admin_approve_payment($1, $2, $3, $4, $5, $6::date, $7) as r"
const ITEMS = "select public.admin_get_attention_items() as r"
const MY_CREDITS = "select public.get_my_credits() as r"
const CHOOSE = "select public.choose_credit_outcome($1, $2, $3) as r"
const PHONE = "select public.admin_change_phone($1, $2, $3) as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Approved = {
  f: MoneyFixture
  token: string
  tokenId: string
  paymentId: string
}

// As the owner on return: a card approved for a new customer.
async function approveCard(db: Db, f?: MoneyFixture): Promise<Approved> {
  const fixture = f ?? (await seedMoney(db))
  await asAuthenticated(db, fixture.admin)
  const r = await approve(db, {
    productId: fixture.card,
    amount: 47200,
    paidOn: fixture.today,
    methodId: fixture.method,
    duplicateConfirmed: true,
    key: randomUUID(),
  })
  await db.query("reset role")
  return {
    f: fixture,
    token: r.token as string,
    tokenId: r.token_id as string,
    paymentId: r.payment_id as string,
  }
}

// A phone of this run (05X), apart from the other files' ranges.
let phoneCounter = 0
function testPhone(): string {
  phoneCounter++
  const digits = (parseInt(testName("").slice(5, 11), 16) + 900 + phoneCounter)
    .toString()
    .padStart(7, "0")
    .slice(-7)
  return `058${digits}`
}

function e164(local: string): string {
  return `+972${local.slice(1)}`
}

function emailOf(label: string): string {
  return `${testName(label)}@example.test`.toLowerCase()
}

function profile(email: string, phone: string) {
  return {
    email,
    phone,
    full_name: testName("joiner"),
    dietary_notes: null,
    privacy_consent: true,
    photo_consent: false,
    personal_photo_consent: false,
    babies: [{ name: testName("baby"), birth_date: "2026-09-01" }],
  }
}

async function call(db: Db, query: string, params: unknown[]) {
  await asServiceRole(db)
  const { rows } = await db.query(query, params)
  await db.query("reset role")
  return rows[0].r as Record<string, unknown>
}

async function callError(db: Db, query: string, params: unknown[]) {
  await asServiceRole(db)
  const error = await queryError(db, query, params)
  await db.query("reset role")
  return error
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

async function claimAs(db: Db, userId: string, token: string) {
  return as(
    db,
    userId,
    async () =>
      (await db.query(CLAIM, [token, randomUUID()])).rows[0].r as Record<
        string,
        unknown
      >
  )
}

// begin -> Auth user (pending_user_id) -> complete, as the TS orchestrator.
async function join(db: Db, a: Approved, label: string, phone = testPhone()) {
  const email = emailOf(label)
  const key = randomUUID()
  const begun = await call(db, BEGIN, [a.token, email, phone, key])
  expect(begun.outcome).toBe("claiming")
  const userId = begun.pending_user_id as string
  await insertAuthUser(db, label, { id: userId })
  const done = await call(db, COMPLETE, [
    a.token,
    JSON.stringify(profile(email, phone)),
    key,
  ])
  expect(done.outcome).toBe("joined")
  return { email, phone, userId }
}

async function count(db: Db, text: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from (${text}) q`,
    params
  )
  return rows[0].n
}

async function tokenRow(db: Db, tokenId: string) {
  const { rows } = await db.query(
    "select * from public.activation_tokens where id = $1",
    [tokenId]
  )
  return rows[0]
}

// The customer of the payment, its entitlement and its booking (if any).
async function boundTo(db: Db, paymentId: string) {
  const { rows } = await db.query(
    `select
       (select customer_id from public.payments where id = $1) as payment,
       (select customer_id from public.entitlements where payment_id = $1) as entitlement,
       (select array_agg(customer_id) from public.bookings where payment_id = $1) as bookings`,
    [paymentId]
  )
  return rows[0]
}

// Customer `id` (a profile of seedMoney) gets an Auth user and a phone.
async function giveAccount(db: Db, id: string, label: string) {
  const { email } = await insertAuthUser(db, label, { id })
  const phone = testPhone()
  await db.query("update public.profiles set phone_e164 = $1 where id = $2", [
    e164(phone),
    id,
  ])
  return { email, phone }
}

// As the owner: a pinned product (validity_mode session, every weekday).
async function insertPinned(
  db: Db,
  label: string,
  type: "single" | "intro"
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size, intro_only)
     values ($1, $2, 12800, 1, 'session', null, null, 'regular', 1, $3)
     returning id`,
    [testName(label), type, type === "intro"]
  )
  return rows[0].id
}

// As the owner: a published regular session `days` from now, 2 hours.
async function insertEvent(db: Db, days = 7): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     select c.id, 'regular', now() + make_interval(days => $1::int),
       now() + make_interval(days => $1::int) + interval '2 hours', 12,
       now() + make_interval(days => $1::int), 'published'
     from public.concepts c where c.theme_key = 'mothers' limit 1
     returning id`,
    [days]
  )
  return rows[0].id
}

// As the admin: a pinned product approved for `customerId` (null: a new
// customer) on the session.
async function approvePinned(
  db: Db,
  f: MoneyFixture,
  productId: string,
  eventId: string,
  customerId: string | null = null
) {
  return as(db, f.admin, () =>
    approve(db, {
      customerId,
      productId,
      eventId,
      amount: 12800,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
}

describe("P1: one customer and one purchase", () => {
  it("T1: a double click, a second click with a new key and a join with retries leave one Auth user, one profile, one payment, one entitlement and one grant", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const input = {
        productId: f.card,
        amount: 47200,
        paidOn: f.today,
        methodId: f.method,
        key: randomUUID(),
      }
      // (1) A double click: the same key twice.
      const first = await approve(db, input)
      const again = await approve(db, input)
      expect(again.payment_id).toBe(first.payment_id)
      expect(again.token_id).toBe(first.token_id)
      // (2) A second click after a reload (a new key) without confirming.
      expect(
        await queryError(
          db,
          APPROVE,
          approveParams({ ...input, key: randomUUID() })
        )
      ).toMatchObject({ code: "P0001", message: "DUPLICATE_CONFIRM_REQUIRED" })
      await db.query("reset role")
      expect(
        await count(db, "select 1 from public.payments where product_id = $1", [
          f.card,
        ])
      ).toBe(1)

      // (3) The join with retries: a reload during claiming (a new key)
      // gets the same pending user; complete is repeated.
      const label = "t1_joiner"
      const email = emailOf(label)
      const phone = testPhone()
      const token = first.token as string
      const begun = await call(db, BEGIN, [token, email, phone, randomUUID()])
      expect(begun.outcome).toBe("claiming")
      const userId = begun.pending_user_id as string
      await insertAuthUser(db, label, { id: userId })
      const key = randomUUID()
      expect(await call(db, BEGIN, [token, email, phone, key])).toEqual(begun)
      const body = JSON.stringify(profile(email, phone))
      const done = await call(db, COMPLETE, [token, body, key])
      expect(done).toMatchObject({ outcome: "joined", customer_id: userId })
      expect(await call(db, COMPLETE, [token, body, key])).toEqual(done)
      expect(
        await callError(db, COMPLETE, [token, body, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "LINK_USED" })
      expect(
        await callError(db, BEGIN, [token, email, phone, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "LINK_USED" })

      expect(
        await count(db, "select 1 from auth.users where lower(email) = $1", [
          email,
        ])
      ).toBe(1)
      const { rows: profiles } = await db.query(
        "select id from public.profiles where phone_e164 = $1",
        [e164(phone)]
      )
      expect(profiles).toEqual([{ id: userId }])
      const { rows: payments } = await db.query(
        "select id, customer_id from public.payments where product_id = $1",
        [f.card]
      )
      expect(payments).toEqual([{ id: first.payment_id, customer_id: userId }])
      const { rows: entitlements } = await db.query(
        `select e.id, e.customer_id from public.entitlements e
         join public.payments p on p.id = e.payment_id
         where p.product_id = $1`,
        [f.card]
      )
      expect(entitlements).toEqual([
        { id: expect.any(String), customer_id: userId },
      ])
      expect(
        await count(
          db,
          "select 1 from public.entitlement_movements where entitlement_id = $1 and action = 'grant'",
          [entitlements[0].id]
        )
      ).toBe(1)
    })
  })
})

describe("P2: one phone in two formats", () => {
  it("T2: after joining with 05X, a second link opened with +972 finds her account", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const { userId, phone } = await join(db, a, "t2_joiner")
      expect(phone.startsWith("05")).toBe(true)

      const second = await approveCard(db, a.f)
      const result = await call(db, BEGIN, [
        second.token,
        emailOf("t2_other_mail"),
        e164(phone),
        randomUUID(),
      ])
      expect(result).toEqual({
        outcome: "existing_account",
        token_id: second.tokenId,
      })
      expect(await tokenRow(db, second.tokenId)).toMatchObject({
        state: "awaiting_login",
        bound_user_id: userId,
        pending_user_id: null,
      })
      expect(await claimAs(db, userId, second.token)).toEqual({
        outcome: "claimed",
        payment_id: second.paymentId,
      })
      expect(await boundTo(db, second.paymentId)).toMatchObject({
        payment: userId,
        entitlement: userId,
      })
    })
  })
})

describe("P3: the activation link", () => {
  it("T3: an approval link lasts exactly 48 hours, also after every setting and the product's validity change; no link or token setting exists", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const hours = async (tokenId: string) => {
        const { rows } = await db.query(
          `select expires_at - now() = interval '48 hours' as exact,
             extract(epoch from expires_at - now())::int as secs
           from public.activation_tokens where id = $1`,
          [tokenId]
        )
        return rows[0]
      }
      const before = await approveCard(db, f)
      expect(await hours(before.tokenId)).toEqual({
        exact: true,
        secs: 48 * 3600,
      })

      // Every integer and time setting moves (one step up, or down when a
      // check refuses it); the card's validity changes too.
      const { rows: columns } = await db.query<{
        name: string
        type: string
      }>(
        `select column_name as name, data_type as type
         from information_schema.columns
         where table_schema = 'public' and table_name = 'business_settings'
           and column_name <> 'version'
           and data_type in ('integer', 'time without time zone')
         order by ordinal_position`
      )
      expect(columns.length).toBeGreaterThan(10)
      const changed: string[] = []
      for (const { name, type } of columns) {
        const step = type === "integer" ? "1" : "interval '30 minutes'"
        for (const op of ["+", "-"]) {
          const error = await queryError(
            db,
            `update public.business_settings set ${name} = ${name} ${op} ${step}`
          )
          if (!error) {
            changed.push(name)
            break
          }
        }
      }
      expect(changed).toEqual(columns.map((c) => c.name))
      // The other columns cannot carry a link lifetime (the row key, an
      // array of prep days, the marketing schedule, the last edit); a new
      // column of another type fails here until it is looked at.
      const { rows: others } = await db.query<{ name: string }>(
        `select column_name as name
         from information_schema.columns
         where table_schema = 'public' and table_name = 'business_settings'
           and column_name <> 'version'
           and data_type not in ('integer', 'time without time zone')
         order by 1`
      )
      expect(others.map((c) => c.name)).toEqual([
        "default_prep_days",
        "id",
        "marketing_reminder_schedule",
        "updated_at",
      ])
      await db.query(
        "update public.products set validity_days = 7 where id = $1",
        [f.card]
      )

      const after = await approveCard(db, f)
      expect(await hours(after.tokenId)).toEqual({
        exact: true,
        secs: 48 * 3600,
      })

      const { rows: settings } = await db.query(
        `select table_name, column_name from information_schema.columns
         where table_schema = 'public'
           and table_name in ('business_settings', 'products')
           and (column_name like '%link%' or column_name like '%token%')`
      )
      expect(settings).toEqual([])
    })
  })

  it("T4: token_view three times on a pending and on an awaiting_login link changes no field of the link and binds nothing", async () => {
    await inRollback(async (db) => {
      const pending = await approveCard(db)
      const awaiting = await approveCard(db, pending.f)
      const account = await giveAccount(db, pending.f.customerA, "t4_acc")
      expect(
        await call(db, BEGIN, [
          awaiting.token,
          account.email,
          testPhone(),
          randomUUID(),
        ])
      ).toMatchObject({ outcome: "existing_account" })

      for (const [a, state] of [
        [pending, "pending"],
        [awaiting, "awaiting_login"],
      ] as const) {
        const before = await tokenRow(db, a.tokenId)
        expect(before.state).toBe(state)
        for (let i = 0; i < 3; i++) {
          expect(await call(db, VIEW, [a.token])).toMatchObject({
            state_public: state === "pending" ? "active" : "awaiting_login",
          })
        }
        const after = await tokenRow(db, a.tokenId)
        expect(after).toEqual(before)
        expect(after).toMatchObject({
          consumed_at: null,
          claiming_at: null,
          identity_attempts: before.identity_attempts,
        })
        expect(await boundTo(db, a.paymentId)).toMatchObject({
          payment: null,
          entitlement: null,
        })
      }
      expect(
        await count(
          db,
          "select 1 from public.notifications where recipient_id = $1",
          [pending.f.customerA]
        )
      ).toBe(0)
    })
  })
})

describe("P4: a reset link", () => {
  it("T5: shows only its state, purpose and expiry, nothing of A or B, and resets A alone", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const a = await giveAccount(db, f.customerA, "t5_a")
      const b = await giveAccount(db, f.customerB, "t5_b")

      await asServiceRole(db)
      const { rows: issued } = await db.query(
        "select public.issue_reset_token($1) as r",
        [f.customerA]
      )
      await db.query("reset role")
      const token = issued[0].r.token as string

      const view = await call(db, VIEW, [token])
      expect(view).toEqual({
        state_public: "active",
        purpose: "reset",
        product_name: null,
        amount_agorot: null,
        session_starts_at: null,
        concept_name: null,
        bound_user_id: null,
        conflict_reason: null,
        expires_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
      const text = JSON.stringify(view)
      for (const secret of [
        testName("money_a"),
        testName("money_b"),
        a.email,
        b.email,
        a.phone,
        b.phone,
        e164(a.phone),
        e164(b.phone),
        f.customerA,
        f.customerB,
      ]) {
        expect(text).not.toContain(secret)
      }

      const rowsOfB = async () => {
        const { rows } = await db.query(
          `select
             (select row_to_json(p)::text from public.profiles p where p.id = $1) as profile,
             (select row_to_json(u)::text from auth.users u where u.id = $1) as auth_user,
             (select count(*)::int from public.activation_tokens t where t.customer_id = $1 or t.bound_user_id = $1) as tokens`,
          [f.customerB]
        )
        return rows[0]
      }
      const before = await rowsOfB()
      const done = await call(db, "select public.reset_complete($1, $2) as r", [
        token,
        randomUUID(),
      ])
      expect(done).toMatchObject({ user_id: f.customerA })
      expect(JSON.stringify(done)).not.toContain(f.customerB)
      expect(await rowsOfB()).toEqual(before)
    })
  })
})

describe("P7: consent", () => {
  it("T6: privacy_consent_at is the time of the join (now())", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const { userId } = await join(db, a, "t6_joiner")
      const { rows } = await db.query(
        "select privacy_consent_at = now() as at_join from public.profiles where id = $1",
        [userId]
      )
      expect(rows).toEqual([{ at_join: true }])
    })
  })
})

describe("P9: no self change of phone or email", () => {
  it("T7: phone_change in auth.users is blocked, pending_email in profiles is refused, and Tal's change to another account's number (05X) is taken", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await giveAccount(db, f.customerA, "t7_a")
      const b = await giveAccount(db, f.customerB, "t7_b")

      expect(
        await queryError(
          db,
          "update auth.users set phone_change = $2 where id = $1",
          [f.customerA, "972591234567"]
        )
      ).toMatchObject({ code: "P0001", message: "ACCOUNT_CHANGE_BLOCKED" })

      await asAuthenticated(db, f.customerA)
      expect(
        await queryError(
          db,
          "update public.profiles set pending_email = $2 where id = $1",
          [f.customerA, emailOf("t7_self")]
        )
      ).toMatchObject({ code: "42501" })
      await db.query("reset role")

      const phoneOf = async (id: string) =>
        (
          await db.query(
            "select phone_e164 from public.profiles where id = $1",
            [id]
          )
        ).rows[0].phone_e164
      const mine = await phoneOf(f.customerA)
      const result = await as(
        db,
        f.admin,
        async () =>
          (await db.query(PHONE, [f.customerA, b.phone, randomUUID()])).rows[0]
            .r
      )
      expect(result).toEqual({ result: "taken" })
      expect(await phoneOf(f.customerA)).toBe(mine)
      expect(await phoneOf(f.customerB)).toBe(e164(b.phone))
    })
  })
})

describe("SP1: the preview of a pinned product", () => {
  it("T20: event_starts_at of the preview is the stored session's start", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const single = await insertPinned(db, "t20_single", "single")
      const eventId = await insertEvent(db)
      const preview = await as(
        db,
        f.admin,
        async () =>
          (
            await db.query(PREVIEW, [
              null,
              testName("t20_payer"),
              single,
              eventId,
              12800,
              f.today,
              f.method,
            ])
          ).rows[0].r
      )
      const r = await approvePinned(db, f, single, eventId)
      const { rows } = await db.query(
        `select ev.id, ev.starts_at from public.bookings b
         join public.events ev on ev.id = b.event_id
         where b.payment_id = $1`,
        [r.payment_id]
      )
      expect(rows).toHaveLength(1)
      expect(preview.event_id).toBe(rows[0].id)
      expect(new Date(preview.event_starts_at).getTime()).toBe(
        new Date(rows[0].starts_at).getTime()
      )
    })
  })
})

describe("SP7: a pinned session cancelled before the join", () => {
  it("T23: after the bind she sees the pending credit and can choose", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const single = await insertPinned(db, "t23_single", "single")
      const eventId = await insertEvent(db, 5)
      const r = await approvePinned(db, f, single, eventId)
      await as(db, f.admin, () =>
        db.query("select public.admin_cancel_event($1, true, $2, $3)", [
          eventId,
          testName("message"),
          randomUUID(),
        ])
      )
      await db.query("select private.bind_purchase($1, $2)", [
        r.payment_id,
        f.customerA,
      ])
      const { rows: credits } = await db.query(
        `select c.id from public.cancellation_credits c
         join public.entitlements e on e.id = c.source_entitlement_id
         where e.payment_id = $1`,
        [r.payment_id]
      )
      expect(credits).toHaveLength(1)
      const creditId = credits[0].id as string

      const mine = await as(
        db,
        f.customerA,
        async () => (await db.query(MY_CREDITS)).rows[0].r
      )
      expect(mine).toEqual([
        expect.objectContaining({ credit_id: creditId, choice_pending: true }),
      ])
      const chosen = await as(
        db,
        f.customerA,
        async () =>
          (await db.query(CHOOSE, [creditId, "refund", randomUUID()])).rows[0].r
      )
      expect(chosen).toMatchObject({ credit_id: creditId, outcome: "refund" })
      const { rows: after } = await db.query(
        "select status, choice_pending, customer_id from public.cancellation_credits where id = $1",
        [creditId]
      )
      expect(after).toEqual([
        {
          status: "refund_requested",
          choice_pending: false,
          customer_id: f.customerA,
        },
      ])
    })
  })
})

describe("SP8: a join link of a customer already in the session, end to end", () => {
  it.each(["already booked", "took part (intro)"])(
    "T24: %s -> join_begin existing_account, claim_join conflict, nothing bound, link_conflict to handle",
    async (scenario) => {
      await inRollback(async (db) => {
        const f = await seedMoney(db)
        const account = await giveAccount(db, f.customerA, "t24_acc")
        const eventId = await insertEvent(db)
        let productId: string
        if (scenario === "already booked") {
          productId = await insertPinned(db, "t24_single", "single")
          await db.query(
            `insert into public.bookings (
               customer_id, event_id, party_size, booked_by, policy_snapshot)
             values ($1, $2, 1, 'customer', ${SNAPSHOT})`,
            [f.customerA, eventId]
          )
        } else {
          productId = await insertPinned(db, "t24_intro", "intro")
          const past = await insertEvent(db, -14)
          await db.query(
            `insert into public.bookings (
               customer_id, event_id, party_size, status, booked_by, policy_snapshot)
             values ($1, $2, 1, 'completed', 'customer', ${SNAPSHOT})`,
            [f.customerA, past]
          )
        }
        const r = await approvePinned(db, f, productId, eventId)
        const token = r.token as string
        const tokenId = r.token_id as string

        expect(
          await call(db, BEGIN, [
            token,
            account.email,
            testPhone(),
            randomUUID(),
          ])
        ).toEqual({ outcome: "existing_account", token_id: tokenId })
        // An answer, never a raw error.
        expect(await claimAs(db, f.customerA, token)).toEqual({
          outcome: "conflict",
        })
        expect(await tokenRow(db, tokenId)).toMatchObject({
          state: "conflict",
          conflict_reason: "bind_conflict",
          customer_id: null,
        })
        expect(await boundTo(db, r.payment_id as string)).toEqual({
          payment: null,
          entitlement: null,
          bookings: [null],
        })
        expect(
          await count(
            db,
            "select 1 from public.notifications where recipient_id = $1",
            [f.customerA]
          )
        ).toBe(0)
        const items = await as(
          db,
          f.admin,
          async () => (await db.query(ITEMS)).rows[0].r
        )
        expect(items.filter((i: { id: string }) => i.id === tokenId)).toEqual([
          expect.objectContaining({
            kind: "link_conflict",
            conflict_reason: "bind_conflict",
          }),
        ])
      })
    }
  )
})
