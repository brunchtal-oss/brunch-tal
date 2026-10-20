// Story 5.10: the scheduled jobs (private.job_expiry_alerts,
// private.job_refresh_credit_options, private.job_cleanup, the schedule of
// private.job_auto_extend), private.job_intervals and the three new kinds of
// admin_get_attention_items (job_failed, vault_missing, push_stuck). One
// test per row of the spec's I/O matrix ("all vars" is in
// settings-and-templates.test.ts). The jobs act on the whole dev database,
// so every check looks only at this test's rows. Dates are relative to
// now(). Everything runs in inRollback, except the locked profile, which
// needs a committed profile.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
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

const ALERTS = "select private.job_expiry_alerts() as n"
const REFRESH = "select private.job_refresh_credit_options() as n"
const CLEANUP = "select private.job_cleanup() as n"
const ITEMS = "select public.admin_get_attention_items() as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & { single: string; concept: string }
type Item = Record<string, unknown> & { kind: string; id: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set admin_expiring_days = 21, customer_expiring_days = 10,
         credit_expiring_days = 5, cancel_window_hours = 48,
         credit_options_count = 2`
  )
  // Only this test's sessions can become credit options.
  await db.query(
    "update public.events set status = 'draft' where status = 'published'"
  )
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

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// A published session starting `startHours` from now, whose registration
// closes `closesHours` from now (set by hand).
async function insertEvent(
  db: Db,
  f: Fixture,
  startHours: number,
  closesHours: number,
  capacity = 12
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     values ($1, 'regular', now() + make_interval(hours => $2::int),
       now() + make_interval(hours => $2::int + 2), $4,
       now() + make_interval(hours => $3::int), true, 'published')
     returning id`,
    [f.concept, startHours, closesHours, capacity]
  )
  return rows[0].id
}

// As the admin: a purchase of `productId` for `customerId` (null: not
// bound), pinned to `eventId` for a single. Returns the payment and the
// entitlement.
async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  options: { customerId?: string | null; eventId?: string | null } = {}
): Promise<{ payment: string; entitlement: string }> {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId:
        options.customerId === undefined ? f.customerA : options.customerId,
      productId,
      eventId: options.eventId ?? null,
      amount: productId === f.single ? 12800 : 47200,
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
  return { payment: r.payment_id as string, entitlement: rows[0].id }
}

// The card ends `days` days from the local today (negative: expired).
async function setDaysLeft(db: Db, id: string, days: number): Promise<void> {
  await db.query(
    `update public.entitlements
     set valid_from = (now() at time zone 'Asia/Jerusalem')::date - 30,
         expires_on = (now() at time zone 'Asia/Jerusalem')::date + $2::int
     where id = $1`,
    [id, days]
  )
}

async function card(db: Db, f: Fixture, days: number, customerId?: string) {
  const g = await grant(db, f, f.card, { customerId })
  await setDaysLeft(db, g.entitlement, days)
  return g.entitlement
}

async function run(db: Db, text: string): Promise<number> {
  return (await db.query(text)).rows[0].n
}

// The notifications of a type whose discriminator starts with `subject`
// (an entitlement or credit id), any recipient.
async function alerts(db: Db, type: string, subject: string) {
  const { rows } = await db.query(
    `select recipient_id, dedupe_key, target_path,
       payload ->> 'title' as title, payload ->> 'body' as body
     from public.notifications
     where type = $1 and dedupe_key like $1 || ':%:' || $2 || ':%'
     order by recipient_id, dedupe_key`,
    [type, subject]
  )
  return rows
}

async function adminCount(db: Db): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.admin_roles"
  )
  return rows[0].n
}

async function dayMonth(db: Db, expression: string, params: unknown[]) {
  const { rows } = await db.query(
    `select private.format_day_month(${expression}) as d`,
    params
  )
  return rows[0].d as string
}

async function expiresOn(db: Db, id: string): Promise<string> {
  const { rows } = await db.query(
    "select expires_on::text as d from public.entitlements where id = $1",
    [id]
  )
  return rows[0].d
}

async function items(db: Db, f: Fixture): Promise<Item[]> {
  return as(db, f.admin, async () => (await db.query(ITEMS)).rows[0].r)
}

// A credit of customerA: a pinned single on a session in 72 hours,
// cancelled by her with a credit (the refresh fills its options from the
// published sessions after it, by start).
async function credit(db: Db, f: Fixture): Promise<string> {
  const origin = await insertEvent(db, f, 72, 72)
  const g = await grant(db, f, f.single, { eventId: origin })
  const { rows } = await db.query<{ id: string }>(
    "select id from public.bookings where payment_id = $1",
    [g.payment]
  )
  const r = await as(db, f.customerA, async () => {
    const { rows: c } = await db.query(
      "select public.cancel_booking($1, $2, 'credit') as r",
      [rows[0].id, randomUUID()]
    )
    return c[0].r
  })
  return r.credit_id as string
}

