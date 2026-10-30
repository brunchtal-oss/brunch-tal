// Story 6.7: the acceptance suite, "profile, activity and content" and
// "values and content edited in the admin" (PC7, AV4, AV6, AV7, AV9, SC7).
// Each test proves a claim the story-by-story tests left missing or weak
// (T10, T12-T17 of the spec's coverage map; T11 and T18 ship with the
// fix-public-read-leaks PR). Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { asAuthenticated, inRollback, testName, type Db } from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const PREVIEW_APPROVE =
  "select public.preview_admin_approve_payment($1, null, $2, $3, $4, $5::date, null) as r"
const CORRECT =
  "select public.admin_correct_entitlement($1, $2, $3::jsonb, $4, $5, $6, $7) as r"
const CREATE_EVENT = "select public.admin_create_event($1::jsonb, $2) as r"
const UPDATE_EVENT = "select public.admin_update_event($1, $2::jsonb, $3) as r"
const BOOK = "select public.book_session($1, $2) as r"

type Fixture = MoneyFixture & {
  single: string
  concepts: Record<string, string>
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set default_capacity_regular = 12, default_capacity_couple = 14,
         registration_close_days_before = 1,
         registration_close_local_time = '20:00'`
  )
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1)
     returning id`,
    [testName("single")]
  )
  const { rows: concepts } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  return {
    ...f,
    single: rows[0].id,
    concepts: Object.fromEntries(concepts.map((c) => [c.theme_key, c.id])),
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

async function adminOne(db: Db, f: Fixture, text: string, params: unknown[]) {
  return as(db, f.admin, async () => (await db.query(text, params)).rows[0].r)
}

// A whole row as JSON, to compare before and after.
async function rowOf(db: Db, table: string, id?: string) {
  const { rows } = await db.query(
    id
      ? `select row_to_json(t) as r from public.${table} t where id = $1`
      : `select row_to_json(t) as r from public.${table} t`,
    id ? [id] : []
  )
  return rows.map((r) => r.r)
}

async function grantCard(db: Db, f: Fixture, customerId: string) {
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

// A published regular session at 10:00 local, the next such weekday (0 =
// Sunday) at least a week ahead.
async function insertEventOn(
  db: Db,
  f: Fixture,
  weekday: number,
  displayPrice: number | null = null
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status,
       display_price_agorot)
     select $1, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true,
       'published', $3
     from (
       select ((d.today + 7 + (($2::int - extract(dow from d.today)::int + 7) % 7))
               + time '10:00') at time zone 'Asia/Jerusalem' as t
       from (select (now() at time zone 'Asia/Jerusalem')::date as today) d
     ) s
     returning id`,
    [f.concepts.mothers, weekday, displayPrice]
  )
  return rows[0].id
}

async function correct(
  db: Db,
  f: Fixture,
  entitlementId: string,
  field: string,
  value: unknown
) {
  return adminOne(db, f, CORRECT, [
    entitlementId,
    field,
    JSON.stringify(value),
    null,
    testName("correct"),
    true,
    randomUUID(),
  ])
}

async function auditOf(db: Db, action: string, entityId: string) {
  const { rows } = await db.query(
    `select entity_type, entity_id, before, after
     from public.audit_log where action = $1 and entity_id = $2
     order by created_at, id`,
    [action, entityId]
  )
  return rows
}

describe("PC7: amounts are stored in agorot", () => {
  it("T10: every *_agorot column of a public table is an integer or a bigint, and no public column is numeric, real, double precision or money", async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query(
        `select c.table_name, c.column_name, c.data_type
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
           and c.column_name like '%\\_agorot'
         order by c.table_name, c.column_name`
      )
      expect(rows.length).toBeGreaterThanOrEqual(5)
      expect(
        rows.filter((r) => !["integer", "bigint"].includes(r.data_type))
      ).toEqual([])
      // No column of a public table or view can hold a fractional amount.
      const { rows: fractional } = await db.query(
        `select table_name, column_name, data_type
         from information_schema.columns
         where table_schema = 'public'
           and data_type in ('numeric', 'real', 'double precision', 'money')
         order by table_name, column_name`
      )
      expect(fractional).toEqual([])
    })
  })
})

describe(
  "AV4: a change for one case is logged and stays in that case",
  { timeout: 60_000 },
  () => {
    it("T12: a payment approved at 44000 on a 47200 product: the audit keeps the product price and the amount; the product and the next preview stay at 47200", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const productBefore = await rowOf(db, "products", f.card)
        const r = await as(db, f.admin, () =>
          approve(db, {
            customerId: f.customerA,
            productId: f.card,
            amount: 44000,
            reason: testName("discount"),
            confirmed: true,
            paidOn: f.today,
            methodId: f.method,
            key: randomUUID(),
          })
        )
        const { rows: payments } = await db.query(
          "select amount_agorot, product_snapshot ->> 'price_agorot' as price from public.payments where id = $1",
          [r.payment_id]
        )
        expect(payments).toEqual([{ amount_agorot: 44000, price: "47200" }])
        // The approval core's row (private.approve_payment_core).
        const audit = (
          await auditOf(db, "approve_payment", r.payment_id as string)
        ).filter((a) => a.entity_type === "payments")
        expect(audit).toHaveLength(1)
        expect(audit[0].before).toEqual({})
        expect(audit[0].after).toMatchObject({
          amount_agorot: 44000,
          product_snapshot: { price_agorot: 47200 },
        })

        expect(await rowOf(db, "products", f.card)).toEqual(productBefore)
        // The next approval's form: the price is still 47200, and 44000 would
        // again be a changed price.
        const previewAt = (amount: number) =>
          adminOne(db, f, PREVIEW_APPROVE, [
            f.customerB,
            f.card,
            null,
            amount,
            f.today,
          ])
        expect(await previewAt(47200)).toMatchObject({
          price_agorot: 47200,
          amount_agorot: 47200,
          price_changed: false,
        })
        expect(await previewAt(44000)).toMatchObject({
          price_agorot: 47200,
          price_changed: true,
        })
      })
    })

    it("T13: units 4 -> 2 and weekdays null -> [0] on her card: corrections and audit with old and new; the product, the settings and another customer's card unchanged", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const card = await grantCard(db, f, f.customerA)
        const other = await grantCard(db, f, f.customerB)
        const balanceOf = async (id: string) => {
          const { rows } = await db.query(
            "select available, reserved, used from public.entitlement_balances where entitlement_id = $1",
            [id]
          )
          return rows[0]
        }
        const before = {
          product: await rowOf(db, "products", f.card),
          settings: await rowOf(db, "business_settings"),
          other: await rowOf(db, "entitlements", other),
          otherBalance: await balanceOf(other),
        }

        await correct(db, f, card, "units", 2)
        await correct(db, f, card, "allowed_weekdays", [0])

        const { rows: corrections } = await db.query(
          `select field, old_value, new_value from public.entitlement_corrections
         where entitlement_id = $1 order by field desc`,
          [card]
        )
        expect(corrections).toEqual([
          { field: "units", old_value: 4, new_value: 2 },
          { field: "allowed_weekdays", old_value: null, new_value: [0] },
        ])
        const { rows: unitsAudit } = await db.query(
          `select a.before, a.after from public.audit_log a
         join public.entitlement_movements m on m.id = a.entity_id
         where a.action = 'admin_correct_entitlement' and m.entitlement_id = $1`,
          [card]
        )
        expect(unitsAudit).toHaveLength(1)
        expect(unitsAudit[0].before).toEqual({})
        expect(unitsAudit[0].after).toMatchObject({
          action: "adjust",
          units: -2,
        })
        const termsAudit = await auditOf(db, "admin_correct_entitlement", card)
        expect(termsAudit).toHaveLength(1)
        expect(termsAudit[0].before).toMatchObject({ allowed_weekdays: null })
        expect(termsAudit[0].after).toMatchObject({ allowed_weekdays: [0] })
        expect(await balanceOf(card)).toMatchObject({ available: 2 })

        expect({
          product: await rowOf(db, "products", f.card),
          settings: await rowOf(db, "business_settings"),
          other: await rowOf(db, "entitlements", other),
          otherBalance: await balanceOf(other),
        }).toEqual(before)
      })
    })

    it("T14: a session's close time and display price: one audit row each with before and after; the settings and the concept unchanged", async () => {
      await inRollback(async (db) => {
        // The audit keeps timestamptz as text: in UTC, whatever the
        // connection's TimeZone.
        await db.query("set local timezone = 'UTC'")
        const f = await seed(db)
        const created = await adminOne(db, f, CREATE_EVENT, [
          {
            concept_id: f.concepts.mothers,
            date: "2099-05-05",
            start_time: "10:00",
            end_time: "12:00",
          },
          randomUUID(),
        ])
        const id = created.event_id as string
        const before = {
          settings: await rowOf(db, "business_settings"),
          concept: await rowOf(db, "concepts", f.concepts.mothers),
        }

        await adminOne(db, f, UPDATE_EVENT, [
          id,
          { registration_closes_local: "2099-05-04T12:00" },
          randomUUID(),
        ])
        await adminOne(db, f, UPDATE_EVENT, [
          id,
          { display_price_agorot: 9900 },
          randomUUID(),
        ])

        // Rows of one transaction share created_at: matched by their field.
        const audit = await auditOf(db, "admin_update_event", id)
        expect(audit).toHaveLength(2)
        const price = audit.find(
          (a) => a.after && "display_price_agorot" in a.after
        )
        const close = audit.find(
          (a) => a.after && "registration_closes_at" in a.after
        )
        expect(price).toEqual({
          entity_type: "events",
          entity_id: id,
          before: { display_price_agorot: null },
          after: { display_price_agorot: 9900 },
        })
        // 20:00 local the day before (17:00Z, IDT) -> 12:00 local, by hand.
        expect(close).toEqual({
          entity_type: "events",
          entity_id: id,
          before: {
            registration_closes_at: "2099-05-04T17:00:00+00:00",
            registration_close_overridden: false,
          },
          after: {
            registration_closes_at: "2099-05-04T09:00:00+00:00",
            registration_close_overridden: true,
          },
        })
        expect({
          settings: await rowOf(db, "business_settings"),
          concept: await rowOf(db, "concepts", f.concepts.mothers),
        }).toEqual(before)
      })
    })
  }
)

describe(
  "AV6: after the correction the bookings stay exactly",
  { timeout: 60_000 },
  () => {
    it.each([
      ["expires_on", "an expiry before the session"],
      ["allowed_weekdays", "Sunday only"],
    ])(
      "T15: %s (%s) with a future Tuesday booking that no longer fits: the booking, the movements and the balance are equal before and after",
      async (field) => {
        await inRollback(async (db) => {
          const f = await seed(db)
          const card = await grantCard(db, f, f.customerA)
          const tuesday = await insertEventOn(db, f, 2)
          const booking = await as(db, f.customerA, async () => {
            const { rows } = await db.query(BOOK, [tuesday, randomUUID()])
            return rows[0].r.booking_id as string
          })
          const state = async () => {
            const { rows: bookings } = await db.query(
              `select id, status, event_id, party_size, cancelled_at
             from public.bookings where customer_id = $1 order by id`,
              [f.customerA]
            )
            const { rows: movements } = await db.query(
              `select id, action, units, booking_id
             from public.entitlement_movements where entitlement_id = $1
             order by created_at, id`,
              [card]
            )
            const { rows: balance } = await db.query(
              "select available, reserved, used from public.entitlement_balances where entitlement_id = $1",
              [card]
            )
            return { bookings, movements, balance }
          }
          const before = await state()
          expect(before.bookings).toEqual([
            {
              id: booking,
              status: "confirmed",
              event_id: tuesday,
              party_size: 1,
              cancelled_at: null,
            },
          ])

          const value =
            field === "expires_on"
              ? (await db.query("select ($1::date + 2)::text as d", [f.today]))
                  .rows[0].d
              : [0]
          const r = await correct(db, f, card, field, value)
          expect(r).toMatchObject({ affected_count: 1 })
          expect(await state()).toEqual(before)
        })
      }
    )
  }
)

describe(
  "AV9: the display price changes no payment",
  { timeout: 60_000 },
  () => {
    it("T16: a session shown at 9900, a pinned product of 12800: the preview and the payment are 12800; a later display price changes no payment or entitlement", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const eventId = await insertEventOn(db, f, 3, 9900)
        const preview = await adminOne(db, f, PREVIEW_APPROVE, [
          f.customerA,
          f.single,
          eventId,
          12800,
          f.today,
        ])
        expect(preview).toMatchObject({
          price_agorot: 12800,
          amount_agorot: 12800,
          price_changed: false,
        })
        const r = await as(db, f.admin, () =>
          approve(db, {
            customerId: f.customerA,
            productId: f.single,
            eventId,
            amount: 12800,
            paidOn: f.today,
            methodId: f.method,
            key: randomUUID(),
          })
        )
        const { rows } = await db.query(
          "select id, amount_agorot from public.payments where id = $1",
          [r.payment_id]
        )
        expect(rows).toEqual([{ id: r.payment_id, amount_agorot: 12800 }])
        const { rows: ent } = await db.query(
          "select id from public.entitlements where payment_id = $1",
          [r.payment_id]
        )
        const before = {
          payment: await rowOf(db, "payments", r.payment_id as string),
          entitlement: await rowOf(db, "entitlements", ent[0].id),
        }

        await adminOne(db, f, UPDATE_EVENT, [
          eventId,
          { display_price_agorot: 15000 },
          randomUUID(),
        ])
        const { rows: shown } = await db.query(
          "select display_price_agorot from public.events where id = $1",
          [eventId]
        )
        expect(shown[0].display_price_agorot).toBe(15000)
        expect({
          payment: await rowOf(db, "payments", r.payment_id as string),
          entitlement: await rowOf(db, "entitlements", ent[0].id),
        }).toEqual(before)
      })
    })
  }
)

describe(
  "SC7: a session field change leaves the concept",
  { timeout: 60_000 },
  () => {
    it("T17: a session from 'עם סבתוש' edited (description, capacity, display price): the concept row is unchanged", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const grandma = f.concepts.grandma
        const before = await rowOf(db, "concepts", grandma)
        const created = await adminOne(db, f, CREATE_EVENT, [
          {
            concept_id: grandma,
            date: "2099-05-06",
            start_time: "10:00",
            end_time: "12:00",
          },
          randomUUID(),
        ])
        const id = created.event_id as string
        await adminOne(db, f, UPDATE_EVENT, [
          id,
          {
            description: testName("description"),
            capacity_adults: 16,
            display_price_agorot: 25000,
          },
          randomUUID(),
        ])
        const { rows } = await db.query(
          "select concept_id, kind, description, capacity_adults, display_price_agorot from public.events where id = $1",
          [id]
        )
        expect(rows).toEqual([
          {
            concept_id: grandma,
            kind: "couple",
            description: testName("description"),
            capacity_adults: 16,
            display_price_agorot: 25000,
          },
        ])
        expect(await rowOf(db, "concepts", grandma)).toEqual(before)
      })
    })
  }
)
