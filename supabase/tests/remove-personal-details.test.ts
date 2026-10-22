// Story 4.6: removing a customer's personal details (CAP-30, AD-7, AD-19,
// AD-21). preview_admin_anonymize_customer, admin_anonymize_customer (step
// 1), admin_finish_anonymize_customer (step 3), and what they change around
// them: admin_get_customer's tombstone, the reset link, the reminder and
// expiry jobs, similar payments. One test per row of the spec's I/O matrix.
// The Auth delete (step 2) is stood in for by a delete of auth.users as the
// owner. Fictitious data only; everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  insertAuthUser,
  queryError,
  testName,
  type Db,
} from "./support/db"
import {
  approve,
  insertProduct,
  seedMoney,
  type MoneyFixture,
} from "./support/money"

const PREVIEW = "select public.preview_admin_anonymize_customer($1) as r"
const REMOVE = "select public.admin_anonymize_customer($1, $2, $3) as r"
const FINISH = "select public.admin_finish_anonymize_customer($1, $2) as r"
const GET = "select public.admin_get_customer($1) as r"
const HOME = "select public.admin_get_home() as r"
const REFUNDS = "select public.admin_list_refund_requests() as r"
const LIST = "select public.admin_list_customers($1, $2) as r"
const SEARCH = "select public.admin_search_customers($1) as r"
const EXPORT = "select public.admin_export_customers($1, $2, $3, $4) as r"
const ISSUE_RESET = "select public.admin_issue_link('reset', $1, $2) as r"
const ROLE = "select public.get_my_session_role() as r"
const LIST_PAYMENTS = "select public.admin_list_payments() as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`
const REMOVED_NAME = "לקוחה שפרטיה הוסרו"

type Fixture = MoneyFixture & {
  customer: string
  name: string
  phone: string
  concept: string
  paymentId: string
  entitlementId: string
}

function randomPhone(): string {
  const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, "0")
  return `+97258${digits}`.slice(0, 13)
}