async function options(db: Db, creditId: string) {
  const { rows } = await db.query(
    `select event_id, state, replaced_reason, added_by
     from public.credit_options where credit_id = $1
     order by assigned_at, event_id`,
    [creditId]
  )
  return rows
}

// Fills a session: capacity 1 and one booking of a card of customerB,
// inserted as the owner (no RPC, so nothing refreshes the credits).
async function fill(db: Db, f: Fixture, eventId: string): Promise<void> {
  const g = await grant(db, f, f.card, { customerId: f.customerB })
  await db.query("update public.events set capacity_adults = 1 where id = $1", [
    eventId,
  ])
  await db.query(
    `insert into public.bookings (
       payment_id, event_id, party_size, booked_by, policy_snapshot)
     values ($1, $2, 1, 'admin', ${SNAPSHOT})`,
    [g.payment, eventId]
  )
}

describe("job_expiry_alerts: cards", { timeout: 60_000 }, () => {
  it("21 days left: one admin_card_expiring per admin, nothing for the customer; a rerun creates nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, 21)
      await run(db, ALERTS)

      const sent = await alerts(db, "admin_card_expiring", id)
      expect(sent).toHaveLength(await adminCount(db))
      const day = await expiresOn(db, id)
      const mine = sent.find((n) => n.recipient_id === f.admin)
      expect(mine).toMatchObject({
        dedupe_key: `admin_card_expiring:${f.admin}:${id}:${day}`,
        target_path: `/admin/customers/${f.customerA}`,
      })
      expect(mine!.title).toContain(testName("money_a"))
      expect(mine!.body).toContain("4")
      expect(mine!.body).toContain(await dayMonth(db, "$1::date", [day]))
      expect(await alerts(db, "card_expiring", id)).toHaveLength(0)

      // The same hour: everything already exists.
      expect(await run(db, ALERTS)).toBe(0)
      expect(await alerts(db, "admin_card_expiring", id)).toHaveLength(
        sent.length
      )
    })
  })

  it("10 days left: one card_expiring; the admin one is not repeated; 11 days: none for the customer", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, 10)
      const eleven = await card(db, f, 11)
      // First as if the customer threshold were not reached yet.
      await db.query(
        "update public.business_settings set customer_expiring_days = 5"
      )
      await run(db, ALERTS)
      expect(await alerts(db, "card_expiring", id)).toHaveLength(0)
      const admins = await alerts(db, "admin_card_expiring", id)
      expect(admins).toHaveLength(await adminCount(db))

      await db.query(
        "update public.business_settings set customer_expiring_days = 10"
      )
      await run(db, ALERTS)
      const sent = await alerts(db, "card_expiring", id)
      const day = await expiresOn(db, id)
      expect(sent).toEqual([
        expect.objectContaining({
          recipient_id: f.customerA,
          dedupe_key: `card_expiring:${f.customerA}:${id}:${day}`,
          target_path: "/me/sessions",
        }),
      ])
      expect(sent[0].body).toContain("4")
      expect(sent[0].body).toContain(await dayMonth(db, "$1::date", [day]))
      expect(await alerts(db, "admin_card_expiring", id)).toEqual(admins)
      expect(await alerts(db, "card_expiring", eleven)).toHaveLength(0)
      expect(await alerts(db, "admin_card_expiring", eleven)).toHaveLength(
        await adminCount(db)
      )
    })
  })

  it("after an extension the card reaches the threshold again: new alerts for the new expires_on", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, 10)
      await run(db, ALERTS)
      const first = await expiresOn(db, id)
      await setDaysLeft(db, id, 9)
      await run(db, ALERTS)
      const second = await expiresOn(db, id)

      const mine = (await alerts(db, "admin_card_expiring", id))
        .filter((n) => n.recipient_id === f.admin)
        .map((n) => n.dedupe_key)
      expect(mine.sort()).toEqual(
        [
          `admin_card_expiring:${f.admin}:${id}:${first}`,
          `admin_card_expiring:${f.admin}:${id}:${second}`,
        ].sort()
      )
      expect(
        (await alerts(db, "card_expiring", id)).map((n) => n.dedupe_key).sort()
      ).toEqual(
        [
          `card_expiring:${f.customerA}:${id}:${first}`,
          `card_expiring:${f.customerA}:${id}:${second}`,
        ].sort()
      )
    })
  })

  it("nothing free (every entry reserved): no alert", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const one = await insertProduct(db, { label: "one_entry", units: 1 })
      const g = await grant(db, f, one)
      await setDaysLeft(db, g.entitlement, 10)
      const event = await insertEvent(db, f, 72, 72)
      await as(db, f.customerA, () =>
        db.query("select public.book_session($1, $2) as r", [
          event,
          randomUUID(),
        ])
      )
      const { rows } = await db.query(
        "select available, reserved from public.entitlement_balances where entitlement_id = $1",
        [g.entitlement]
      )
      expect(rows[0]).toMatchObject({ available: 0, reserved: 1 })

      await run(db, ALERTS)
      expect(await alerts(db, "card_expiring", g.entitlement)).toHaveLength(0)
      expect(
        await alerts(db, "admin_card_expiring", g.entitlement)
      ).toHaveLength(0)
    })
  })

  it("a pinned entitlement and a card not bound to a customer: no alert", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, 72, 72)
      // Its validity ends on the session's day, in 3 days.
      const pinned = await grant(db, f, f.single, { eventId: event })
      const unbound = await grant(db, f, f.card, { customerId: null })
      await setDaysLeft(db, unbound.entitlement, 5)

      await run(db, ALERTS)
      for (const id of [pinned.entitlement, unbound.entitlement]) {
        expect(await alerts(db, "card_expiring", id), id).toHaveLength(0)
        expect(await alerts(db, "admin_card_expiring", id), id).toHaveLength(0)
      }
    })
  })

  it("expired yesterday: no alert; its last day (0 days left): both", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const expired = await card(db, f, -1)
      const lastDay = await card(db, f, 0)
      await run(db, ALERTS)
      expect(await alerts(db, "card_expiring", expired)).toHaveLength(0)
      expect(await alerts(db, "admin_card_expiring", expired)).toHaveLength(0)
      expect(await alerts(db, "card_expiring", lastDay)).toHaveLength(1)
      expect(await alerts(db, "admin_card_expiring", lastDay)).toHaveLength(
        await adminCount(db)
      )
    })
  })
})

