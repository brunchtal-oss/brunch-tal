// Story 6.7: the acceptance suite, "notifications and jobs" (NT1, NT2, NT4,
// NT5, and the default of CN3's N). Each test proves a claim the
// story-by-story tests left missing or weak (T3-T9 of the spec's coverage
// map). The jobs are called directly, as the owner (pg_cron's role), inside
// inRollback; every other published session is moved to draft in the seed,
// so the jobs see only this test's sessions. now() is the transaction's
// start, so it is the same for the booking, the move and the job. Fixed 2099
// dates for the marketing slot. After each job test, nothing of it is left
// in notifications, notification_jobs or net.http_request_queue.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  insertAuthUser,
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

const REMINDERS = "select private.job_reminders() as n"
const ALERTS = "select private.job_expiry_alerts() as n"
const COMPLETE = "select private.job_complete_events() as n"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2, $3) as r"
const RESCHEDULE =
  "select public.admin_reschedule_event($1, now() + $2::interval, now() + $2::interval + interval '2 hours', true, $3, $4) as r"
const CORRECT =
  "select public.admin_correct_entitlement($1, $2, $3::jsonb, $4, $5, $6, $7) as r"
const CLAIM = "select public.claim_push_jobs($1) as r"
const FINISH =
  "select public.finish_push_job($1, $2::uuid[], $3::uuid[], $4) as r"

const KEYS = {
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ",
  auth: "tBHItJI5svbpez7KI4CCXg",
}

type Fixture = MoneyFixture & { single: string; mothers: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         credit_options_count = 2, admin_expiring_days = 21,
         customer_expiring_days = 10`
  )
  // Only this test's sessions are published (reminded, completed, options).
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
    "select id from public.concepts where theme_key = 'mothers' and archived_at is null"
  )
  return { ...f, single: rows[0].id, mothers: concepts[0].id }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// As the owner: a published regular session `dayOffset` local days from
// today at 10:00 Jerusalem time, open for booking until it starts.
async function insertEvent(db: Db, f: Fixture, dayOffset = 5): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true,
       'published'
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + $2::int)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [f.mothers, dayOffset]
  )
  return rows[0].id
}

// As the admin: approves a product for the customer (a pinned single with
// its session). Returns the payment and the entitlement.
async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  customerId: string,
  eventId: string | null = null
): Promise<{ payment: string; entitlement: string }> {
  const r = await as(db, f.admin, () =>
    approve(db, {
      customerId,
      productId,
      eventId,
      amount: productId === f.single ? 12800 : 47200,
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
  return { payment: r.payment_id as string, entitlement: rows[0].id }
}

async function book(db: Db, customer: string, eventId: string) {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    return rows[0].r.booking_id as string
  })
}

// As the owner: the session starts `startsIn` from now (bumps its revision).
async function moveStart(db: Db, eventId: string, startsIn: string) {
  await db.query(
    `update public.events
     set registration_closes_at = now() + $2::interval - interval '1 hour',
         starts_at = now() + $2::interval,
         ends_at = now() + $2::interval + interval '2 hours'
     where id = $1`,
    [eventId, startsIn]
  )
}

// A card of `customer` and her booking, confirmed 3 days ago, of a session
// that starts in 23 hours (due for the reminder).
async function dueBooking(db: Db, f: Fixture, customer: string) {
  const { entitlement } = await grant(db, f, f.card, customer)
  const eventId = await insertEvent(db, f)
  const bookingId = await book(db, customer, eventId)
  await db.query(
    "update public.bookings set confirmed_at = now() - interval '3 days' where id = $1",
    [bookingId]
  )
  await moveStart(db, eventId, "23 hours")
  return { eventId, bookingId, entitlement }
}

async function run(db: Db, text: string): Promise<number> {
  return (await db.query(text)).rows[0].n
}

async function revision(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query(
    "select revision from public.events where id = $1",
    [eventId]
  )
  return rows[0].revision
}

// The reminders of a booking (any revision), oldest revision first.
async function reminders(db: Db, bookingId: string) {
  const { rows } = await db.query(
    `select n.id, n.dedupe_key,
       (select count(*)::int from public.notification_jobs j
        where j.notification_id = n.id) as jobs
     from public.notifications n
     where n.type = 'reminder' and n.dedupe_key like '%:' || $1 || ':%'
     order by split_part(n.dedupe_key, ':', 4)::int`,
    [bookingId]
  )
  return rows as { id: string; dedupe_key: string; jobs: number }[]
}

// The card ends `days` days from the local today.
async function setDaysLeft(db: Db, id: string, days: number): Promise<void> {
  await db.query(
    `update public.entitlements
     set valid_from = (now() at time zone 'Asia/Jerusalem')::date - 30,
         expires_on = (now() at time zone 'Asia/Jerusalem')::date + $2::int
     where id = $1`,
    [id, days]
  )
}

async function expiresOn(db: Db, id: string): Promise<string> {
  const { rows } = await db.query(
    "select expires_on::text as d from public.entitlements where id = $1",
    [id]
  )
  return rows[0].d
}

// The dedupe keys of a type for this entitlement and one recipient.
async function alertKeys(
  db: Db,
  type: string,
  recipient: string,
  entitlement: string
): Promise<string[]> {
  const { rows } = await db.query(
    `select dedupe_key from public.notifications
     where type = $1 and recipient_id = $2
       and dedupe_key like $1 || ':%:' || $3 || ':%'
     order by dedupe_key`,
    [type, recipient, entitlement]
  )
  return rows.map((r) => r.dedupe_key)
}

async function anyAlerts(db: Db, entitlement: string): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from public.notifications
     where type in ('card_expiring', 'admin_card_expiring')
       and dedupe_key like '%:' || $1 || ':%'`,
    [entitlement]
  )
  return rows[0].n
}