// As the owner: an admin (seedMoney) and an activated customer with an Auth
// user, a phone, dietary notes, both photo consents, a baby, an internal
// note, a push subscription, notifications (hers and Tal's about her) and a
// card bought with a note (approve_payment logs it).
async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  const user = await insertAuthUser(db, "removal")
  const name = testName("removal_customer")
  const phone = randomPhone()
  await db.query(
    `insert into public.profiles (
       id, full_name, activated_at, phone_e164, dietary_notes,
       privacy_consent_at, privacy_policy_version,
       photo_consent, photo_consent_at, photo_consent_text_version,
       personal_photo_consent, personal_photo_consent_at,
       personal_photo_consent_text_version)
     values ($1, $2, now(), $3, $4, now(), 1, true, now(), 1, true, now(), 1)`,
    [user.id, name, phone, testName("allergy_nuts")]
  )
  await db.query(
    "insert into public.babies (customer_id, name, birth_date) values ($1, $2, current_date - 90)",
    [user.id, testName("baby")]
  )
  await db.query(
    "insert into public.customer_notes (customer_id, body, created_by) values ($1, $2, $3)",
    [user.id, testName("internal_note"), f.admin]
  )
  await db.query(
    `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, platform)
     values ($1, $2, 'BKey', 'AKey', 'android')`,
    [user.id, `https://push.example.test/${testName("sub")}`]
  )
  const { rows: notified } = await db.query(
    `insert into public.notifications (
       recipient_id, recipient_kind, type, payload, target_path, dedupe_key)
     values
       ($1, 'customer', 'card_expiring',
        '{"title": "t", "body": "b", "template_version": 1}', '/me', $2),
       ($3, 'admin', 'admin_card_expiring',
        jsonb_build_object('title', 't', 'body', $5::text, 'template_version', 1),
        '/admin/customers/' || $1::text, $4)
     returning id`,
    [user.id, testName("n_customer"), f.admin, testName("n_admin"), name]
  )
  for (const row of notified) {
    await db.query(
      "insert into public.notification_jobs (notification_id, status) values ($1, 'queued')",
      [row.id]
    )
  }
  const { rows: concepts } = await db.query(
    "select id from public.concepts where archived_at is null order by sort_order, id limit 1"
  )
  const paid = await asAdmin(db, f.admin, () =>
    approve(db, {
      customerId: user.id,
      productId: f.card,
      amount: 47200,
      paidOn: f.today,
      methodId: f.method,
      reference: testName("ref"),
      note: testName("payment_note"),
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
  const paymentId = String(paid.payment_id)
  const { rows: ents } = await db.query(
    "select id from public.entitlements where payment_id = $1",
    [paymentId]
  )
  return {
    ...f,
    customer: user.id,
    name,
    phone,
    concept: concepts[0].id,
    paymentId,
    entitlementId: ents[0].id,
  }
}

async function asAdmin<T>(db: Db, admin: string, run: () => Promise<T>) {
  await asAuthenticated(db, admin)
  try {
    return await run()
  } finally {
    await db.query("reset role")
  }
}

async function call(db: Db, f: Fixture, query: string, params: unknown[]) {
  return asAdmin(
    db,
    f.admin,
    async () => (await db.query(query, params)).rows[0].r
  )
}

async function callError(db: Db, f: Fixture, query: string, params: unknown[]) {
  return asAdmin(db, f.admin, () => queryError(db, query, params))
}

// As the owner: a session from `startHours` from now, two hours long.
async function insertEvent(db: Db, f: Fixture, startHours: number) {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     values ($1, 'regular', now() + make_interval(hours => $2::int),
       now() + make_interval(hours => $2::int + 2), 12,
       now() + make_interval(hours => $2::int), 'published')
     returning id`,
    [f.concept, startHours]
  )
  return rows[0].id as string
}

// As the owner: her booking in a session, with its status.
async function insertBooking(
  db: Db,
  f: Fixture,
  eventId: string,
  status: "confirmed" | "cancelled" = "confirmed",
  confirmedHoursAgo = 0
) {
  const { rows } = await db.query(
    `insert into public.bookings (
       customer_id, event_id, party_size, status, booked_by, confirmed_at,
       cancelled_at, policy_snapshot, guest_details)
     values ($1, $2, 1, $3, 'admin', now() - make_interval(hours => $4::int),
       case when $3 = 'cancelled' then now() end, ${SNAPSHOT}, $5)
     returning id`,
    [f.customer, eventId, status, confirmedHoursAgo, testName("guest")]
  )
  return rows[0].id as string
}

async function remove(db: Db, f: Fixture, key = randomUUID()) {
  return call(db, f, REMOVE, [f.customer, true, key])
}

// Step 2's stand-in: the Auth user is gone.
async function deleteAuthUser(db: Db, f: Fixture) {
  await db.query("delete from auth.users where id = $1", [f.customer])
}

async function profile(db: Db, id: string) {
  const { rows } = await db.query(
    "select * from public.profiles where id = $1",
    [id]
  )
  return rows[0]
}

async function countOf(db: Db, text: string, params: unknown[]) {
  const { rows } = await db.query(
    `select count(*)::int as n from ${text}`,
    params
  )
  return rows[0].n as number
}

describe("preview and removal", { timeout: 60_000 }, () => {
  it("clean: no blockers; removal cleans every listed table, keeps money, finishes after Auth; tombstone; absent from list, search and export", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const pastEvent = await insertEvent(db, f, -72)
      const pastBooking = await insertBooking(db, f, pastEvent, "cancelled")
      const futureEvent = await insertEvent(db, f, 24 * 7)
      await db.query(
        "insert into public.waitlist_entries (customer_id, event_id, party_size) values ($1, $2, 1)",
        [f.customer, futureEvent]
      )
      // A stored result of hers and one of Tal's that names her.
      await db.query(
        `insert into private.idempotency_results (actor_scope, rpc, key, request_hash, result)
         values ($1, 'test_rpc', $2, repeat('a', 64), '{}'), ($3, 'test_rpc', $4, repeat('a', 64), jsonb_build_object('customer_id', $1::text))`,
        [f.customer, randomUUID(), f.admin, randomUUID()]
      )

      const homeBefore = (await call(db, f, HOME, [])).totals
      const refundsBefore = await call(db, f, REFUNDS, [])

      expect(await call(db, f, PREVIEW, [f.customer])).toEqual({
        blockers: {
          bookings: [],
          refund_requests: [],
          pending_choices: [],
          parked_purchases: [],
        },
        forfeits: { entries_left: 4, active_credits: 0 },
      })

      // Story 5.20: the payment's note is in its audit rows before the
      // removal (masked to <removed> after it, below).
      const notesBefore = await db.query<{ note: unknown }>(
        `select coalesce(a.after -> 'note', a.before -> 'note') as note
         from public.audit_log a
         where a.entity_type = 'payments' and a.entity_id = $1
           and (a.after ? 'note' or a.before ? 'note')`,
        [f.paymentId]
      )
      expect(notesBefore.rows.length).toBeGreaterThan(0)
      expect(notesBefore.rows.map((r) => r.note)).toContain(
        testName("payment_note")
      )

      expect(await remove(db, f)).toEqual({
        result: "pending",
        user_id: f.customer,
        orphan_user_ids: [],
      })

      const notesAfter = await db.query<{ note: unknown }>(
        `select coalesce(a.after -> 'note', a.before -> 'note') as note
         from public.audit_log a
         where a.entity_type = 'payments' and a.entity_id = $1
           and (a.after ? 'note' or a.before ? 'note')`,
        [f.paymentId]
      )
      expect(notesAfter.rows.length).toBe(notesBefore.rows.length)
      expect(notesAfter.rows.every((r) => r.note === "<removed>")).toBe(true)

      const p = await profile(db, f.customer)
      expect(p).toMatchObject({
        full_name: REMOVED_NAME,
        phone_e164: null,
        pending_email: null,
        dietary_notes: null,
        photo_consent: false,
        photo_consent_at: null,
        photo_consent_text_version: null,
        personal_photo_consent: false,
        personal_photo_consent_at: null,
        personal_photo_consent_text_version: null,
        account_op_state: "anonymization_pending",
        account_op_target_hash: null,
      })
      expect(p.anonymized_at).not.toBeNull()
      expect(p.privacy_consent_at).not.toBeNull()
      expect(p.privacy_policy_version).toBe(1)

      const id = [f.customer]
      expect(
        await countOf(db, "public.babies where customer_id = $1", id)
      ).toBe(0)
      expect(
        await countOf(db, "public.customer_notes where customer_id = $1", id)
      ).toBe(0)
      expect(
        await countOf(db, "public.waitlist_entries where customer_id = $1", id)
      ).toBe(0)
      expect(
        await countOf(db, "public.push_subscriptions where user_id = $1", id)
      ).toBe(0)
      expect(
        await countOf(
          db,
          "public.notifications where recipient_id = $1 or target_path = '/admin/customers/' || $1::text",
          id
        )
      ).toBe(0)
      expect(
        await countOf(
          db,
          "private.idempotency_results where actor_scope = $1 or (rpc = 'test_rpc' and result::text like '%' || $1::text || '%')",
          id
        )
      ).toBe(0)

      // Money and bookings stay, nameless.
      const { rows: pays } = await db.query(
        "select amount_agorot, status, payer_label, note, reference from public.payments where id = $1",
        [f.paymentId]
      )
      expect(pays[0]).toEqual({
        amount_agorot: 47200,
        status: "approved",
        payer_label: null,
        note: null,
        reference: testName("ref"),
      })
      const { rows: books } = await db.query(
        "select status, guest_details from public.bookings where id = $1",
        [pastBooking]
      )
      expect(books[0]).toEqual({ status: "cancelled", guest_details: null })
      expect(
        await countOf(
          db,
          "public.entitlements where id = $1 and status = 'active'",
          [f.entitlementId]
        )
      ).toBe(1)

      // No identifying value anywhere in her audit rows.
      const { rows: audit } = await db.query(
        "select row_to_json(a)::text as raw, action, before, after from public.audit_log a where customer_id = $1",
        id
      )
      for (const row of audit) {
        expect(row.raw).not.toContain(f.name)
        expect(row.raw).not.toContain(f.phone)
        expect(row.raw).not.toContain(testName("payment_note"))
      }
      expect(
        audit.filter((r) => r.action === "admin_anonymize_customer")
      ).toEqual([
        expect.objectContaining({
          before: { anonymized_at: null },
          after: { anonymized_at: expect.any(String) },
        }),
      ])

      // The home sum and the refunds report do not change.
      expect((await call(db, f, HOME, [])).totals).toEqual(homeBefore)
      expect(await call(db, f, REFUNDS, [])).toEqual(refundsBefore)

      // The card is a tombstone, pending until the Auth step.
      expect(await call(db, f, GET, [f.customer])).toEqual({
        profile: {
          id: f.customer,
          anonymized_at: expect.any(String),
          removal_pending: true,
        },
      })

      // Step 3 refuses while the Auth user exists, then closes.
      expect(
        await callError(db, f, FINISH, [f.customer, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "CONCURRENT_CHANGE" })
      await deleteAuthUser(db, f)
      expect(await call(db, f, FINISH, [f.customer, randomUUID()])).toEqual({
        result: "done",
      })
      expect(await profile(db, f.customer)).toMatchObject({
        account_op_state: null,
        account_op_started_at: null,
      })
      expect(
        (await call(db, f, GET, [f.customer])).profile.removal_pending
      ).toBe(false)

      // Absent from the list, the search and the export.
      for (const query of [f.name, f.phone.slice(-7), REMOVED_NAME]) {
        const list = await call(db, f, LIST, [query, "all"])
        expect(JSON.stringify(list)).not.toContain(f.customer)
        const search = await call(db, f, SEARCH, [query])
        expect(JSON.stringify(search)).not.toContain(f.customer)
      }
      const exported = await call(db, f, EXPORT, [
        "all",
        null,
        ["full_name", "phone", "email"],
        "all",
      ])
      expect(JSON.stringify(exported)).not.toContain(f.name)
      expect(JSON.stringify(exported)).not.toContain(f.phone)
    })
  })

  it("blocked: a future booking, a refund requested and a credit choice pending are listed; the RPC refuses with ANONYMIZE_BLOCKED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const futureEvent = await insertEvent(db, f, 24 * 5)
      const booking = await insertBooking(db, f, futureEvent)
      const pastEvent = await insertEvent(db, f, -48)
      const cancelled = await insertBooking(db, f, pastEvent, "cancelled")
      const otherEvent = await insertEvent(db, f, -96)
      const cancelledToo = await insertBooking(db, f, otherEvent, "cancelled")
      const { rows: credits } = await db.query(
        `insert into public.cancellation_credits (
           customer_id, origin_booking_id, source_entitlement_id, event_kind,
           party_size, options_count, origin_starts_at, original_cancelled_at,
           monetary_basis_agorot, status, choice_pending)
         values ($1, $2, $3, 'regular', 1, 3, now() - interval '48 hours', now(),
           11800, 'active', true),
           ($1, $4, $3, 'regular', 1, 3, now() - interval '48 hours', now(),
           11800, 'refund_requested', false)
         returning id, choice_pending`,
        [f.customer, cancelled, f.entitlementId, cancelledToo]
      )
      const pendingCredit = credits.find((c) => c.choice_pending).id
      const requestedCredit = credits.find((c) => !c.choice_pending).id
      const { rows: refunds } = await db.query(
        `insert into public.refund_requests (
           customer_id, credit_id, payment_id, booking_id, amount_agorot, status)
         values ($1, $2, $3, $4, 11800, 'requested')
         returning id`,
        [f.customer, requestedCredit, f.paymentId, cancelledToo]
      )

      const plan = await call(db, f, PREVIEW, [f.customer])
      expect(plan.blockers).toEqual({
        bookings: [
          {
            booking_id: booking,
            event_id: futureEvent,
            starts_at: expect.any(String),
            concept: expect.any(String),
          },
        ],
        refund_requests: [{ id: refunds[0].id, amount_agorot: 11800 }],
        pending_choices: [{ credit_id: pendingCredit }],
        parked_purchases: [],
      })

      expect(
        await callError(db, f, REMOVE, [f.customer, true, randomUUID()])
      ).toMatchObject({
        code: "P0001",
        message: "ANONYMIZE_BLOCKED",
      })
      expect((await profile(db, f.customer)).anonymized_at).toBeNull()

      // Tal handles them; the removal proceeds.
      await db.query(
        "update public.bookings set status = 'cancelled', cancelled_at = now() where id = $1",
        [booking]
      )
      await db.query("delete from public.refund_requests where id = $1", [
        refunds[0].id,
      ])
      await db.query(
        "update public.cancellation_credits set choice_pending = false where id = $1",
        [pendingCredit]
      )
      expect((await remove(db, f)).result).toBe("pending")
    })
  })

  it("forfeits: free entries and an active credit are shown and do not block; they stay as they are", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const pastEvent = await insertEvent(db, f, -48)
      const cancelled = await insertBooking(db, f, pastEvent, "cancelled")
      const { rows: credits } = await db.query(
        `insert into public.cancellation_credits (
           customer_id, origin_booking_id, source_entitlement_id, event_kind,
           party_size, options_count, origin_starts_at, original_cancelled_at,
           monetary_basis_agorot, status, choice_pending)
         values ($1, $2, $3, 'regular', 1, 3, now() - interval '48 hours', now(),
           11800, 'active', false)
         returning id`,
        [f.customer, cancelled, f.entitlementId]
      )

      const plan = await call(db, f, PREVIEW, [f.customer])
      expect(plan.forfeits).toEqual({ entries_left: 4, active_credits: 1 })

      expect((await remove(db, f)).result).toBe("pending")
      const { rows } = await db.query(
        "select status from public.cancellation_credits where id = $1",
        [credits[0].id]
      )
      expect(rows[0].status).toBe("active")
    })
  })

  it("retry: step 1 on a pending profile answers pending without cleaning again; twice closed answers done; finish on a closed one answers not_pending", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect((await remove(db, f)).result).toBe("pending")

      // Something written after step 1 is left alone by the retry.
      await db.query(
        "insert into public.customer_notes (customer_id, body, created_by) values ($1, $2, $3)",
        [f.customer, testName("after_note"), f.admin]
      )
      expect(await remove(db, f)).toEqual({
        result: "pending",
        user_id: f.customer,
      })
      expect(
        await countOf(db, "public.customer_notes where customer_id = $1", [
          f.customer,
        ])
      ).toBe(1)
      const { rows } = await db.query(
        "select count(*)::int as n from public.audit_log where customer_id = $1 and action = 'admin_anonymize_customer'",
        [f.customer]
      )
      expect(rows[0].n).toBe(1)

      // The same key returns the stored result.
      const key = randomUUID()
      expect((await remove(db, f, key)).result).toBe("pending")
      expect((await remove(db, f, key)).result).toBe("pending")

      await deleteAuthUser(db, f)
      expect(await call(db, f, FINISH, [f.customer, randomUUID()])).toEqual({
        result: "done",
      })
      expect(await call(db, f, FINISH, [f.customer, randomUUID()])).toEqual({
        result: "not_pending",
      })
      expect(await remove(db, f)).toEqual({
        result: "done",
        user_id: f.customer,
      })
    })
  })

  it("her links: a pending reset link is revoked, a join waiting for her sign-in becomes a conflict, each logged; no input hash stays; the purchase behind the join is cleaned", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const reset = await call(db, f, ISSUE_RESET, [f.customer, randomUUID()])
      const other = await asAdmin(db, f.admin, () =>
        approve(db, {
          customerId: null,
          payerLabel: testName("payer_x"),
          productId: f.card,
          amount: 47200,
          paidOn: f.today,
          methodId: f.method,
          note: testName("unbound_note"),
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      await db.query(
        `update public.activation_tokens
         set state = 'awaiting_login', bound_user_id = $2, input_hash = $3
         where payment_id = $1`,
        [other.payment_id, f.customer, "b".repeat(64)]
      )

      await remove(db, f)

      const { rows } = await db.query(
        `select id, purpose, state, conflict_reason, input_hash, revoked_at
         from public.activation_tokens
         where bound_user_id = $1 or customer_id = $1`,
        [f.customer]
      )
      expect(rows.find((r) => r.id === reset.token_id)).toMatchObject({
        state: "revoked",
        input_hash: null,
      })
      expect(rows.find((r) => r.purpose === "join")).toMatchObject({
        state: "conflict",
        conflict_reason: "bind_conflict",
        input_hash: null,
        revoked_at: null,
      })

      // Each changed link is logged as a revoke, under her.
      const { rows: revokes } = await db.query(
        "select entity_id from public.audit_log where action = 'revoke_link' and customer_id = $1",
        [f.customer]
      )
      expect(revokes.map((r) => r.entity_id).sort()).toEqual(
        [reset.token_id, rows.find((r) => r.purpose === "join").id].sort()
      )

      // The unbound purchase behind her join: no name or note, also in its
      // audit rows (written while customer_id was null).
      const { rows: unbound } = await db.query(
        "select payer_label, note, amount_agorot from public.payments where id = $1",
        [other.payment_id]
      )
      expect(unbound[0]).toEqual({
        payer_label: null,
        note: null,
        amount_agorot: 47200,
      })
      const { rows: payAudit } = await db.query(
        "select row_to_json(a)::text as raw from public.audit_log a where entity_type = 'payments' and entity_id = $1",
        [other.payment_id]
      )
      expect(payAudit.length).toBeGreaterThan(0)
      for (const row of payAudit) {
        expect(row.raw).not.toContain(testName("unbound_note"))
      }
    })
  })

  it("an already removed profile: the preview refuses, the removal answers pending (then done); a missing id: CUSTOMER_NOT_AVAILABLE on both", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await remove(db, f)
      expect(await callError(db, f, PREVIEW, [f.customer])).toMatchObject({
        code: "P0001",
        message: "CUSTOMER_NOT_AVAILABLE",
      })
      expect((await remove(db, f)).result).toBe("pending")
      await deleteAuthUser(db, f)
      await call(db, f, FINISH, [f.customer, randomUUID()])
      expect((await remove(db, f)).result).toBe("done")

      const missing = randomUUID()
      expect(await callError(db, f, PREVIEW, [missing])).toMatchObject({
        message: "CUSTOMER_NOT_AVAILABLE",
      })
      expect(
        await callError(db, f, REMOVE, [missing, true, randomUUID()])
      ).toMatchObject({ message: "CUSTOMER_NOT_AVAILABLE" })
    })
  })
})

describe("around the removal", { timeout: 60_000 }, () => {
  it("the reset link is refused while pending and after; she is no longer a customer", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await remove(db, f)
      expect(
        await callError(db, f, ISSUE_RESET, [f.customer, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "RESET_TARGET_INVALID" })

      await asAuthenticated(db, f.customer)
      const role = (await db.query(ROLE)).rows[0].r
      await db.query("reset role")
      expect(role).not.toBe("customer")

      await deleteAuthUser(db, f)
      await call(db, f, FINISH, [f.customer, randomUUID()])
      expect(
        await callError(db, f, ISSUE_RESET, [f.customer, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "RESET_TARGET_INVALID" })
    })
  })

  it("job_reminders and job_expiry_alerts skip her", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await remove(db, f)
      // As the owner after the removal: a booking due for its reminder, and
      // her card about to expire with free entries.
      const event = await insertEvent(db, f, 23)
      await insertBooking(db, f, event, "confirmed", 72)
      await db.query(
        "update public.entitlements set expires_on = (now() at time zone 'Asia/Jerusalem')::date + 1 where id = $1",
        [f.entitlementId]
      )
      await db.query("select private.job_reminders()")
      await db.query("select private.job_expiry_alerts()")

      expect(
        await countOf(
          db,
          "public.notifications where recipient_id = $1 or target_path = '/admin/customers/' || $1::text",
          [f.customer]
        )
      ).toBe(0)
    })
  })

  it("enqueue_notification queues nothing for her (jobs such as auto-extend still reach her active cards)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await remove(db, f)
      const { rows } = await db.query(
        `select private.enqueue_notification($1, 'card_expiring', $2,
           '{"units": 1, "expires_on": "01.11"}'::jsonb, '/me') as r`,
        [f.customer, testName("after_removal")]
      )
      expect(rows[0].r).toBeNull()
      expect(
        await countOf(db, "public.notifications where recipient_id = $1", [
          f.customer,
        ])
      ).toBe(0)
    })
  })

  it("admin_list_payments shows her purchase under the removed wording, without a payer label", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await remove(db, f)
      const list = (await call(db, f, LIST_PAYMENTS, [])) as Record<
        string,
        unknown
      >[]
      expect(list.find((row) => row.payment_id === f.paymentId)).toMatchObject({
        customer_id: f.customer,
        customer_name: REMOVED_NAME,
        payer_label: null,
        note: null,
      })
      expect(JSON.stringify(list)).not.toContain(f.name)
    })
  })

  it("similar payments name her with the removed wording, not as a new customer", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await remove(db, f)
      const { rows } = await db.query(
        "select private.similar_payments_for($1, null, $2, 47200, $3, $4::date, null) as r",
        [f.customer, f.card, f.method, f.today]
      )
      expect(rows[0].r).toEqual([
        expect.objectContaining({ customer_name: REMOVED_NAME }),
      ])
    })
  })
})

describe("permissions and input", () => {
  it("not confirmed: CONFIRM_REQUIRED, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      for (const confirmed of [false, null]) {
        expect(
          await callError(db, f, REMOVE, [f.customer, confirmed, randomUUID()])
        ).toMatchObject({ code: "P0001", message: "CONFIRM_REQUIRED" })
      }
      expect((await profile(db, f.customer)).full_name).toBe(f.name)
    })
  })

  it("an admin target: CUSTOMER_NOT_AVAILABLE on the preview and the removal", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query("insert into public.admin_roles (user_id) values ($1)", [
        f.customer,
      ])
      expect(await callError(db, f, PREVIEW, [f.customer])).toMatchObject({
        message: "CUSTOMER_NOT_AVAILABLE",
      })
      expect(
        await callError(db, f, REMOVE, [f.customer, true, randomUUID()])
      ).toMatchObject({ message: "CUSTOMER_NOT_AVAILABLE" })
    })
  })

  it("a customer calling: NOT_AUTHORIZED on all three", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.customer)
      for (const [query, params] of [
        [PREVIEW, [f.customer]],
        [REMOVE, [f.customer, true, randomUUID()]],
        [FINISH, [f.customer, randomUUID()]],
      ] as const) {
        expect(await queryError(db, query, [...params])).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
      await db.query("reset role")
    })
  })
})

// Story 5.20 (user decisions 2026-10-22): a paid pinned purchase without a
// place and a place held behind her join link block the removal; an email
// change between its steps refuses it; the Auth users of her claiming join
// links come back for deletion.
describe("story 5.20 blockers and links", { timeout: 60_000 }, () => {
  // As the owner: a payment of a pinned single for `eventId`, with its
  // active entitlement and no booking (3.11 'park'); customer null for an
  // unbound purchase.
  async function parkedPurchase(
    db: Db,
    f: Fixture,
    eventId: string,
    customerId: string | null
  ) {
    const product = await insertProduct(db, {
      label: "parked_single",
      type: "single",
      price: 12800,
      units: 1,
      validityMode: "session",
    })
    const { rows: payments } = await db.query(
      `insert into public.payments (
         customer_id, product_id, source, recorded_by, payment_method_id,
         amount_agorot, paid_on, product_snapshot)
       values ($1, $2, 'manual', $3, $4, 12800,
         (now() at time zone 'Asia/Jerusalem')::date, '{}'::jsonb)
       returning id`,
      [customerId, product, f.admin, f.method]
    )
    const { rows: ents } = await db.query(
      `insert into public.entitlements (
         customer_id, payment_id, kind, original_units, valid_from, expires_on,
         eligibility_snapshot, allowed_weekdays, eligible_event_kind,
         pinned_event_id)
       values ($1, $2, 'single', 1,
         (now() at time zone 'Asia/Jerusalem')::date,
         (now() at time zone 'Asia/Jerusalem')::date + 49,
         jsonb_build_object('validity_mode', 'session', 'product_id', $3::uuid),
         null, 'regular', $4)
       returning id`,
      [customerId, payments[0].id, product, eventId]
    )
    return {
      paymentId: payments[0].id as string,
      entitlementId: ents[0].id as string,
    }
  }

  // As the owner: an unbound card payment (no entitlement needed here).
  async function unboundPayment(db: Db, f: Fixture): Promise<string> {
    const { rows } = await db.query(
      `insert into public.payments (
         customer_id, product_id, source, recorded_by, payment_method_id,
         amount_agorot, paid_on, product_snapshot)
       values (null, $1, 'manual', $2, $3, 47200,
         (now() at time zone 'Asia/Jerusalem')::date, '{}'::jsonb)
       returning id`,
      [f.card, f.admin, f.method]
    )
    return rows[0].id
  }

  // As the owner: a join link for `paymentId` in `state`.
  async function joinToken(
    db: Db,
    paymentId: string,
    values: {
      state: "pending" | "awaiting_login" | "claiming"
      customerId?: string | null
      boundUserId?: string | null
      pendingUserId?: string | null
    }
  ): Promise<string> {
    const { rows } = await db.query(
      `insert into public.activation_tokens (
         purpose, token_hash, state, expires_at, payment_id, customer_id,
         bound_user_id, pending_user_id, claiming_at)
       values ('join', md5(random()::text) || md5(random()::text), $1,
         now() + interval '48 hours', $2, $3, $4, $5,
         case when $1 = 'claiming' then now() end)
       returning id`,
      [
        values.state,
        paymentId,
        values.customerId ?? null,
        values.boundUserId ?? null,
        values.pendingUserId ?? null,
      ]
    )
    return rows[0].id
  }

  // The removal's error with its detail (ANONYMIZE_BLOCKED counts).
  async function removeFailure(db: Db, f: Fixture) {
    return asAdmin(db, f.admin, async () => {
      await db.query("savepoint removal")
      try {
        await db.query(REMOVE, [f.customer, true, randomUUID()])
        await db.query("release savepoint removal")
        return null
      } catch (error) {
        await db.query("rollback to savepoint removal")
        const { message, detail } = error as {
          message: string
          detail?: string
        }
        return { message, detail: detail ? JSON.parse(detail) : null }
      }
    })
  }

  it("parked: her paid pinned purchase without a place blocks, listed; nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, 24 * 5)
      const parked = await parkedPurchase(db, f, event, f.customer)

      const plan = await call(db, f, PREVIEW, [f.customer])
      expect(plan.blockers.parked_purchases).toEqual([
        {
          entitlement_id: parked.entitlementId,
          payment_id: parked.paymentId,
          event_id: event,
          starts_at: expect.any(String),
          concept: expect.any(String),
        },
      ])
      expect(await removeFailure(db, f)).toEqual({
        message: "ANONYMIZE_BLOCKED",
        detail: {
          bookings: 0,
          refund_requests: 0,
          pending_choices: 0,
          parked_purchases: 1,
        },
      })
      expect((await profile(db, f.customer)).anonymized_at).toBeNull()

      // Settled (here: no longer active): the removal proceeds.
      await db.query(
        "update public.entitlements set status = 'revoked' where id = $1",
        [parked.entitlementId]
      )
      expect((await remove(db, f)).result).toBe("pending")
    })
  })

  it("parked behind her join link (unbound) blocks too", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, 24 * 5)
      const parked = await parkedPurchase(db, f, event, null)
      await joinToken(db, parked.paymentId, {
        state: "awaiting_login",
        boundUserId: f.customer,
      })

      const plan = await call(db, f, PREVIEW, [f.customer])
      expect(
        plan.blockers.parked_purchases.map(
          (p: { entitlement_id: string }) => p.entitlement_id
        )
      ).toEqual([parked.entitlementId])
      expect((await removeFailure(db, f))?.detail).toMatchObject({
        parked_purchases: 1,
      })
      expect((await profile(db, f.customer)).anonymized_at).toBeNull()
    })
  })

  it("awaiting_login seat: a place held for her purchase behind her waiting join link blocks, under bookings", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, 24 * 5)
      const payment = await unboundPayment(db, f)
      const { rows } = await db.query(
        `insert into public.bookings (
           customer_id, payment_id, event_id, party_size, status, booked_by,
           confirmed_at, policy_snapshot)
         values (null, $1, $2, 1, 'confirmed', 'admin', now(), ${SNAPSHOT})
         returning id`,
        [payment, event]
      )
      await joinToken(db, payment, {
        state: "awaiting_login",
        boundUserId: f.customer,
      })

      const plan = await call(db, f, PREVIEW, [f.customer])
      expect(plan.blockers.bookings).toEqual([
        {
          booking_id: rows[0].id,
          event_id: event,
          starts_at: expect.any(String),
          concept: expect.any(String),
        },
      ])
      expect((await removeFailure(db, f))?.detail).toMatchObject({
        bookings: 1,
      })
      expect((await profile(db, f.customer)).anonymized_at).toBeNull()
    })
  })

  it("a pending join link (not waiting for her sign-in) with a held place does not block", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, 24 * 5)
      const payment = await unboundPayment(db, f)
      await db.query(
        `insert into public.bookings (
           customer_id, payment_id, event_id, party_size, status, booked_by,
           confirmed_at, policy_snapshot)
         values (null, $1, $2, 1, 'confirmed', 'admin', now(), ${SNAPSHOT})`,
        [payment, event]
      )
      await joinToken(db, payment, { state: "pending", customerId: f.customer })
      const plan = await call(db, f, PREVIEW, [f.customer])
      expect(plan.blockers.bookings).toEqual([])
    })
  })

  it("an email change between its steps: CONCURRENT_CHANGE on the preview and the removal, nothing changes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const begun = await call(
        db,
        f,
        "select public.admin_begin_email_change($1, $2, $3) as r",
        [
          f.customer,
          `${testName("new_mail")}@example.test`.toLowerCase(),
          randomUUID(),
        ]
      )
      expect(begun.result).toBe("pending")
      expect(await callError(db, f, PREVIEW, [f.customer])).toMatchObject({
        code: "P0001",
        message: "CONCURRENT_CHANGE",
      })
      expect(
        await callError(db, f, REMOVE, [f.customer, true, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "CONCURRENT_CHANGE" })
      const row = await profile(db, f.customer)
      expect(row.anonymized_at).toBeNull()
      expect(row.full_name).toBe(f.name)
      expect(row.account_op_state).toBe("email_change_pending")
    })
  })

  it("her claiming join link: revoked, and its pending Auth user comes back in orphan_user_ids", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const payment = await unboundPayment(db, f)
      const pending = randomUUID()
      const token = await joinToken(db, payment, {
        state: "claiming",
        customerId: f.customer,
        pendingUserId: pending,
      })

      expect(await remove(db, f)).toMatchObject({
        result: "pending",
        user_id: f.customer,
        orphan_user_ids: [pending],
      })
      const { rows } = await db.query(
        "select state, revoked_at is not null as revoked from public.activation_tokens where id = $1",
        [token]
      )
      expect(rows[0]).toEqual({ state: "revoked", revoked: true })
    })
  })
})