describe("job_expiry_alerts: credits", { timeout: 60_000 }, () => {
  it("all options set and the last closes within the credit days: one credit_expiring; a rerun creates nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const first = await insertEvent(db, f, 96, 84)
      const last = await insertEvent(db, f, 120, 96)
      const id = await credit(db, f)
      expect((await options(db, id)).map((o) => o.event_id).sort()).toEqual(
        [first, last].sort()
      )

      await run(db, ALERTS)
      const sent = await alerts(db, "credit_expiring", id)
      expect(sent).toEqual([
        expect.objectContaining({
          recipient_id: f.customerA,
          dedupe_key: `credit_expiring:${f.customerA}:${id}:${last}`,
          target_path: "/me/bookings",
        }),
      ])
      const date = await dayMonth(
        db,
        "(select (starts_at at time zone 'Asia/Jerusalem')::date from public.events where id = $1)",
        [last]
      )
      const closes = await dayMonth(
        db,
        "(select (registration_closes_at at time zone 'Asia/Jerusalem')::date from public.events where id = $1)",
        [last]
      )
      expect(sent[0].body).toContain(date)
      expect(sent[0].body).toContain(closes)

      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(1)
    })
  })

  it("story 4.6: the same credit of a customer whose details were removed: no alert", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const first = await insertEvent(db, f, 96, 84)
      const last = await insertEvent(db, f, 120, 96)
      const id = await credit(db, f)
      expect((await options(db, id)).map((o) => o.event_id).sort()).toEqual(
        [first, last].sort()
      )
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerA]
      )

      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(0)
    })
  })

  it("the last option closes later than the credit days: no alert", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEvent(db, f, 96, 84)
      await insertEvent(db, f, 200, 7 * 24)
      const id = await credit(db, f)
      expect(await options(db, id)).toHaveLength(2)
      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(0)
    })
  })

  it("the last option's registration already closed (not refreshed yet): no alert", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const first = await insertEvent(db, f, 96, 84)
      const last = await insertEvent(db, f, 120, 96)
      const id = await credit(db, f)
      // Both closed an hour ago, so the last active option has closed; the
      // options are still active (no refresh ran).
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 hour' where id = any ($1::uuid[])",
        [[first, last]]
      )
      expect(
        (await options(db, id)).find((o) => o.event_id === last)
      ).toMatchObject({ state: "active" })
      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(0)
    })
  })

  it("the last option's session cancelled, or full, before the refresh replaced it: no alert", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEvent(db, f, 96, 84)
      const last = await insertEvent(db, f, 120, 96)
      const id = await credit(db, f)

      await db.query(
        "update public.events set status = 'cancelled' where id = $1",
        [last]
      )
      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(0)

      await db.query(
        "update public.events set status = 'published' where id = $1",
        [last]
      )
      await fill(db, f, last)
      expect(
        (await options(db, id)).find((o) => o.event_id === last)
      ).toMatchObject({ state: "active" })
      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(0)
    })
  })

  it("fewer options than options_count, choice_pending, or in use: no alert", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // Only one session after the cancelled one: one option of two.
      const only = await insertEvent(db, f, 96, 84)
      const id = await credit(db, f)
      expect(await options(db, id)).toHaveLength(1)
      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(0)

      // Both set, but choice_pending.
      await insertEvent(db, f, 110, 90)
      await run(db, REFRESH)
      expect(await options(db, id)).toHaveLength(2)
      await db.query(
        "update public.cancellation_credits set choice_pending = true where id = $1",
        [id]
      )
      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(0)

      // Not pending, but she booked an option with the credit (in use).
      await db.query(
        "update public.cancellation_credits set choice_pending = false where id = $1",
        [id]
      )
      await as(db, f.customerA, () =>
        db.query("select public.book_session($1, $2) as r", [
          only,
          randomUUID(),
        ])
      )
      const { rows } = await db.query(
        "select private.credit_in_use($1) as used",
        [id]
      )
      expect(rows[0].used).toBe(true)
      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(0)
    })
  })

  it("the last option fills: the refresh replaces it, and the new last option gets its own alert, once", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await insertEvent(db, f, 96, 84)
      const last = await insertEvent(db, f, 120, 96)
      const id = await credit(db, f)
      await run(db, ALERTS)
      expect(await alerts(db, "credit_expiring", id)).toHaveLength(1)

      await fill(db, f, last)
      const later = await insertEvent(db, f, 130, 100)
      await run(db, REFRESH)
      expect(await options(db, id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_id: last,
            state: "replaced",
            replaced_reason: "full",
          }),
          expect.objectContaining({ event_id: later, state: "active" }),
        ])
      )

      await run(db, ALERTS)
      await run(db, ALERTS)
      expect(
        (await alerts(db, "credit_expiring", id))
          .map((n) => n.dedupe_key)
          .sort()
      ).toEqual(
        [
          `credit_expiring:${f.customerA}:${id}:${last}`,
          `credit_expiring:${f.customerA}:${id}:${later}`,
        ].sort()
      )
    })
  })
})