// pg_net's queue (net.http_request_queue, ids from a sequence). The mark is
// its highest id at the start of the test's transaction (a sequence is not
// rolled back, so every later row has a higher id).
async function queueMark(db: Db): Promise<string> {
  const { rows } = await db.query(
    "select coalesce(max(id), 0)::text as mark from net.http_request_queue"
  )
  return rows[0].mark
}

// Rows above the mark written by this transaction or one of its
// subtransactions (plpgsql exception blocks, savepoints): their xmin is still
// in progress. A row another session committed meanwhile (the minute's cron)
// is "committed", and one it has not committed is not visible.
async function ownQueuedRequests(db: Db, mark: string): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from net.http_request_queue q
     where q.id > $1::bigint
       and txid_status(((txid_current() >> 32) << 32) + q.xmin::text::bigint)
           = 'in progress'`,
    [mark]
  )
  return rows[0].n
}

// After a rolled-back job test: no notification or job of these recipients,
// no notification whose dedupe key names one of the subjects, and no
// committed pg_net request above the test's mark that names one of them or
// wakes the push worker (its body is always '{}', so it is found by url).
async function expectNothingKept(
  recipients: string[],
  subjects: string[],
  mark: string
) {
  const [kept] = await sql<Record<string, number>>(
    `select
       (select count(*)::int from public.notifications
          where recipient_id = any($1::uuid[])
             or exists (select 1 from unnest($2::text[]) s
                        where dedupe_key like '%' || s || '%')) as notifications,
       (select count(*)::int from public.notification_jobs j
          join public.notifications n on n.id = j.notification_id
          where n.recipient_id = any($1::uuid[])) as jobs`,
    [recipients, subjects]
  )
  expect(kept).toEqual({ notifications: 0, jobs: 0 })
  const [pending] = await sql<{ n: number }>(
    `select count(*)::int as n from net.http_request_queue q
     where q.id > $2::bigint
       and (q.url like '%/api/jobs/push%'
            or exists (select 1 from unnest($1::text[]) s
                       where q.body::text like '%' || s || '%'))`,
    [[...recipients, ...subjects], mark]
  )
  expect(pending.n).toBe(0)
}

describe(
  "NT1: a time change out of the reminder window",
  { timeout: 60_000 },
  () => {
    it("T3a: a direct move 72 hours out sends no reminder now; moved back into the window, one reminder of the new revision", async () => {
      const ids = await inRollback(async (db) => {
        const mark = await queueMark(db)
        const f = await seed(db)
        const { eventId, bookingId } = await dueBooking(db, f, f.customerA)

        await moveStart(db, eventId, "72 hours")
        expect(await run(db, REMINDERS)).toBe(0)
        expect(await reminders(db, bookingId)).toEqual([])

        await moveStart(db, eventId, "23 hours")
        const rev = await revision(db, eventId)
        expect(await run(db, REMINDERS)).toBe(1)
        expect(await reminders(db, bookingId)).toEqual([
          {
            id: expect.any(String),
            dedupe_key: `reminder:${f.customerA}:${bookingId}:${rev}`,
            jobs: 1,
          },
        ])
        expect(await run(db, REMINDERS)).toBe(0)
        expect(await ownQueuedRequests(db, mark)).toBe(0)
        return { customer: f.customerA, bookingId, mark }
      })
      await expectNothingKept([ids.customer], [ids.bookingId], ids.mark)
    })

    it("T3b: the same through admin_reschedule_event: out of the window, none; back in it, one reminder of the new revision", async () => {
      const ids = await inRollback(async (db) => {
        const mark = await queueMark(db)
        const f = await seed(db)
        const { eventId, bookingId } = await dueBooking(db, f, f.customerA)
        const reschedule = (startsIn: string) =>
          as(db, f.admin, () =>
            db.query(RESCHEDULE, [
              eventId,
              startsIn,
              testName("moved"),
              randomUUID(),
            ])
          )
        const first = await revision(db, eventId)

        await reschedule("72 hours")
        expect(await revision(db, eventId)).toBe(first + 1)
        expect(await run(db, REMINDERS)).toBe(0)
        expect(await reminders(db, bookingId)).toEqual([])

        await reschedule("23 hours")
        expect(await revision(db, eventId)).toBe(first + 2)
        expect(await run(db, REMINDERS)).toBe(1)
        expect(await reminders(db, bookingId)).toEqual([
          {
            id: expect.any(String),
            dedupe_key: `reminder:${f.customerA}:${bookingId}:${first + 2}`,
            jobs: 1,
          },
        ])
        expect(await ownQueuedRequests(db, mark)).toBe(0)
        return { customer: f.customerA, bookingId, mark }
      })
      await expectNothingKept([ids.customer], [ids.bookingId], ids.mark)
    })
  }
)

describe(
  "NT2: a push failure does not cancel the booking",
  { timeout: 60_000 },
  () => {
    it("T4: the reminder's push fails for good (HTTP_500, attempt 5): the booking, its allocation, the balance, the place and the notification stay", async () => {
      const ids = await inRollback(async (db) => {
        const mark = await queueMark(db)
        const f = await seed(db)
        // A customer with an Auth user (the subscription's foreign key).
        const customer = (await insertAuthUser(db, "t4_customer")).id
        await db.query(
          "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
          [customer, testName("t4_customer")]
        )
        const { eventId, bookingId, entitlement } = await dueBooking(
          db,
          f,
          customer
        )
        expect(await run(db, REMINDERS)).toBe(1)
        const [reminder] = await reminders(db, bookingId)
        const { rows: jobs } = await db.query(
          "select id from public.notification_jobs where notification_id = $1",
          [reminder.id]
        )
        const jobId = jobs[0].id as string
        await db.query(
          `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, platform)
         values ($1, $2, $3, $4, 'android')`,
          [
            customer,
            `https://fcm.googleapis.com/fcm/send/${testName("t4")}/${randomUUID()}`,
            KEYS.p256dh,
            KEYS.auth,
          ]
        )
        // Every other ready job of the dev database waits (rolled back), so
        // the claim sees only this one; its last attempt.
        await db.query(
          `update public.notification_jobs
         set next_attempt_at = now() + interval '1 day'
         where status = 'queued' and id <> $1`,
          [jobId]
        )
        await db.query(
          `update public.notification_jobs
         set lease_until = now() + interval '1 day'
         where status = 'sending' and id <> $1`,
          [jobId]
        )
        await db.query(
          "update public.notification_jobs set attempt_count = 4 where id = $1",
          [jobId]
        )

        const state = async () => {
          const { rows } = await db.query(
            `select b.id, b.status, b.event_id, b.party_size, b.cancelled_at,
             (select json_agg(json_build_object('entitlement_id', a.entitlement_id, 'credit_id', a.credit_id) order by a.id)
              from public.booking_allocations a where a.booking_id = b.id) as allocations,
             (select json_build_object('available', x.available, 'reserved', x.reserved, 'used', x.used)
              from public.entitlement_balances x where x.entitlement_id = $2) as balance,
             private.occupied_places(b.event_id) as occupied
           from public.bookings b where b.id = $1`,
            [bookingId, entitlement]
          )
          return rows[0]
        }
        const before = await state()
        expect(before).toMatchObject({
          status: "confirmed",
          event_id: eventId,
          cancelled_at: null,
          balance: { available: 3, reserved: 1, used: 0 },
          occupied: 1,
        })

        await asServiceRole(db)
        const { rows: claimed } = await db.query(CLAIM, [25])
        expect(
          (claimed[0].r as { job_id: string }[]).map((c) => c.job_id)
        ).toEqual([jobId])
        const { rows: finished } = await db.query(FINISH, [
          jobId,
          [],
          [],
          "HTTP_500",
        ])
        await db.query("reset role")
        expect(finished[0].r).toEqual({ status: "failed" })
        const { rows: job } = await db.query(
          "select status, attempt_count, last_error from public.notification_jobs where id = $1",
          [jobId]
        )
        expect(job).toEqual([
          { status: "failed", attempt_count: 5, last_error: "HTTP_500" },
        ])

        expect(await state()).toEqual(before)
        const { rows: kept } = await db.query(
          "select id, recipient_id, type from public.notifications where id = $1",
          [reminder.id]
        )
        expect(kept).toEqual([
          { id: reminder.id, recipient_id: customer, type: "reminder" },
        ])
        // The worker was never woken (job_invoke_push_worker not called) and
        // nothing here queued an HTTP request.
        expect(await ownQueuedRequests(db, mark)).toBe(0)
        return { customer, bookingId, mark }
      })
      await expectNothingKept([ids.customer], [ids.bookingId], ids.mark)
    })
  }
)

