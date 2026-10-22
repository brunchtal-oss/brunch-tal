// Story 5.22: video-clear's SQL (scripts/video-sql.mjs) against Postgres.
// A small world (its own random email domain, a filming admin, a customer,
// a session it created, a purchase, a booking, a movement and a traced board
// note) next to non-world rows; then worldSetSql + guardSql + deleteSql.
// Each guard fires on its planted row, and the delete leaves every non-world
// row. Everything runs in inRollback; onCleanup only checks nothing of the
// domain survived.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { deleteSql, guardSql, worldSetSql } from "../../scripts/video-sql.mjs"
import {
  inRollback,
  insertAuthUser,
  onCleanup,
  runId,
  sql,
  testName,
  type Db,
} from "./support/db"
import { insertProduct } from "./support/money"

// A domain of this run only (runId = test_<12 hex>).
const DOMAIN = `v${runId.slice("test_".length)}.test`
const ADMIN_EMAIL = `admin@${DOMAIN}`
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

onCleanup(async () => {
  const left = await sql(
    "select id from auth.users where lower(email) like $1",
    [`%@${DOMAIN}`]
  )
  expect(left).toEqual([])
})

type World = {
  admin: string
  customer: string
  outsider: string
  event: string
  otherEvent: string
  payment: string
  entitlement: string
  booking: string
  note: string
  otherNote: string
  outsiderBooking: string
  product: string
  method: string
}

async function domainUser(db: Db, local: string): Promise<string> {
  const id = randomUUID()
  await db.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', $2, '', now(), now(), now(), '{}', '{}')`,
    [id, `${local}@${DOMAIN}`]
  )
  return id
}

async function insertEvent(db: Db): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, registration_closes_at,
       capacity_adults, status)
     select c.id, 'regular', now() + interval '10 days',
       now() + interval '10 days 4 hours', now() + interval '9 days', 12,
       'published'
     from public.concepts c where c.archived_at is null
     order by c.id limit 1
     returning id`
  )
  return rows[0].id
}

async function insertPayment(
  db: Db,
  w: { product: string; method: string },
  customer: string | null,
  recordedBy: string
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.payments (
       customer_id, product_id, amount_agorot, paid_on, payment_method_id,
       recorded_by, source, product_snapshot, payer_label)
     values ($1, $2, 47200, current_date, $3, $4, 'manual', '{}', $5)
     returning id`,
    [customer, w.product, w.method, recordedBy, customer ? null : "payer"]
  )
  return rows[0].id
}

async function insertEntitlement(
  db: Db,
  customer: string,
  payment: string
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.entitlements (
       customer_id, payment_id, kind, original_units, valid_from, expires_on,
       eligibility_snapshot, eligible_event_kind)
     values ($1, $2, 'card', 4, current_date, current_date + 49,
       '{"validity_mode": "days"}', 'regular')
     returning id`,
    [customer, payment]
  )
  return rows[0].id
}

async function insertBooking(
  db: Db,
  customer: string,
  event: string
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.bookings (
       customer_id, event_id, party_size, booked_by, policy_snapshot, status)
     values ($1, $2, 1, 'admin', ${SNAPSHOT}, 'confirmed')
     returning id`,
    [customer, event]
  )
  return rows[0].id
}

async function insertNote(db: Db, body: string): Promise<string> {
  const { rows } = await db.query(
    "insert into public.notes (body, sort_order) values ($1, -999) returning id",
    [body]
  )
  return rows[0].id
}

// A board note traced to the admin, as admin_add_note stores it (D10).
async function traceNote(db: Db, admin: string, note: string): Promise<void> {
  await db.query(
    `insert into private.idempotency_results
       (actor_scope, rpc, key, request_hash, result)
     values ($1, 'admin_add_note', $2, 'test', jsonb_build_object('note_id', $3::text))`,
    [admin, randomUUID(), note]
  )
}