describe("job_refresh_credit_options", { timeout: 60_000 }, () => {
  it("an option Tal added is kept although it starts before the cancelled session; a removed option never returns; no top-up above options_count", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const a = await insertEvent(db, f, 96, 84)
      const b = await insertEvent(db, f, 120, 96)
      const id = await credit(db, f)
      // Earlier than the cancelled session (72 hours).
      const early = await insertEvent(db, f, 60, 50)
      await as(db, f.admin, () =>
        db.query(
          "select public.admin_change_credit_options($1, $2::uuid[], null, true, $3)",
          [id, [early], randomUUID()]
        )
      )

      await run(db, REFRESH)
      const rows = await options(db, id)
      expect(rows.filter((o) => o.state === "active")).toEqual([
        expect.objectContaining({ event_id: early, added_by: "admin" }),
      ])
      for (const removed of [a, b]) {
        expect(
          rows.filter((o) => o.event_id === removed),
          removed
        ).toEqual([
          expect.objectContaining({
            state: "replaced",
            replaced_reason: "admin",
          }),
        ])
      }
    })
  })

  it("a profile held by another transaction is skipped, and refreshed on the next run", async () => {
    const locked = randomUUID()
    onCleanup(() => sql("delete from public.profiles where id = $1", [locked]))
    await sql(
      "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
      [locked, testName("refresh_locked")]
    )

    await inRollback(async (db) => {
      const f = await seed(db)
      const full = await insertEvent(db, f, 96, 84)
      await insertEvent(db, f, 120, 96)
      const id = await credit(db, f)
      await fill(db, f, full)
      // The credit moves to the committed profile. The FK check takes only
      // a key-share lock on it, which the holder's lock does not conflict
      // with.
      await db.query(
        "update public.cancellation_credits set customer_id = $2 where id = $1",
        [id, locked]
      )

      const holder = await getPool().connect()
      try {
        await holder.query("begin")
        await holder.query(
          "select 1 from public.profiles where id = $1 for no key update",
          [locked]
        )
        await run(db, REFRESH)
        expect(
          (await options(db, id)).find((o) => o.event_id === full)
        ).toMatchObject({ state: "active" })
      } finally {
        await holder.query("rollback").catch(() => {})
        holder.release()
      }

      await run(db, REFRESH)
      expect(
        (await options(db, id)).find((o) => o.event_id === full)
      ).toMatchObject({ state: "replaced", replaced_reason: "full" })
    })
  })
})