describe("the queue check itself", { timeout: 60_000 }, () => {
  it("a real private.invoke_push_worker() inside a rollback, also in a subtransaction, is seen by ownQueuedRequests, and nothing of it is committed", async () => {
    const mark = await inRollback(async (db) => {
      const mark = await queueMark(db)
      expect(await ownQueuedRequests(db, mark)).toBe(0)
      // The dev Vault has app_url and cron_secret, so it queues a request.
      const { rows } = await db.query(
        "select private.invoke_push_worker() as id"
      )
      expect(rows[0].id).not.toBeNull()
      expect(await ownQueuedRequests(db, mark)).toBe(1)
      // A plpgsql exception block runs it in a subtransaction.
      await db.query(
        `do $$ begin
           begin
             perform private.invoke_push_worker();
           exception when others then raise;
           end;
         end $$`
      )
      expect(await ownQueuedRequests(db, mark)).toBe(2)
      const { rows: urls } = await db.query(
        `select count(*)::int as n from net.http_request_queue
         where id > $1::bigint and url like '%/api/jobs/push%'`,
        [mark]
      )
      expect(urls[0].n).toBeGreaterThanOrEqual(2)
      return mark
    })
    await expectNothingKept([], [], mark)
  })
})

describe("NT4: the card expiry alerts", { timeout: 60_000 }, () => {
  it("T5: 10 days left, the job twice: one card_expiring for her", async () => {
    const ids = await inRollback(async (db) => {
      const mark = await queueMark(db)
      const f = await seed(db)
      const { entitlement } = await grant(db, f, f.card, f.customerA)
      await setDaysLeft(db, entitlement, 10)
      const day = await expiresOn(db, entitlement)

      // Both thresholds are reached (10 <= 10 and 10 <= 21): her alert and
      // this admin's, each once; the second run adds nothing.
      const mine = [`card_expiring:${f.customerA}:${entitlement}:${day}`]
      const admin = [`admin_card_expiring:${f.admin}:${entitlement}:${day}`]
      expect(await run(db, ALERTS)).toBeGreaterThanOrEqual(2)
      expect(
        await alertKeys(db, "card_expiring", f.customerA, entitlement)
      ).toEqual(mine)
      expect(
        await alertKeys(db, "admin_card_expiring", f.admin, entitlement)
      ).toEqual(admin)
      expect(await run(db, ALERTS)).toBe(0)
      expect(
        await alertKeys(db, "card_expiring", f.customerA, entitlement)
      ).toEqual(mine)
      expect(
        await alertKeys(db, "admin_card_expiring", f.admin, entitlement)
      ).toEqual(admin)
      const { rows } = await db.query(
        `select count(*)::int as n from public.notifications
         where type = 'card_expiring' and dedupe_key like '%:' || $1 || ':%'`,
        [entitlement]
      )
      expect(rows[0].n).toBe(1)
      expect(await ownQueuedRequests(db, mark)).toBe(0)
      return { customer: f.customerA, entitlement, mark }
    })
    await expectNothingKept([ids.customer], [ids.entitlement], ids.mark)
  })

  it("T6: a one-entry card whose entry was used, and a two-entry card with one used and one reserved, 10 days left: no alert of either type", async () => {
    const ids = await inRollback(async (db) => {
      const mark = await queueMark(db)
      const f = await seed(db)
      const one = await insertProduct(db, { label: "one_entry", units: 1 })
      const two = await insertProduct(db, { label: "two_entries", units: 2 })
      const a = await grant(db, f, one, f.customerA)
      const b = await grant(db, f, two, f.customerB)
      await setDaysLeft(db, a.entitlement, 10)
      await setDaysLeft(db, b.entitlement, 10)

      const ended = await insertEvent(db, f, 3)
      const later = await insertEvent(db, f, 5)
      await book(db, f.customerA, ended)
      await book(db, f.customerB, ended)
      await book(db, f.customerB, later)
      // The first session ended; the completion job uses its entries.
      await db.query(
        `update public.events
         set registration_closes_at = now() - interval '4 hours',
             starts_at = now() - interval '3 hours',
             ends_at = now() - interval '1 hour'
         where id = $1`,
        [ended]
      )
      expect(await run(db, COMPLETE)).toBeGreaterThanOrEqual(1)
      const { rows } = await db.query(
        `select entitlement_id, available, reserved, used
         from public.entitlement_balances
         where entitlement_id = any($1::uuid[])`,
        [[a.entitlement, b.entitlement]]
      )
      expect(
        Object.fromEntries(rows.map((r) => [r.entitlement_id, r]))
      ).toEqual({
        [a.entitlement]: {
          entitlement_id: a.entitlement,
          available: 0,
          reserved: 0,
          used: 1,
        },
        [b.entitlement]: {
          entitlement_id: b.entitlement,
          available: 0,
          reserved: 1,
          used: 1,
        },
      })

      await run(db, ALERTS)
      expect(await anyAlerts(db, a.entitlement)).toBe(0)
      expect(await anyAlerts(db, b.entitlement)).toBe(0)
      expect(await ownQueuedRequests(db, mark)).toBe(0)
      return {
        customers: [f.customerA, f.customerB],
        entitlements: [a.entitlement, b.entitlement],
        mark,
      }
    })
    await expectNothingKept(ids.customers, ids.entitlements, ids.mark)
  })

  it("T7: alerted at 3 days left, then a real extension (admin_correct_entitlement, +7) to 10 days left: new alerts keyed by the new expiry, the old ones not repeated", async () => {
    const ids = await inRollback(async (db) => {
      const mark = await queueMark(db)
      const f = await seed(db)
      const { entitlement } = await grant(db, f, f.card, f.customerA)
      await setDaysLeft(db, entitlement, 3)
      const old = await expiresOn(db, entitlement)
      await run(db, ALERTS)
      expect(
        await alertKeys(db, "card_expiring", f.customerA, entitlement)
      ).toEqual([`card_expiring:${f.customerA}:${entitlement}:${old}`])
      expect(
        await alertKeys(db, "admin_card_expiring", f.admin, entitlement)
      ).toEqual([`admin_card_expiring:${f.admin}:${entitlement}:${old}`])

      const { rows: later } = await db.query(
        "select ($1::date + 7)::text as d",
        [old]
      )
      const extended = later[0].d as string
      await as(db, f.admin, () =>
        db.query(CORRECT, [
          entitlement,
          "expires_on",
          JSON.stringify(extended),
          null,
          testName("extend"),
          true,
          randomUUID(),
        ])
      )
      expect(await expiresOn(db, entitlement)).toBe(extended)

      await run(db, ALERTS)
      expect(await run(db, ALERTS)).toBe(0)
      expect(
        await alertKeys(db, "card_expiring", f.customerA, entitlement)
      ).toEqual(
        [
          `card_expiring:${f.customerA}:${entitlement}:${old}`,
          `card_expiring:${f.customerA}:${entitlement}:${extended}`,
        ].sort()
      )
      expect(
        await alertKeys(db, "admin_card_expiring", f.admin, entitlement)
      ).toEqual(
        [
          `admin_card_expiring:${f.admin}:${entitlement}:${old}`,
          `admin_card_expiring:${f.admin}:${entitlement}:${extended}`,
        ].sort()
      )
      expect(await ownQueuedRequests(db, mark)).toBe(0)
      return { customer: f.customerA, admin: f.admin, entitlement, mark }
    })
    await expectNothingKept(
      [ids.customer, ids.admin],
      [ids.entitlement],
      ids.mark
    )
  })
})

