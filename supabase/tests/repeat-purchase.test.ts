// Story 2.5: repeat purchase for an existing customer, amount override,
// similar payments, admin_search_customers, admin_list_payments and the
// display helpers. Everything runs in inRollback, except the concurrency
// test, which commits and removes its rows in onCleanup.

import { randomUUID } from "node:crypto"

import type { QueryResult } from "pg"
import { describe, expect, it } from "vitest"

import { formatAgorot } from "@/lib/money"
import { formatDayMonth } from "@/lib/time"

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
  APPROVE,
  approve,
  approveParams,
  DEFAULT_PAYER,
  insertProduct,
  seedMoney,
  type ApproveInput,
  type MoneyFixture,
} from "./support/money"

const PREVIEW =
  "select public.preview_admin_approve_payment($1, $6, $2, null, $3, $4::date, $5) as r"
const SEARCH = "select public.admin_search_customers($1) as r"
const LIST = "select public.admin_list_payments() as r"

function cardFor(
  f: MoneyFixture,
  customerId: string | null,
  extra: Partial<ApproveInput> = {}
): ApproveInput {
  return {
    customerId,
    productId: f.card,
    amount: 47200,
    paidOn: f.today,
    methodId: f.method,
    key: randomUUID(),
    ...extra,
  }
}

async function addDays(db: Db, day: string, days: number): Promise<string> {
  const { rows } = await db.query("select ($1::date + $2::int)::text as d", [
    day,
    days,
  ])
  return rows[0].d
}