describe("job_auto_extend, as scheduled", { timeout: 60_000 }, () => {
  it("with no arguments: one card that fails stays unchanged, the others are extended", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const good = (await grant(db, f, f.card)).entitlement
      const bad = (await grant(db, f, f.card)).entitlement
      // Two ended local weeks before this one, and a card that fits no
      // session (a card never fits a couple session), so both weeks are
      // empty: +7 twice.
      const { rows } = await db.query(
        "select private.local_week_start((now() at time zone 'Asia/Jerusalem')::date)::text as w"
      )
      const week = rows[0].w
      await db.query(
        `update public.entitlements
         set eligible_event_kind = 'couple',
             valid_from = $2::date - 14, expires_on = $2::date - 10
         where id = any ($1::uuid[])`,
        [[good, bad], week]
      )
      // The correction of one card is refused (rolled back with the test).
      await db.query(
        `alter table public.entitlement_corrections
           add constraint test_auto_extend_fails check (entitlement_id <> '${bad}'::uuid) not valid`
      )
      const before = await expiresOn(db, bad)

      const n = (await db.query("select private.job_auto_extend() as n"))
        .rows[0].n
      expect(n).toBeGreaterThanOrEqual(2)
      const { rows: expected } = await db.query(
        "select ($1::date + 4)::text as d",
        [week]
      )
      expect(await expiresOn(db, good)).toBe(expected[0].d)
      expect(await expiresOn(db, bad)).toBe(before)
      const { rows: corrections } = await db.query(
        "select entitlement_id from public.entitlement_corrections where entitlement_id = any ($1::uuid[])",
        [[good, bad]]
      )
      expect(corrections.map((c) => c.entitlement_id)).toEqual([good, good])
      const { rows: audits } = await db.query(
        "select 1 from public.audit_log where action = 'job_auto_extend' and entity_id = $1",
        [bad]
      )
      expect(audits).toHaveLength(0)
    })
  })
})