describe(
  "NT5: a 20:00 marketing slot across the clock change",
  { timeout: 60_000 },
  () => {
    it("T8: the Monday 20:00 slot fires at 17:00Z on 2099-10-19 (IDT) and at 18:00Z on 2099-10-26 (IST), and not a minute before", async () => {
      const ids = await inRollback(async (db) => {
        const mark = await queueMark(db)
        const f = await seedMoney(db)
        await db.query(
          "update public.business_settings set marketing_reminder_schedule = $1::jsonb",
          [JSON.stringify([{ weekday: 1, time: "20:00" }])]
        )
        await db.query(
          "update public.marketing_reminder_texts set active = false"
        )
        await db.query("delete from private.marketing_reminder_slots")
        await db.query(
          "insert into public.marketing_reminder_texts (body, sort_order) values ($1, 901)",
          [testName("text")]
        )
        const runAtUtc = async (instant: string) =>
          (
            await db.query(
              "select private.job_marketing_reminders($1::timestamptz) as n",
              [instant]
            )
          ).rows[0].n as number

        expect(await runAtUtc("2099-10-19T16:59:00Z")).toBe(0)
        expect(await runAtUtc("2099-10-19T17:00:00Z")).toBeGreaterThanOrEqual(1)
        expect(await runAtUtc("2099-10-26T17:59:00Z")).toBe(0)
        expect(await runAtUtc("2099-10-26T18:00:00Z")).toBeGreaterThanOrEqual(1)
        // Each slot once.
        expect(await runAtUtc("2099-10-26T18:05:00Z")).toBe(0)

        const { rows } = await db.query(
          `select dedupe_key from public.notifications
         where recipient_id = $1 and type = 'marketing_reminder'
         order by dedupe_key`,
          [f.admin]
        )
        expect(rows.map((r) => r.dedupe_key)).toEqual([
          `marketing_reminder:${f.admin}:2099-10-19 20:00`,
          `marketing_reminder:${f.admin}:2099-10-26 20:00`,
        ])
        expect(await ownQueuedRequests(db, mark)).toBe(0)
        return { admin: f.admin, mark }
      })
      await expectNothingKept(
        [ids.admin],
        ["2099-10-19 20:00", "2099-10-26 20:00"],
        ids.mark
      )
    })
  }
)