async function count(db: Db, text: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from (${text}) q`,
    params
  )
  return rows[0].n
}

async function preview(
  db: Db,
  customerId: string | null,
  f: MoneyFixture,
  extra: {
    productId?: string
    amount?: number
    paidOn?: string
    methodId?: string
    payerLabel?: string | null
  } = {}
) {
  const { rows } = await db.query(PREVIEW, [
    customerId,
    extra.productId ?? f.card,
    extra.amount ?? 47200,
    extra.paidOn ?? f.today,
    extra.methodId ?? f.method,
    extra.payerLabel ?? (customerId ? null : DEFAULT_PAYER),
  ])
  return rows[0].r
}

async function notificationsOf(db: Db, customerId: string) {
  const { rows } = await db.query(
    `select n.id, n.type, n.payload, n.target_path, n.dedupe_key,
            (select count(*)::int from public.notification_jobs j where j.notification_id = n.id) as jobs
     from public.notifications n
     where n.recipient_id = $1
     order by n.created_at, n.id`,
    [customerId]
  )
  return rows
}

// A phone of this run: 058 + 7 digits from the run id.
function testPhone(offset: number): string {
  const digits = (parseInt(testName("").slice(5, 11), 16) + 900 + offset)
    .toString()
    .padStart(7, "0")
    .slice(-7)
  return `058${digits}`
}

describe("admin_approve_payment for an existing customer", () => {
  it("adds a second card next to the first one, with purchase_repeat and the card tip", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const firstPaidOn = await addDays(db, f.today, -20)
      await asAuthenticated(db, f.admin)
      const first = await approve(
        db,
        cardFor(f, f.customerA, { paidOn: firstPaidOn })
      )
      await db.query("reset role")
      const { rows: before } = await db.query(
        "select * from public.entitlements where id = $1",
        [first.entitlement_id]
      )

      await asAuthenticated(db, f.admin)
      const second = await approve(db, cardFor(f, f.customerA))
      expect(Object.keys(second).sort()).toEqual([
        "customer_id",
        "entitlement_id",
        "expires_on",
        "payment_id",
        "product_name",
        "units",
      ])
      expect(second.customer_id).toBe(f.customerA)
      expect(second.product_name).toBe(testName("card"))
      expect(second.units).toBe(4)
      expect(second.expires_on).toBe(await addDays(db, f.today, 49))

      await db.query("reset role")
      const { rows: after } = await db.query(
        "select * from public.entitlements where id = $1",
        [first.entitlement_id]
      )
      expect(after).toEqual(before)

      const { rows: entitlements } = await db.query(
        `select e.id, e.customer_id, e.bound_at, pay.customer_id as payment_customer
         from public.entitlements e
         join public.payments pay on pay.id = e.payment_id
         where e.id = $1`,
        [second.entitlement_id]
      )
      expect(entitlements).toEqual([
        {
          id: second.entitlement_id,
          customer_id: f.customerA,
          bound_at: null,
          payment_customer: f.customerA,
        },
      ])
      expect(
        await count(
          db,
          "select 1 from public.activation_tokens where payment_id = any($1::uuid[])",
          [[first.payment_id, second.payment_id]]
        )
      ).toBe(0)

      const { rows: tip } = await db.query(
        "select body from public.notification_templates where type = 'purchase_new_card'"
      )
      const { rows: names } = await db.query(
        "select name from public.products where id = $1",
        [f.card]
      )
      const notifications = await notificationsOf(db, f.customerA)
      expect(notifications).toHaveLength(2)
      const latest = notifications.find(
        (n) =>
          n.dedupe_key === `purchase_repeat:${f.customerA}:${second.payment_id}`
      )
      expect(latest).toMatchObject({
        type: "purchase_repeat",
        target_path: "/me",
        jobs: 1,
      })
      expect(latest!.payload.body).toBe(
        `${names[0].name}, בתוקף עד ${formatDayMonth(second.expires_on as string)}. ${tip[0].body}`
      )

      // /me: two separate cards, each with its own balance.
      await asAuthenticated(db, f.customerA)
      const { rows: balances } = await db.query(
        "select entitlement_id, available, expired_before_bound from public.entitlement_balances order by valid_from"
      )
      expect(balances).toEqual([
        {
          entitlement_id: first.entitlement_id,
          available: 4,
          expired_before_bound: false,
        },
        {
          entitlement_id: second.entitlement_id,
          available: 4,
          expired_before_bound: false,
        },
      ])
    })
  })

  it("sends purchase_repeat without the tip for a product that is not a card", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const single = await insertProduct(db, {
        label: "days_single",
        type: "single",
        price: 12800,
        units: 1,
      })
      await asAuthenticated(db, f.admin)
      const r = await approve(
        db,
        cardFor(f, f.customerA, { productId: single, amount: 12800 })
      )
      await db.query("reset role")
      const notifications = await notificationsOf(db, f.customerA)
      expect(notifications).toHaveLength(1)
      expect(notifications[0].payload.body).toBe(
        `${testName("days_single")}, בתוקף עד ${formatDayMonth(r.expires_on as string)}`
      )
    })
  })

  it("returns the same result for the same key: one payment, entitlement and notification", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const input = cardFor(f, f.customerA)
      const first = await approve(db, input)
      const again = await approve(db, input)
      expect(again).toEqual(first)
      await db.query("reset role")
      expect(
        await count(db, "select 1 from public.payments where product_id = $1", [
          f.card,
        ])
      ).toBe(1)
      expect(
        await count(
          db,
          "select 1 from public.entitlements where payment_id = $1",
          [first.payment_id]
        )
      ).toBe(1)
      const notifications = await notificationsOf(db, f.customerA)
      expect(notifications.map((n) => [n.type, n.jobs])).toEqual([
        ["purchase_repeat", 1],
      ])
    })
  })

  it("refuses a customer that does not exist or was anonymized, creating nothing", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerB]
      )
      await asAuthenticated(db, f.admin)
      for (const customerId of [randomUUID(), f.customerB]) {
        expect(
          await queryError(db, APPROVE, approveParams(cardFor(f, customerId)))
        ).toMatchObject({ code: "P0001", message: "CUSTOMER_NOT_AVAILABLE" })
        expect(
          await queryError(db, PREVIEW, [
            customerId,
            f.card,
            47200,
            f.today,
            f.method,
            null,
          ])
        ).toMatchObject({ code: "P0001", message: "CUSTOMER_NOT_AVAILABLE" })
      }
      await db.query("reset role")
      expect(
        await count(db, "select 1 from public.payments where product_id = $1", [
          f.card,
        ])
      ).toBe(0)
    })
  })

  it("requires the confirmation of a changed amount and logs the new amount", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      expect(
        await queryError(
          db,
          APPROVE,
          approveParams(cardFor(f, f.customerA, { amount: 44000 }))
        )
      ).toMatchObject({ code: "P0001", message: "CONFIRM_REQUIRED" })

      const r = await approve(
        db,
        cardFor(f, f.customerA, {
          amount: 44000,
          reason: "  ",
          confirmed: true,
        })
      )
      await db.query("reset role")
      const { rows } = await db.query(
        `select reason, after ->> 'amount_agorot' as amount
         from public.audit_log where entity_type = 'payments' and entity_id = $1`,
        [r.payment_id]
      )
      expect(rows).toEqual([{ reason: null, amount: "44000" }])
    })
  })
})

describe("similar payments", () => {
  it("are shown within the window and need the confirmation", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const weekAgo = await addDays(db, f.today, -7)
      await asAuthenticated(db, f.admin)
      await approve(db, cardFor(f, f.customerA, { paidOn: weekAgo }))

      const plan = await preview(db, f.customerA, f)
      expect(plan.customer_name).toBe(testName("money_a"))
      expect(plan.duplicate_window_days).toBe(7)
      expect(plan.expired).toBe(false)
      expect(plan.similar_payments).toEqual([
        {
          customer_name: testName("money_a"),
          payer_label: null,
          paid_on: weekAgo,
          created_at: expect.any(String),
        },
      ])
      // A new customer sees it only under the same name (2026-10-05).
      expect((await preview(db, null, f)).similar_payments).toEqual([])
      expect(
        (await preview(db, null, f, { payerLabel: testName("money_a") }))
          .similar_payments
      ).toHaveLength(1)

      expect(
        await queryError(db, APPROVE, approveParams(cardFor(f, f.customerA)))
      ).toMatchObject({ code: "P0001", message: "DUPLICATE_CONFIRM_REQUIRED" })
      expect(
        await queryError(
          db,
          APPROVE,
          approveParams(cardFor(f, null, { payerLabel: testName("money_a") }))
        )
      ).toMatchObject({ code: "P0001", message: "DUPLICATE_CONFIRM_REQUIRED" })

      const saved = await approve(
        db,
        cardFor(f, f.customerA, { duplicateConfirmed: true })
      )
      expect(saved.customer_id).toBe(f.customerA)
    })
  })

  it("include a payment up to the window after the purchase date, and follow the setting", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const weekAgo = await addDays(db, f.today, -7)
      const yesterday = await addDays(db, f.today, -1)
      await asAuthenticated(db, f.admin)
      await approve(db, cardFor(f, f.customerA))
      // The existing payment is 7 days after the new purchase date.
      expect(
        (await preview(db, f.customerA, f, { paidOn: weekAgo }))
          .similar_payments
      ).toHaveLength(1)

      await db.query("reset role")
      await db.query(
        "update public.business_settings set duplicate_payment_window_days = 0"
      )
      await asAuthenticated(db, f.admin)
      const plan = await preview(db, f.customerA, f, { paidOn: yesterday })
      expect(plan.duplicate_window_days).toBe(0)
      expect(plan.similar_payments).toEqual([])
    })
  })

  it("ignore 8 days, another method and another customer, but not an unbound payment under her name", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const eightAgo = await addDays(db, f.today, -8)
      const { rows: methods } = await db.query(
        `insert into public.payment_methods (name, sort_order) values ($1, 903) returning id`,
        [testName("other_method")]
      )
      const otherMethod = methods[0].id as string
      await asAuthenticated(db, f.admin)

      await approve(db, cardFor(f, f.customerA, { paidOn: eightAgo }))
      expect((await preview(db, f.customerA, f)).similar_payments).toEqual([])

      await approve(db, cardFor(f, f.customerA, { methodId: otherMethod }))
      expect((await preview(db, f.customerA, f)).similar_payments).toEqual([])

      await approve(db, cardFor(f, f.customerB))
      expect((await preview(db, f.customerA, f)).similar_payments).toEqual([])
      // ...but a new customer under that customer's name sees it.
      expect(
        (await preview(db, null, f, { payerLabel: testName("money_b") }))
          .similar_payments
      ).toHaveLength(1)

      // An unbound payment: only under her name (2026-10-05).
      await approve(db, cardFor(f, null, { duplicateConfirmed: true }))
      expect((await preview(db, f.customerA, f)).similar_payments).toEqual([])
      await approve(
        db,
        cardFor(f, null, {
          payerLabel: ` ${testName("MONEY_A")} `,
          duplicateConfirmed: true,
        })
      )
      const similar = (await preview(db, f.customerA, f)).similar_payments
      expect(similar).toEqual([
        {
          customer_name: null,
          payer_label: testName("MONEY_A"),
          paid_on: f.today,
          created_at: expect.any(String),
        },
      ])
    })
  })
})

describe("a purchase date long ago", () => {
  it("is saved for an existing customer, shown as expired on /me and warned in the preview", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const paidOn = await addDays(db, f.today, -60)
      await asAuthenticated(db, f.admin)
      expect((await preview(db, f.customerA, f, { paidOn })).expired).toBe(true)
      expect((await preview(db, null, f, { paidOn })).expired).toBe(true)
      const r = await approve(db, cardFor(f, f.customerA, { paidOn }))

      await db.query("reset role")
      await asAuthenticated(db, f.customerA)
      const { rows } = await db.query(
        "select is_expired, expired_before_bound from public.entitlement_balances where entitlement_id = $1",
        [r.entitlement_id]
      )
      expect(rows).toEqual([{ is_expired: true, expired_before_bound: true }])
    })
  })

  it("sends purchase_repeat for an expired card without the booking tip", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const paidOn = await addDays(db, f.today, -60)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, cardFor(f, f.customerA, { paidOn }))
      await db.query("reset role")
      const notifications = await notificationsOf(db, f.customerA)
      expect(notifications).toHaveLength(1)
      expect(notifications[0].payload.body).toBe(
        `${testName("card")}, בתוקף עד ${formatDayMonth(r.expires_on as string)}`
      )
    })
  })
})

describe("admin_search_customers", () => {
  it("finds by part of the name or by the phone in any format, never an anonymized customer", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const phone = testPhone(1)
      const e164 = `+972${phone.slice(1)}`
      await db.query(
        "update public.profiles set phone_e164 = $1 where id = $2",
        [e164, f.customerA]
      )
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerB]
      )
      await asAuthenticated(db, f.admin)
      const search = async (query: string) =>
        ((await db.query(SEARCH, [query])).rows[0].r as { id: string }[]).map(
          (row) => row.id
        )

      const a = {
        id: f.customerA,
        full_name: testName("money_a"),
        phone_e164: e164,
      }
      expect((await db.query(SEARCH, [testName("money_a")])).rows[0].r).toEqual(
        [a]
      )
      // Part of the name, any case.
      expect(await search(testName("money_").toUpperCase())).toEqual([
        f.customerA,
      ])
      for (const query of [
        `${phone.slice(0, 3)}-${phone.slice(3)}`,
        e164,
        `+972 ${phone.slice(1, 3)} ${phone.slice(3)}`,
      ]) {
        expect(await search(query), query).toEqual([f.customerA])
      }
      // A run of digits may match other fictitious phones too.
      expect(await search(phone.slice(-6))).toContain(f.customerA)
      expect(await search(testName("money_b"))).toEqual([])

      for (const query of ["a", " a ", "", "x".repeat(101)]) {
        expect(await queryError(db, SEARCH, [query]), query).toMatchObject({
          code: "P0001",
          message: "INVALID_INPUT",
        })
      }
    })
  })
})

describe("admin_list_payments", () => {
  it("lists the latest payments from the snapshot, newest first", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const unbound = await approve(
        db,
        cardFor(f, null, { reference: "ref-1", note: "n-1" })
      )
      const bound = await approve(
        db,
        cardFor(f, f.customerA, {
          amount: 44000,
          reason: "friend",
          confirmed: true,
        })
      )
      const { rows } = await db.query(LIST)
      const list = rows[0].r as Record<string, unknown>[]
      expect(list.length).toBeLessThanOrEqual(50)
      const ours = list.filter((row) =>
        [unbound.payment_id, bound.payment_id].includes(row.payment_id)
      )
      // Both were created in this transaction (same created_at): by id.
      expect(ours).toHaveLength(2)
      const byId = Object.fromEntries(ours.map((row) => [row.payment_id, row]))
      expect(byId[unbound.payment_id as string]).toMatchObject({
        customer_id: null,
        customer_name: null,
        product_name: testName("card"),
        price_agorot: 47200,
        amount_agorot: 47200,
        payment_method_name: testName("method"),
        paid_on: f.today,
        amount_override_reason: null,
        reference: "ref-1",
        note: "n-1",
      })
      expect(byId[bound.payment_id as string]).toMatchObject({
        customer_id: f.customerA,
        customer_name: testName("money_a"),
        amount_agorot: 44000,
        price_agorot: 47200,
        amount_override_reason: "friend",
        reference: null,
        note: null,
      })
    })
  })
})

describe("permissions", () => {
  it("refuses a customer (NOT_AUTHORIZED) and anon (42501) on every new RPC", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const calls: [string, unknown[]][] = [
        [APPROVE, approveParams(cardFor(f, f.customerA))],
        [PREVIEW, [f.customerA, f.card, 47200, f.today, f.method, null]],
        [SEARCH, ["money"]],
        [LIST, []],
      ]
      await asAuthenticated(db, f.customerA)
      for (const [query, params] of calls) {
        expect(await queryError(db, query, params), query).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
      await db.query("reset role")
      await db.query("set local role anon")
      for (const [query, params] of calls) {
        expect((await queryError(db, query, params))?.code, query).toBe("42501")
      }
    })
  })
})

describe("display helpers", () => {
  it("format_agorot matches formatAgorot", async () => {
    await inRollback(async (db) => {
      for (const agorot of [
        0, 5, 12750, 47200, 123400, 100000000, -12750, 2147483647,
      ]) {
        const { rows } = await db.query(
          "select private.format_agorot($1) as v",
          [agorot]
        )
        expect(rows[0].v, String(agorot)).toBe(formatAgorot(agorot))
      }
    })
  })

  it("format_day_month matches formatDayMonth", async () => {
    await inRollback(async (db) => {
      for (const day of ["2026-01-05", "2026-10-25", "2026-12-31"]) {
        const { rows } = await db.query(
          "select private.format_day_month($1::date) as v",
          [day]
        )
        expect(rows[0].v).toBe(formatDayMonth(day))
      }
    })
  })

  it("have no grant to any API role", async () => {
    await inRollback(async (db) => {
      await asAuthenticated(db, randomUUID())
      for (const fn of [
        "select private.format_agorot(100)",
        "select private.format_day_month(current_date)",
      ]) {
        expect((await queryError(db, fn))?.code, fn).toBe("42501")
      }
    })
  })
})

describe("similar approvals under concurrency", () => {
  it("the second waits on the advisory lock, then needs the duplicate confirmation", async () => {
    // Committed fixtures: the lock matters only across transactions.
    const admin = randomUUID()
    const product = randomUUID()
    const method = randomUUID()
    onCleanup(async () => {
      const client = await getPool().connect()
      try {
        await client.query("begin")
        const payments = `select id from public.payments where product_id = $1`
        const entitlements = `select id from public.entitlements where payment_id in (${payments})`
        // entitlement_movements is append-only (a trigger raises on delete);
        // the trigger is off only inside this cleanup transaction.
        await client.query(
          "alter table public.entitlement_movements disable trigger entitlement_movements_no_update_delete"
        )
        await client.query(
          `delete from public.entitlement_movements where entitlement_id in (${entitlements})`,
          [product]
        )
        await client.query(
          "alter table public.entitlement_movements enable trigger entitlement_movements_no_update_delete"
        )
        await client.query(
          `delete from public.audit_log
           where entity_id in (${payments}) or entity_id in (${entitlements})
              or entity_id in (select id from public.activation_tokens where payment_id in (${payments}))`,
          [product]
        )
        await client.query(
          `delete from public.activation_tokens where payment_id in (${payments})`,
          [product]
        )
        await client.query(
          `delete from public.entitlements where payment_id in (${payments})`,
          [product]
        )
        await client.query(
          "delete from public.payments where product_id = $1",
          [product]
        )
        await client.query(
          "delete from private.idempotency_results where actor_scope = $1",
          [admin]
        )
        await client.query("delete from public.products where id = $1", [
          product,
        ])
        await client.query("delete from public.payment_methods where id = $1", [
          method,
        ])
        await client.query(
          "delete from public.admin_roles where user_id = $1",
          [admin]
        )
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    })
    await sql("insert into public.admin_roles (user_id) values ($1)", [admin])
    await sql(
      `insert into public.products (
         id, name, type, price_agorot, units, validity_mode, validity_days,
         allowed_weekdays, eligible_event_kind, party_size)
       values ($1, $2, 'card', 47200, 4, 'days', 49, '{1,4}', 'regular', 1)`,
      [product, testName("concurrent_card")]
    )
    await sql(
      "insert into public.payment_methods (id, name, sort_order) values ($1, $2, 904)",
      [method, testName("concurrent_method")]
    )
    const [{ today }] = await sql<{ today: string }>(
      "select ((now() at time zone 'Asia/Jerusalem')::date)::text as today"
    )
    const input = (): ApproveInput => ({
      customerId: null,
      productId: product,
      amount: 47200,
      paidOn: today,
      methodId: method,
      key: randomUUID(),
    })

    // Both pool connections (max: 2); while B waits only A queries.
    const a = await getPool().connect()
    const b = await getPool().connect()
    let committed = false
    let second: Promise<QueryResult> | undefined
    try {
      await a.query("begin")
      await asAuthenticated(a, admin)
      await a.query(APPROVE, approveParams(input()))

      await b.query("begin")
      await asAuthenticated(b, admin)
      const { rows: pidRows } = await b.query<{ pid: number }>(
        "select pg_backend_pid() as pid"
      )
      const bPid = pidRows[0].pid

      // Another key, the same product, amount and method, no confirmation.
      second = b.query(APPROVE, approveParams(input()))
      // Keep a rejection of B from going unhandled while it is not awaited.
      second.catch(() => {})

      // From A (idle in its open transaction): B must be waiting on a lock.
      // A's approval is done; back to the owner, since authenticated cannot
      // see another backend in pg_stat_activity. The stats snapshot is cached
      // per transaction, so clear it each try.
      await a.query("reset role")
      let waitsOnLock = false
      for (let tries = 0; tries < 50 && !waitsOnLock; tries++) {
        await a.query("select pg_stat_clear_snapshot()")
        const { rows } = await a.query<{ wait_event_type: string | null }>(
          "select wait_event_type from pg_stat_activity where pid = $1",
          [bPid]
        )
        waitsOnLock = rows[0]?.wait_event_type === "Lock"
        if (!waitsOnLock) await new Promise((r) => setTimeout(r, 100))
      }
      expect(waitsOnLock).toBe(true)

      await a.query("commit")
      committed = true

      await expect(second).rejects.toMatchObject({
        code: "P0001",
        message: "DUPLICATE_CONFIRM_REQUIRED",
      })
    } finally {
      // A rollback of A releases B; B must finish before it goes back.
      if (!committed) await a.query("rollback").catch(() => {})
      await second?.catch(() => {})
      await b.query("rollback").catch(() => {})
      a.release()
      b.release()
    }

    const rows = await sql<{ n: number }>(
      "select count(*)::int as n from public.payments where product_id = $1",
      [product]
    )
    expect(rows[0].n).toBe(1)
  }, 30_000)
})

describe("payer label (שם לזיהוי)", () => {
  it("finds a payment only under the same name (any case, outer spaces)", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, cardFor(f, null, { payerLabel: "  מיכל " }))

      const similar = async (payerLabel: string | null) =>
        (await preview(db, null, f, { payerLabel })).similar_payments
      expect(await similar("דנה")).toEqual([])
      expect(await similar(" מיכל ")).toEqual([
        {
          customer_name: null,
          payer_label: "מיכל",
          paid_on: f.today,
          created_at: expect.any(String),
        },
      ])

      // Mixed case of a Latin label is the same payer.
      const latin = await approve(db, cardFor(f, null, { payerLabel: "Noa" }))
      expect(latin.payment_id).not.toBe(r.payment_id)
      expect(
        (await similar(" noa ")).map(
          (p: { payer_label: string }) => p.payer_label
        )
      ).toEqual(["Noa"])

      // A payment without a name (from before 2026-10-05) never matches.
      await db.query("reset role")
      await db.query(
        "update public.payments set payer_label = null where id = $1",
        [latin.payment_id]
      )
      await asAuthenticated(db, f.admin)
      expect(await similar("Noa")).toEqual([])

      // The approval follows the same rule.
      expect(
        await queryError(
          db,
          APPROVE,
          approveParams(cardFor(f, null, { payerLabel: "מיכל" }))
        )
      ).toMatchObject({ code: "P0001", message: "DUPLICATE_CONFIRM_REQUIRED" })
    })
  })

  it("saves the trimmed label, refuses an empty one, and audits it masked", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const named = await approve(
        db,
        cardFor(f, null, { payerLabel: " מיכל " })
      )
      // A new customer's name is required (2026-10-05).
      expect(
        await queryError(
          db,
          APPROVE,
          approveParams(
            cardFor(f, null, { payerLabel: "   ", duplicateConfirmed: true })
          )
        )
      ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      await db.query("reset role")
      const { rows } = await db.query(
        "select id, payer_label from public.payments where id = $1",
        [named.payment_id]
      )
      expect(rows[0].payer_label).toBe("מיכל")

      const { rows: audit } = await db.query(
        `select before::text as before, after::text as after
         from public.audit_log
         where entity_type = 'payments' and entity_id = $1`,
        [named.payment_id]
      )
      expect(audit.length).toBeGreaterThanOrEqual(2)
      for (const row of audit) {
        expect(row.before).not.toContain("מיכל")
        expect(row.after).not.toContain("מיכל")
      }
      expect(
        audit.some((row) => JSON.parse(row.after).payer_label === "<changed>")
      ).toBe(true)
    })
  })

  it("refuses a label over 40 characters or with an existing customer", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      for (const input of [
        cardFor(f, null, { payerLabel: "x".repeat(41) }),
        cardFor(f, f.customerA, { payerLabel: "Dana" }),
      ]) {
        expect(
          await queryError(db, APPROVE, approveParams(input))
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      for (const [customerId, payerLabel] of [
        [null, "x".repeat(41)],
        [f.customerA, "Dana"],
      ]) {
        expect(
          await queryError(db, PREVIEW, [
            customerId,
            f.card,
            47200,
            f.today,
            f.method,
            payerLabel,
          ])
        ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      // 40 characters are allowed.
      const ok = await approve(
        db,
        cardFor(f, null, { payerLabel: "x".repeat(40) })
      )
      expect(ok.payment_id).toEqual(expect.any(String))
      await db.query("reset role")
      expect(
        await count(db, "select 1 from public.payments where product_id = $1", [
          f.card,
        ])
      ).toBe(1)
    })
  })

  it("is returned by the links and payments lists, and never read by a customer", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, cardFor(f, null, { payerLabel: "מיכל" }))

      const { rows: links } = await db.query(
        "select public.admin_list_links() as r"
      )
      const link = (links[0].r as Record<string, unknown>[]).find(
        (row) => row.token_id === r.token_id
      )
      expect(link).toMatchObject({ payer_label: "מיכל" })

      const { rows: payments } = await db.query(LIST)
      const payment = (payments[0].r as Record<string, unknown>[]).find(
        (row) => row.payment_id === r.payment_id
      )
      expect(payment).toMatchObject({ payer_label: "מיכל" })

      await db.query("reset role")
      await asAuthenticated(db, f.customerA)
      expect(
        (await queryError(db, "select payer_label from public.payments"))?.code
      ).toBe("42501")
    })
  })

  it("is no longer on any link of the payment once the customer joined", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, cardFor(f, null, { payerLabel: "מיכל" }))
      // The link is replaced: the first one is revoked, a second one is live.
      await db.query("select public.admin_issue_link('join', $1, $2)", [
        r.payment_id,
        randomUUID(),
      ])

      // The customer joins through the replacement (the binding itself).
      await db.query("reset role")
      await db.query("select private.bind_purchase($1, $2)", [
        r.payment_id,
        f.customerA,
      ])

      await asAuthenticated(db, f.admin)
      const { rows } = await db.query("select public.admin_list_links() as r")
      const ofPayment = (rows[0].r as Record<string, unknown>[]).filter(
        (row) => row.payment_id === r.payment_id
      )
      expect(ofPayment).toHaveLength(2)
      for (const row of ofPayment) expect(row.payer_label).toBeNull()
    })
  })
})

// Story 3.11, after the phone test (user decisions 2026-10-05).
describe("similar payments: two names or two sessions are two purchases", () => {
  const PINNED_PREVIEW =
    "select public.preview_admin_approve_payment(null, $1, $2, $3, $4, $5::date, $6) as r"

  it("the typed label against a bound customer's name: different -> not similar, the same (any case) -> similar", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      await approve(db, cardFor(f, f.customerA))

      const similar = async (payerLabel: string | null) =>
        (await preview(db, null, f, { payerLabel })).similar_payments
      expect(await similar("Noa")).toEqual([])
      expect(await similar(` ${testName("MONEY_A")} `)).toHaveLength(1)
    })
  })

  it("a pinned purchase for another session is not similar; the same name and session still warns", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const { rows: products } = await db.query(
        `insert into public.products (
           name, type, price_agorot, units, validity_mode, validity_days,
           allowed_weekdays, eligible_event_kind, party_size)
         values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1)
         returning id`,
        [testName("single")]
      )
      const single = products[0].id
      const session = async (days: number) => {
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
        return rows[0].id as string
      }
      const first = await session(7)
      const second = await session(14)

      await asAuthenticated(db, f.admin)
      const pinned = (eventId: string, extra: Partial<ApproveInput> = {}) =>
        cardFor(f, null, {
          productId: single,
          eventId,
          amount: 12800,
          payerLabel: "Noa",
          ...extra,
        })
      await approve(db, pinned(first))

      const similar = async (eventId: string, payerLabel: string) => {
        const { rows } = await db.query(PINNED_PREVIEW, [
          payerLabel,
          single,
          eventId,
          12800,
          f.today,
          f.method,
        ])
        return rows[0].r.similar_payments
      }
      expect(await similar(second, "Noa")).toEqual([])
      expect(await similar(first, " noa ")).toHaveLength(1)
      expect(
        await queryError(db, APPROVE, approveParams(pinned(first)))
      ).toMatchObject({ code: "P0001", message: "DUPLICATE_CONFIRM_REQUIRED" })
      const other = await approve(db, pinned(second))
      expect(other.booking_id).toEqual(expect.any(String))
    })
  })
})