describe("job_cleanup", { timeout: 60_000 }, () => {
  it("closes the active waitlist entries of started, cancelled or completed sessions only (5.6)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const future = await insertEvent(db, f, 72, 48)
      const started = await insertEvent(db, f, 72, 48)
      const cancelled = await insertEvent(db, f, 72, 48)
      const completed = await insertEvent(db, f, 72, 48)
      await db.query(
        `update public.events
         set starts_at = now() - interval '1 hour',
             ends_at = now() + interval '1 hour',
             registration_closes_at = now() - interval '1 day'
         where id = $1`,
        [started]
      )
      await db.query(
        "update public.events set status = 'cancelled' where id = $1",
        [cancelled]
      )
      await db.query(
        "update public.events set status = 'completed' where id = $1",
        [completed]
      )
      const { rows } = await db.query(
        `insert into public.waitlist_entries (customer_id, event_id, party_size)
         select $1, unnest($2::uuid[]), 1
         returning id, event_id`,
        [f.customerA, [future, started, cancelled, completed]]
      )
      const left = await db.query(
        `insert into public.waitlist_entries (
           customer_id, event_id, party_size, status, closed_at)
         values ($1, $2, 1, 'left', now() - interval '2 days')
         returning closed_at`,
        [f.customerA, started]
      )

      await run(db, CLEANUP)

      const { rows: after } = await db.query(
        `select event_id, status, closed_at is not null as closed
         from public.waitlist_entries
         where id = any ($1::uuid[])`,
        [rows.map((r: { id: string }) => r.id)]
      )
      const byEvent = new Map(
        after.map((r: { event_id: string; status: string }) => [
          r.event_id,
          r.status,
        ])
      )
      expect(byEvent.get(future)).toBe("active")
      expect(byEvent.get(started)).toBe("closed")
      expect(byEvent.get(cancelled)).toBe("closed")
      expect(byEvent.get(completed)).toBe("closed")
      const { rows: leftAfter } = await db.query(
        `select status, closed_at from public.waitlist_entries
         where event_id = $1 and status = 'left'`,
        [started]
      )
      expect(leftAfter).toHaveLength(1)
      expect(leftAfter[0].closed_at).toEqual(left.rows[0].closed_at)
    })
  })

  it("deletes only the rows past each limit; an unread notification stays", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      async function notification(
        label: string,
        readDaysAgo: number | null,
        createdDaysAgo = 200
      ): Promise<string> {
        const { rows } = await db.query(
          `insert into public.notifications (
             recipient_id, recipient_kind, type, payload, target_path,
             dedupe_key, created_at, read_at)
           values ($1, 'customer', 'card_expiring',
             '{"title": "t", "body": "b", "template_version": 1}',
             '/me', $2, now() - make_interval(days => $3::int),
             case when $4::int is null then null
               else now() - make_interval(days => $4::int) end)
           returning id`,
          [f.customerA, testName(label), createdDaysAgo, readDaysAgo]
        )
        return rows[0].id
      }
      async function job(
        notificationId: string,
        finishedDaysAgo: number | null
      ) {
        const { rows } = await db.query(
          `insert into public.notification_jobs (
             notification_id, status, finished_at)
           values ($1,
             case when $2::int is null then 'queued' else 'sent' end,
             case when $2::int is null then null
               else now() - make_interval(days => $2::int) end)
           returning id`,
          [notificationId, finishedDaysAgo]
        )
        return rows[0].id
      }
      async function exists(table: string, id: string) {
        const { rows } = await db.query(
          `select count(*)::int as n from ${table} where id = $1`,
          [id]
        )
        return rows[0].n === 1
      }

      const read91 = await notification("read91", 91)
      const read89 = await notification("read89", 89)
      const unread = await notification("unread", null, 400)
      const old = await notification("job_old", null)
      const recent = await notification("job_recent", null)
      const queued = await notification("job_queued", null)
      const jobOld = await job(old, 31)
      const jobRecent = await job(recent, 29)
      const jobQueued = await job(queued, null)

      await db.query(
        `insert into private.idempotency_results (
           actor_scope, rpc, key, request_hash, result, created_at)
         values
           ($1, 'test_rpc', $2, repeat('a', 64), '{}', now() - interval '8 days'),
           ($1, 'test_rpc', $3, repeat('a', 64), '{}', now() - interval '6 days')`,
        [testName("scope"), randomUUID(), randomUUID()]
      )
      const { rows: jobs } = await db.query(
        "select jobid from cron.job where jobname = 'cleanup'"
      )
      await db.query(
        `insert into cron.job_run_details (
           runid, jobid, job_pid, database, username, command, status,
           return_message, start_time, end_time)
         values
           ((select coalesce(max(runid), 0) + 1000000 from cron.job_run_details), $1, 0, current_database(), current_user, 'x', 'succeeded', $2,
            now() - interval '15 days', now() - interval '15 days'),
           ((select coalesce(max(runid), 0) + 1000001 from cron.job_run_details), $1, 0, current_database(), current_user, 'x', 'succeeded', $3,
            now() - interval '13 days', now() - interval '13 days')`,
        [jobs[0].jobid, testName("run15"), testName("run13")]
      )

      expect(await run(db, CLEANUP)).toBeGreaterThanOrEqual(4)

      expect(await exists("public.notifications", read91)).toBe(false)
      expect(await exists("public.notifications", read89)).toBe(true)
      expect(await exists("public.notifications", unread)).toBe(true)
      // A finished job goes; its notification (unread) stays.
      expect(await exists("public.notification_jobs", jobOld)).toBe(false)
      expect(await exists("public.notifications", old)).toBe(true)
      expect(await exists("public.notification_jobs", jobRecent)).toBe(true)
      expect(await exists("public.notification_jobs", jobQueued)).toBe(true)

      const { rows: results } = await db.query(
        "select count(*)::int as n from private.idempotency_results where actor_scope = $1",
        [testName("scope")]
      )
      expect(results[0].n).toBe(1)
      const { rows: runs } = await db.query(
        "select return_message from cron.job_run_details where return_message = any ($1::text[])",
        [[testName("run15"), testName("run13")]]
      )
      expect(runs).toEqual([{ return_message: testName("run13") }])
    })
  })
})