describe(
  "CN3, NT1: the defaults of N and of the reminder lead",
  { timeout: 60_000 },
  () => {
    it("T9: the column defaults are 2 and 24; the live row set to 3 and 6 and reset to default gives 2 and 24 back, and a credit created then gets 2 options", async () => {
      const ids = await inRollback(async (db) => {
        const mark = await queueMark(db)
        const { rows: defaults } = await db.query(
          `select a.attname, pg_get_expr(d.adbin, d.adrelid)::text as expr
         from pg_attrdef d
         join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
         where d.adrelid = 'public.business_settings'::regclass
           and a.attname in ('credit_options_count', 'reminder_lead_hours')
         order by a.attname`
        )
        expect(defaults).toEqual([
          { attname: "credit_options_count", expr: "2" },
          { attname: "reminder_lead_hours", expr: "24" },
        ])

        const f = await seed(db)
        const values = async () => {
          const { rows } = await db.query(
            "select credit_options_count, reminder_lead_hours from public.business_settings"
          )
          return rows
        }
        await db.query(
          "update public.business_settings set credit_options_count = 3, reminder_lead_hours = 6"
        )
        expect(await values()).toEqual([
          { credit_options_count: 3, reminder_lead_hours: 6 },
        ])
        await db.query(
          "update public.business_settings set credit_options_count = default, reminder_lead_hours = default"
        )
        expect(await values()).toEqual([
          { credit_options_count: 2, reminder_lead_hours: 24 },
        ])

        const origin = await insertEvent(db, f, 5)
        const a = await insertEvent(db, f, 6)
        const b = await insertEvent(db, f, 7)
        await insertEvent(db, f, 8)
        const { payment } = await grant(db, f, f.single, f.customerA, origin)
        const { rows: bookings } = await db.query(
          "select id, (policy_snapshot ->> 'reminder_lead_hours')::int as lead from public.bookings where payment_id = $1",
          [payment]
        )
        expect(bookings[0].lead).toBe(24)
        const r = await as(db, f.customerA, async () => {
          const { rows } = await db.query(CANCEL, [
            bookings[0].id,
            randomUUID(),
            "credit",
          ])
          return rows[0].r
        })
        const { rows: credit } = await db.query(
          "select options_count from public.cancellation_credits where id = $1",
          [r.credit_id]
        )
        expect(credit).toEqual([{ options_count: 2 }])
        const { rows: options } = await db.query(
          `select o.event_id from public.credit_options o
         join public.events e on e.id = o.event_id
         where o.credit_id = $1 and o.state = 'active'
         order by e.starts_at`,
          [r.credit_id]
        )
        expect(options.map((o) => o.event_id)).toEqual([a, b])
        expect(await ownQueuedRequests(db, mark)).toBe(0)
        return { customer: f.customerA, credit: r.credit_id as string, mark }
      })
      await expectNothingKept([ids.customer], [ids.credit], ids.mark)
    })
  }
)