async function seedWorld(db: Db): Promise<World> {
  const admin = await domainUser(db, "admin")
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  const customer = await domainUser(db, "customer")
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, 'לקוחה מהעולם', now())",
    [customer]
  )
  const outsiderUser = await insertAuthUser(db, "video_outsider")
  const outsider = outsiderUser.id
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [outsider, testName("video_outsider")]
  )
  const product = await insertProduct(db, { label: "video_card" })
  const { rows: methods } = await db.query(
    "insert into public.payment_methods (name, sort_order, hidden) values ($1, 990, false) returning id",
    [testName("video_method")]
  )
  const method = methods[0].id

  const event = await insertEvent(db)
  await db.query(
    `insert into public.audit_log (actor_id, actor_kind, action, entity_type, entity_id, event_id)
     values ($1, 'admin', 'admin_create_event', 'events', $2, $2)`,
    [admin, event]
  )
  const otherEvent = await insertEvent(db)

  const payment = await insertPayment(db, { product, method }, customer, admin)
  const entitlement = await insertEntitlement(db, customer, payment)
  const booking = await insertBooking(db, customer, event)
  await db.query(
    `insert into public.booking_allocations (booking_id, entitlement_id, units)
     values ($1, $2, 1)`,
    [booking, entitlement]
  )
  await db.query(
    `insert into public.entitlement_movements (entitlement_id, booking_id, action, units, actor_id)
     values ($1, $2, 'reserve', -1, $3)`,
    [entitlement, booking, admin]
  )
  const note = await insertNote(db, "פתק מהצילום")
  await traceNote(db, admin, note)

  // Not of the world: a board note, and the outsider's booking on a session
  // the filming admin did not create.
  const otherNote = await insertNote(db, testName("own_note"))
  const outsiderBooking = await insertBooking(db, outsider, otherEvent)

  return {
    admin,
    customer,
    outsider,
    event,
    otherEvent,
    payment,
    entitlement,
    booking,
    note,
    otherNote,
    outsiderBooking,
    product,
    method,
  }
}

async function buildSet(db: Db): Promise<void> {
  for (const statement of worldSetSql({
    adminEmail: ADMIN_EMAIL,
    domain: DOMAIN,
  })) {
    await db.query(statement)
  }
}

async function guards(db: Db): Promise<{ reason: string; id: string }[]> {
  const { rows } = await db.query(guardSql({ domain: DOMAIN }))
  return rows
}

const exists = async (db: Db, table: string, column: string, id: string) =>
  (await db.query(`select 1 from ${table} where ${column} = $1`, [id]))
    .rowCount === 1