describe(
  "admin_get_attention_items: jobs, Vault and push",
  { timeout: 60_000 },
  () => {
    async function cleanupJob(db: Db): Promise<string> {
      const { rows } = await db.query(
        "select jobid from cron.job where jobname = 'cleanup'"
      )
      await db.query("delete from cron.job_run_details where jobid = $1", [
        rows[0].jobid,
      ])
      return rows[0].jobid
    }

    // runid by hand: the test role has no usage on cron.runid_seq.
    async function addRun(
      db: Db,
      jobid: string,
      status: string,
      endedAgo: string
    ): Promise<void> {
      await db.query(
        `insert into cron.job_run_details (
         runid, jobid, job_pid, database, username, command, status,
         return_message, start_time, end_time)
       values ((select coalesce(max(runid), 0) + 1000000 from cron.job_run_details), $1, 0, current_database(), current_user, 'x', $2, $3,
         now() - $4::interval, now() - $4::interval)`,
        [jobid, status, testName("run"), endedAgo]
      )
    }

    function jobItem(list: Item[], job: string): Item | undefined {
      return list.find((i) => i.kind === "job_failed" && i.id === job)
    }

    it("no runs: not flagged; a recent success: not flagged; a latest run that failed: failed", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const jobid = await cleanupJob(db)
        expect(jobItem(await items(db, f), "cleanup")).toBeUndefined()

        await addRun(db, jobid, "succeeded", "1 hour")
        expect(jobItem(await items(db, f), "cleanup")).toBeUndefined()

        await addRun(db, jobid, "failed", "10 minutes")
        expect(jobItem(await items(db, f), "cleanup")).toMatchObject({
          kind: "job_failed",
          id: "cleanup",
          customer_label: null,
          job: "cleanup",
          reason: "failed",
        })
      })
    })

    it("no success within 3 x its frequency: late; not active or not scheduled: missing", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const jobid = await cleanupJob(db)
        // Daily: 3 days.
        await addRun(db, jobid, "succeeded", "4 days")
        expect(jobItem(await items(db, f), "cleanup")).toMatchObject({
          reason: "late",
        })

        // Through pg_cron's own functions: the test role cannot write
        // cron.job directly. Rolled back with the rest.
        await db.query("select cron.alter_job($1::bigint, active => false)", [
          jobid,
        ])
        expect(jobItem(await items(db, f), "cleanup")).toMatchObject({
          reason: "missing",
        })

        await db.query("select cron.unschedule('expiry_alerts')")
        expect(jobItem(await items(db, f), "expiry_alerts")).toMatchObject({
          reason: "missing",
          job: "expiry_alerts",
        })
      })
    })

    it("a success 2 days ago is not late (daily: 3 days); a failed run followed by a newer success is not flagged", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const jobid = await cleanupJob(db)
        await addRun(db, jobid, "succeeded", "2 days")
        expect(jobItem(await items(db, f), "cleanup")).toBeUndefined()

        await addRun(db, jobid, "failed", "1 hour")
        expect(jobItem(await items(db, f), "cleanup")).toMatchObject({
          reason: "failed",
        })
        await addRun(db, jobid, "succeeded", "10 minutes")
        expect(jobItem(await items(db, f), "cleanup")).toBeUndefined()
      })
    })

    it("a first run still running for a minute, with no success yet: not flagged", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const jobid = await cleanupJob(db)
        await db.query(
          `insert into cron.job_run_details (
             runid, jobid, job_pid, database, username, command, status,
             return_message, start_time, end_time)
           values ((select coalesce(max(runid), 0) + 1000000 from cron.job_run_details), $1, 0, current_database(), current_user, 'x', 'running',
             $2, now() - interval '1 minute', null)`,
          [jobid, testName("running")]
        )
        expect(jobItem(await items(db, f), "cleanup")).toBeUndefined()
      })
    })

    it("cron_secret missing while app_url is set: vault_missing", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await db.query(
          "delete from vault.secrets where name in ('app_url', 'cron_secret')"
        )
        await db.query("select vault.create_secret($1, 'app_url')", [
          `https://${testName("app")}.example.test`,
        ])
        const list = await items(db, f)
        expect(list.filter((i) => i.kind === "vault_missing")).toHaveLength(1)
      })
    })

    it("Vault without app_url, or with an empty one: vault_missing; with both: none; never a value", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const url = `https://${testName("app")}.example.test`
        const secret = testName("cron_secret_value")
        await db.query(
          "delete from vault.secrets where name in ('app_url', 'cron_secret')"
        )
        await db.query("select vault.create_secret($1, 'cron_secret')", [
          secret,
        ])
        let list = await items(db, f)
        expect(list.filter((i) => i.kind === "vault_missing")).toEqual([
          expect.objectContaining({
            kind: "vault_missing",
            id: "vault_missing",
            customer_label: null,
          }),
        ])
        expect(JSON.stringify(list).includes(secret)).toBe(false)

        await db.query("select vault.create_secret('   ', 'app_url')")
        list = await items(db, f)
        expect(list.some((i) => i.kind === "vault_missing")).toBe(true)

        await db.query("delete from vault.secrets where name = 'app_url'")
        await db.query("select vault.create_secret($1, 'app_url')", [url])
        list = await items(db, f)
        expect(list.some((i) => i.kind === "vault_missing")).toBe(false)
        const text = JSON.stringify(list)
        expect(text.includes(secret) || text.includes(url)).toBe(false)
      })
    })

    it("a push job queued 16 minutes past due counts in push_stuck; 14 minutes or sending does not", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        async function stuck(): Promise<number> {
          const item = (await items(db, f)).find((i) => i.kind === "push_stuck")
          return (item?.count as number | undefined) ?? 0
        }
        async function queue(
          label: string,
          minutesAgo: number,
          status = "queued"
        ) {
          const { rows } = await db.query(
            `insert into public.notifications (
             recipient_id, recipient_kind, type, payload, target_path, dedupe_key)
           values ($1, 'customer', 'card_expiring',
             '{"title": "t", "body": "b", "template_version": 1}', '/me', $2)
           returning id`,
            [f.customerA, testName(label)]
          )
          await db.query(
            `insert into public.notification_jobs (
             notification_id, status, next_attempt_at, lease_until)
           values ($1, $2, now() - make_interval(mins => $3::int),
             case when $2 = 'sending' then now() + interval '1 minute' end)`,
            [rows[0].id, status, minutesAgo]
          )
        }

        const before = await stuck()
        await queue("q14", 14)
        await queue("sending", 30, "sending")
        expect(await stuck()).toBe(before)
        await queue("q16", 16)
        expect(await stuck()).toBe(before + 1)
        const item = (await items(db, f)).find((i) => i.kind === "push_stuck")
        expect(item).toMatchObject({ id: "push_stuck", customer_label: null })
      })
    })

    it("a customer gets NOT_AUTHORIZED", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await asAuthenticated(db, f.customerA)
        expect(await queryError(db, ITEMS)).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
        await db.query("reset role")
      })
    })
  }
)

describe("grants and schedules", { timeout: 30_000 }, () => {
  it("authenticated cannot run any job or helper (no grant)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      for (const text of [
        ALERTS,
        REFRESH,
        CLEANUP,
        "select * from private.job_intervals()",
        "select private.job_auto_extend()",
      ]) {
        expect(await queryError(db, text), text).toMatchObject({
          code: "42501",
        })
      }
      await db.query("reset role")
    })
  })

  it("cron.job has the four schedules", async () => {
    const rows = await sql<{
      jobname: string
      schedule: string
      command: string
    }>(
      `select jobname, schedule, command from cron.job
       where jobname in ('expiry_alerts', 'auto_extend', 'refresh_credit_options', 'cleanup')
       order by jobname collate "C"`
    )
    expect(rows).toEqual([
      {
        jobname: "auto_extend",
        schedule: "5 * * * *",
        command: "select private.job_auto_extend()",
      },
      {
        jobname: "cleanup",
        schedule: "30 0 * * *",
        command: "select private.job_cleanup()",
      },
      {
        jobname: "expiry_alerts",
        schedule: "0 * * * *",
        command: "select private.job_expiry_alerts()",
      },
      {
        jobname: "refresh_credit_options",
        schedule: "*/15 * * * *",
        command: "select private.job_refresh_credit_options()",
      },
    ])
  })

  it("job_intervals lists every scheduled job, and each is in cron.job", async () => {
    const rows = await sql<{
      jobname: string
      every: string
      scheduled: boolean
    }>(
      `select ji.jobname, ji.every::text as every,
         exists (select 1 from cron.job j where j.jobname = ji.jobname) as scheduled
       from private.job_intervals() ji
       order by ji.jobname collate "C"`
    )
    expect(rows).toEqual([
      { jobname: "auto_extend", every: "01:00:00", scheduled: true },
      { jobname: "cleanup", every: "1 day", scheduled: true },
      { jobname: "complete_events", every: "00:05:00", scheduled: true },
      { jobname: "expiry_alerts", every: "01:00:00", scheduled: true },
      { jobname: "invoke_push_worker", every: "00:01:00", scheduled: true },
      // Story 5.11.
      { jobname: "marketing_reminders", every: "00:05:00", scheduled: true },
      { jobname: "refresh_credit_options", every: "00:15:00", scheduled: true },
      { jobname: "reminders", every: "00:01:00", scheduled: true },
    ])
  })

  it("credit_expiring_days: default 5, between 1 and 30", async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query(
        "select column_default from information_schema.columns where table_schema = 'public' and table_name = 'business_settings' and column_name = 'credit_expiring_days'"
      )
      expect(rows[0].column_default).toBe("5")
      for (const value of [0, 31]) {
        expect(
          await queryError(
            db,
            "update public.business_settings set credit_expiring_days = $1",
            [value]
          ),
          String(value)
        ).toMatchObject({ code: "23514" })
      }
      expect(
        await queryError(
          db,
          "update public.business_settings set credit_expiring_days = 30"
        )
      ).toBeNull()
    })
  })
})