describe("video-clear against Postgres", () => {
  it("passes the guards on a clean world and deletes only the world", async () => {
    await inRollback(async (db) => {
      const w = await seedWorld(db)
      await buildSet(db)
      expect(await guards(db)).toEqual([])

      for (const statement of deleteSql()) await db.query(statement)

      // The world is gone, the filming admin's role included.
      expect(await exists(db, "auth.users", "id", w.admin)).toBe(false)
      expect(await exists(db, "auth.users", "id", w.customer)).toBe(false)
      expect(await exists(db, "public.admin_roles", "user_id", w.admin)).toBe(
        false
      )
      expect(await exists(db, "public.profiles", "id", w.customer)).toBe(false)
      expect(await exists(db, "public.events", "id", w.event)).toBe(false)
      expect(await exists(db, "public.payments", "id", w.payment)).toBe(false)
      expect(await exists(db, "public.entitlements", "id", w.entitlement)).toBe(
        false
      )
      expect(await exists(db, "public.bookings", "id", w.booking)).toBe(false)
      expect(
        await exists(
          db,
          "public.entitlement_movements",
          "booking_id",
          w.booking
        )
      ).toBe(false)
      expect(await exists(db, "public.notes", "id", w.note)).toBe(false)
      expect(await exists(db, "public.audit_log", "entity_id", w.event)).toBe(
        false
      )

      // Everything else stays.
      expect(await exists(db, "auth.users", "id", w.outsider)).toBe(true)
      expect(await exists(db, "public.profiles", "id", w.outsider)).toBe(true)
      expect(await exists(db, "public.events", "id", w.otherEvent)).toBe(true)
      expect(await exists(db, "public.bookings", "id", w.outsiderBooking)).toBe(
        true
      )
      expect(await exists(db, "public.notes", "id", w.otherNote)).toBe(true)
      expect(await exists(db, "public.products", "id", w.product)).toBe(true)
    })
  })

  it("stops on a non-world row in a world session, credit option or correction, and on a test_ row", async () => {
    await inRollback(async (db) => {
      const w = await seedWorld(db)
      // foreign_booking: the outsider on the world session.
      const booking = await insertBooking(db, w.outsider, w.event)
      // foreign_waitlist: the outsider waits for it.
      const { rows: waits } = await db.query(
        `insert into public.waitlist_entries (customer_id, event_id, party_size)
         values ($1, $2, 1) returning id`,
        [w.outsider, w.event]
      )
      // The outsider's own purchase (another admin recorded it).
      const payment = await insertPayment(db, w, w.outsider, randomUUID())
      const entitlement = await insertEntitlement(db, w.outsider, payment)
      // foreign_credit_option: her credit offers the world session.
      const { rows: credits } = await db.query(
        `insert into public.cancellation_credits (
           customer_id, origin_booking_id, source_entitlement_id, event_kind,
           party_size, options_count, origin_starts_at, original_cancelled_at,
           monetary_basis_agorot, status)
         values ($1, $2, $3, 'regular', 1, 2, now(), now(), 11800, 'active')
         returning id`,
        [w.outsider, w.outsiderBooking, entitlement]
      )
      const { rows: options } = await db.query(
        `insert into public.credit_options (credit_id, event_id, state, added_by)
         values ($1, $2, 'active', 'system') returning id`,
        [credits[0].id, w.event]
      )
      // foreign_correction: the filming admin corrects her entitlement.
      const { rows: corrections } = await db.query(
        `insert into public.entitlement_corrections (
           entitlement_id, field, old_value, new_value, actor_id, actor_kind)
         values ($1, 'expires_on', '"2026-01-01"', '"2026-01-08"', $2, 'admin')
         returning id`,
        [entitlement, w.admin]
      )
      // test_row: a traced board note named test_.
      const testNote = await insertNote(db, testName("video_note"))
      await traceNote(db, w.admin, testNote)

      await buildSet(db)
      const found = await guards(db)
      expect(found).toEqual(
        expect.arrayContaining([
          { reason: "foreign_booking", id: booking },
          { reason: "foreign_waitlist", id: waits[0].id },
          { reason: "foreign_credit_option", id: options[0].id },
          { reason: "foreign_correction", id: corrections[0].id },
          { reason: "test_row", id: testNote },
        ])
      )
    })
  })

  it("stops on a customer outside the domain and on a join begun with another email", async () => {
    await inRollback(async (db) => {
      const w = await seedWorld(db)
      // foreign_customer: a live note by the filming admin on the outsider.
      await db.query(
        "insert into public.customer_notes (customer_id, body, created_by) values ($1, 'הערה מהצילום', $2)",
        [w.outsider, w.admin]
      )
      // foreign_join_user: a world purchase's link that began a join with a
      // non-domain email.
      const joiner = await insertAuthUser(db, "video_joiner")
      const unbound = await insertPayment(db, w, null, w.admin)
      const { rows: tokens } = await db.query(
        `insert into public.activation_tokens (
           purpose, payment_id, token_hash, expires_at, state, claiming_at,
           pending_user_id)
         values ('join', $1, encode(extensions.digest($2::text, 'sha256'), 'hex'),
           now() + interval '2 days', 'claiming', now(), $3)
         returning id`,
        [unbound, randomUUID(), joiner.id]
      )
      // dev_account: a note on dev-customer pulls her in (dev project only).
      const { rows: devCustomer } = await db.query(
        "select id from auth.users where lower(email) = 'dev-customer@example.com'"
      )
      if (devCustomer.length > 0) {
        await db.query(
          "insert into public.customer_notes (customer_id, body, created_by) values ($1, 'הערה', $2)",
          [devCustomer[0].id, w.admin]
        )
      }

      await buildSet(db)
      const found = await guards(db)
      expect(found).toEqual(
        expect.arrayContaining([
          { reason: "foreign_customer", id: w.outsider },
          { reason: "foreign_join_user", id: tokens[0].id },
          ...(devCustomer.length > 0
            ? [{ reason: "dev_account", id: devCustomer[0].id }]
            : []),
        ])
      )
    })
  })
})
