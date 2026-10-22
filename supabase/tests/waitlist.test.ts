// Story 5.6: the waitlist. join_waitlist, leave_waitlist, get_my_waitlist,
// private.notify_waitlist through every caller (cancel_booking,
// admin_cancel_booking, move_booking, admin_update_event), the end of an
// entry on a booking (book_session, admin_book_customer, a move's target,
// private.bind_purchase), the silent close on a business cancel, the
// waitlist in admin_get_event_details, grants and RLS. One test per row of
// the spec's I/O matrix (the stale push: push.test.ts). Everything runs in
// inRollback; fictitious customers only.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const JOIN = "select public.join_waitlist($1, $2) as r"
const LEAVE = "select public.leave_waitlist($1, $2) as r"
const MY_WAITLIST = "select public.get_my_waitlist() as r"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2) as r"
const ADMIN_CANCEL = "select public.admin_cancel_booking($1, $2, $3) as r"
const ADMIN_BOOK = "select public.admin_book_customer($1, $2, $3) as r"
const MOVE = "select public.move_booking($1, $2, $3) as r"
const UPDATE_EVENT = "select public.admin_update_event($1, $2::jsonb, $3) as r"
const CANCEL_EVENT =
  "select public.admin_cancel_event($1, true, $2, $3, true) as r"
const DETAILS = "select public.admin_get_event_details($1) as r"
const SNAPSHOT = `'{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb`

type Fixture = MoneyFixture & {
  customerC: string
  customerD: string
  // Activated, no card at all.
  noCard: string
  inactive: string
  single: string
  mothers: string
  grandma: string
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         credit_options_count = 2`
  )
  const customerC = randomUUID()
  const customerD = randomUUID()
  const noCard = randomUUID()
  const inactive = randomUUID()
  await db.query(
    `insert into public.profiles (id, full_name, activated_at)
     values ($1, $2, now()), ($3, $4, now()), ($5, $6, now()), ($7, $8, null)`,
    [
      customerC,
      testName("wait_c"),
      customerD,
      testName("wait_d"),
      noCard,
      testName("wait_no_card"),
      inactive,
      testName("wait_inactive"),
    ]
  )
  const { rows: products } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size)
     values ($1, 'single', 12800, 1, 'session', null, null, 'regular', 1)
     returning id`,
    [testName("wait_single")]
  )
  const { rows } = await db.query<{ id: string; theme_key: string }>(
    "select id, theme_key from public.concepts where archived_at is null"
  )
  const concepts = Object.fromEntries(rows.map((c) => [c.theme_key, c.id]))
  const fixture: Fixture = {
    ...f,
    customerC,
    customerD,
    noCard,
    inactive,
    single: products[0].id,
    mothers: concepts.mothers,
    grandma: concepts.grandma,
  }
  for (const customer of [f.customerA, f.customerB, customerC, customerD]) {
    await grantCard(db, fixture, customer)
  }
  return fixture
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

async function grantCard(db: Db, f: Fixture, customer: string): Promise<void> {
  await as(db, f.admin, () =>
    approve(db, {
      customerId: customer,
      productId: f.card,
      amount: 47200,
      paidOn: f.today,
      methodId: f.method,
      duplicateConfirmed: true,
      key: randomUUID(),
    })
  )
}

// As the owner: a published session `dayOffset` days from today at 10:00
// Jerusalem time, open until it starts (or closed a minute ago).
async function insertEvent(
  db: Db,
  f: Fixture,
  options: {
    dayOffset?: number
    capacity?: number
    kind?: "regular" | "couple"
    closed?: boolean
  } = {}
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $2, s.t, s.t + interval '2 hours', $3,
       case when $5::boolean then now() - interval '1 minute' else s.t end,
       true, 'published'
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + $4::int)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [
      options.kind === "couple" ? f.grandma : f.mothers,
      options.kind ?? "regular",
      options.capacity ?? 1,
      options.dayOffset ?? 5,
      options.closed ?? false,
    ]
  )
  return rows[0].id
}

async function book(db: Db, customer: string, eventId: string) {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    return rows[0].r.booking_id as string
  })
}

async function cancel(db: Db, customer: string, bookingId: string) {
  return as(db, customer, () => db.query(CANCEL, [bookingId, randomUUID()]))
}

async function join(
  db: Db,
  customer: string,
  eventId: string,
  key = randomUUID()
) {
  return as(db, customer, async () => {
    const { rows } = await db.query(JOIN, [eventId, key])
    return rows[0].r
  })
}

async function joinError(db: Db, customer: string, eventId: string) {
  return as(db, customer, () => queryError(db, JOIN, [eventId, randomUUID()]))
}

async function entryOf(db: Db, customer: string, eventId: string) {
  const { rows } = await db.query(
    `select status, status = 'left' as quit, closed_at is not null as closed, party_size,
       last_notified_cycle
     from public.waitlist_entries
     where customer_id = $1 and event_id = $2
     order by (status = 'active') desc, closed_at desc nulls first
     limit 1`,
    [customer, eventId]
  )
  return rows[0]
}

async function spots(db: Db, customer: string) {
  const { rows } = await db.query(
    `select n.target_path, n.dedupe_key,
       (select count(*)::int from public.notification_jobs j
        where j.notification_id = n.id) as jobs
     from public.notifications n
     where n.recipient_id = $1 and n.type = 'waitlist_spot'
     order by n.dedupe_key`,
    [customer]
  )
  return rows
}

async function cycleOf(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query(
    "select waitlist_cycle from public.events where id = $1",
    [eventId]
  )
  return rows[0].waitlist_cycle
}

describe("join_waitlist / leave_waitlist", { timeout: 60_000 }, () => {
  it("join, no funding: an active entry; she still cannot book", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      const r = await join(db, f.noCard, event)
      expect(r).toMatchObject({ event_id: event, entry_id: expect.any(String) })
      expect(await entryOf(db, f.noCard, event)).toMatchObject({
        status: "active",
        closed: false,
        party_size: 1,
        last_notified_cycle: null,
      })
      expect(
        await as(db, f.noCard, () =>
          queryError(db, BOOK, [event, randomUUID()])
        )
      ).toMatchObject({ code: "P0001", message: "EVENT_FULL" })
      // Audited, shown in the log.
      const { rows } = await db.query(
        `select action, entity_type, customer_id, event_id
         from public.audit_log where entity_id = $1`,
        [r.entry_id]
      )
      expect(rows).toEqual([
        {
          action: "join_waitlist",
          entity_type: "waitlist_entries",
          customer_id: f.noCard,
          event_id: event,
        },
      ])
    })
  })

  it("twice: ALREADY_WAITLISTED; the same key returns the earlier result", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      const key = randomUUID()
      const first = await join(db, f.customerB, event, key)
      expect(await join(db, f.customerB, event, key)).toEqual(first)
      expect(await joinError(db, f.customerB, event)).toMatchObject({
        message: "ALREADY_WAITLISTED",
      })
    })
  })

  it("booked: ALREADY_BOOKED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      expect(await joinError(db, f.customerA, event)).toMatchObject({
        message: "ALREADY_BOOKED",
      })
    })
  })

  it("not full: EVENT_NOT_FULL", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, { capacity: 2 })
      await book(db, f.customerA, event)
      expect(await joinError(db, f.customerB, event)).toMatchObject({
        message: "EVENT_NOT_FULL",
      })
    })
  })

  it("an admin or an inactive profile: NOT_AUTHORIZED; a draft: NOT_FOUND", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      for (const user of [f.admin, f.inactive]) {
        expect(await joinError(db, user, event)).toMatchObject({
          message: "NOT_AUTHORIZED",
        })
      }
      await db.query(
        "update public.events set status = 'draft' where id = $1",
        [event]
      )
      expect(await joinError(db, f.customerB, event)).toMatchObject({
        message: "NOT_FOUND",
      })
    })
  })

  it("closed: REGISTRATION_CLOSED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, { closed: true })
      expect(await joinError(db, f.customerB, event)).toMatchObject({
        message: "REGISTRATION_CLOSED",
      })
    })
  })

  it("leave: status quit with closed_at and an audit row; again: NOT_WAITLISTED; the list is empty", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      const { entry_id } = await join(db, f.customerB, event)
      const left = await as(db, f.customerB, async () => {
        const { rows } = await db.query(LEAVE, [event, randomUUID()])
        return rows[0].r
      })
      expect(left).toMatchObject({
        event_id: event,
        starts_at: expect.any(String),
      })
      expect(await entryOf(db, f.customerB, event)).toMatchObject({
        quit: true,
        closed: true,
      })
      expect(
        await as(db, f.customerB, () =>
          queryError(db, LEAVE, [event, randomUUID()])
        )
      ).toMatchObject({ message: "NOT_WAITLISTED" })
      const { rows } = await db.query(
        "select action from public.audit_log where entity_id = $1 order by created_at",
        [entry_id]
      )
      expect(rows.map((r) => r.action)).toEqual([
        "join_waitlist",
        "leave_waitlist",
      ])
      // She may join again.
      await join(db, f.customerB, event)
      expect(await entryOf(db, f.customerB, event)).toMatchObject({
        status: "active",
      })
    })
  })

  it("couple, one place free: join succeeds with party_size 2", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, { kind: "couple", capacity: 5 })
      // As the owner: two couple bookings, one place left.
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $3, 2, 'admin', ${SNAPSHOT}), ($2, $3, 2, 'admin', ${SNAPSHOT})`,
        [f.customerA, f.customerB, event]
      )
      await join(db, f.customerC, event)
      expect(await entryOf(db, f.customerC, event)).toMatchObject({
        status: "active",
        party_size: 2,
      })
    })
  })

  it("leave after registration_closes_at: allowed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      await join(db, f.customerB, event)
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 minute' where id = $1",
        [event]
      )
      await as(db, f.customerB, () => db.query(LEAVE, [event, randomUUID()]))
      expect(await entryOf(db, f.customerB, event)).toMatchObject({
        quit: true,
        closed: true,
      })
    })
  })

  it("leave replayed with the same key: the earlier result, not NOT_WAITLISTED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      await join(db, f.customerB, event)
      const key = randomUUID()
      const call = () =>
        as(db, f.customerB, async () => {
          const { rows } = await db.query(LEAVE, [event, key])
          return rows[0].r
        })
      const first = await call()
      expect(await call()).toEqual(first)
      const { rows } = await db.query(
        `select count(*)::int as n from public.audit_log
         where action = 'leave_waitlist' and customer_id = $1`,
        [f.customerB]
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("get_my_waitlist: her open entries only, by start", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const later = await insertEvent(db, f, { dayOffset: 8 })
      const sooner = await insertEvent(db, f, { dayOffset: 6 })
      await book(db, f.customerA, later)
      await book(db, f.customerA, sooner)
      await join(db, f.customerB, later)
      await join(db, f.customerB, sooner)
      await join(db, f.customerC, sooner)
      const list = await as(db, f.customerB, async () => {
        const { rows } = await db.query(MY_WAITLIST)
        return rows[0].r
      })
      expect(list.map((r: { event_id: string }) => r.event_id)).toEqual([
        sooner,
        later,
      ])
      expect(list[0]).toMatchObject({
        concept_name: expect.any(String),
        kind: "regular",
        joined_at: expect.any(String),
        starts_at: expect.any(String),
      })
      // A session that closed leaves the list.
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 minute' where id = $1",
        [sooner]
      )
      const after = await as(db, f.customerB, async () => {
        const { rows } = await db.query(MY_WAITLIST)
        return rows[0].r
      })
      expect(after.map((r: { event_id: string }) => r.event_id)).toEqual([
        later,
      ])
    })
  })
})

describe("the release (notify_waitlist)", { timeout: 60_000 }, () => {
  it("release: one cancels a full session, two wait: cycle + 1, each gets one waitlist_spot with one job", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      const booking = await book(db, f.customerA, event)
      await join(db, f.customerB, event)
      await join(db, f.customerC, event)
      expect(await cycleOf(db, event)).toBe(0)
      await cancel(db, f.customerA, booking)
      expect(await cycleOf(db, event)).toBe(1)
      for (const customer of [f.customerB, f.customerC]) {
        expect(await spots(db, customer)).toEqual([
          {
            target_path: `/me/sessions/${event}?from=waitlist`,
            dedupe_key: `waitlist_spot:${customer}:${event}:1:1`,
            jobs: 1,
          },
        ])
        expect(await entryOf(db, customer, event)).toMatchObject({
          status: "active",
          last_notified_cycle: 1,
        })
      }
      // The admin's details: both, notified (one transaction: the same
      // joined_at, so compared without order).
      const details = await as(db, f.admin, async () => {
        const { rows } = await db.query(DETAILS, [event])
        return rows[0].r
      })
      expect(details.waitlist).toHaveLength(2)
      expect(details.waitlist).toEqual(
        expect.arrayContaining([
          {
            customer_id: f.customerB,
            customer_label: testName("money_b"),
            joined_at: expect.any(String),
            notified: true,
          },
          {
            customer_id: f.customerC,
            customer_label: testName("wait_c"),
            joined_at: expect.any(String),
            notified: true,
          },
        ])
      )
    })
  })

  it("second release before the session fills: nothing new", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, { capacity: 2 })
      const a = await book(db, f.customerA, event)
      const b = await book(db, f.customerB, event)
      await join(db, f.customerC, event)
      await cancel(db, f.customerA, a)
      await cancel(db, f.customerB, b)
      expect(await cycleOf(db, event)).toBe(1)
      expect(await spots(db, f.customerC)).toHaveLength(1)
    })
  })

  it("refill then free: a new cycle and a new notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      const a = await book(db, f.customerA, event)
      await join(db, f.customerC, event)
      await cancel(db, f.customerA, a)
      const b = await book(db, f.customerB, event)
      await cancel(db, f.customerB, b)
      expect(await cycleOf(db, event)).toBe(2)
      expect((await spots(db, f.customerC)).map((s) => s.dedupe_key)).toEqual([
        `waitlist_spot:${f.customerC}:${event}:1:1`,
        `waitlist_spot:${f.customerC}:${event}:1:2`,
      ])
    })
  })

  it("couple, one place: free 0 -> 1 sends nothing; 1 -> 2 notifies (capacity raised twice)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, { kind: "couple", capacity: 4 })
      // As the owner: two couple bookings fill it.
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, booked_by, policy_snapshot)
         values ($1, $3, 2, 'admin', ${SNAPSHOT}), ($2, $3, 2, 'admin', ${SNAPSHOT})`,
        [f.customerA, f.customerB, event]
      )
      await join(db, f.customerC, event)
      expect(await entryOf(db, f.customerC, event)).toMatchObject({
        party_size: 2,
      })
      const raise = (capacity: number) =>
        as(db, f.admin, () =>
          db.query(UPDATE_EVENT, [
            event,
            JSON.stringify({ capacity_adults: capacity }),
            randomUUID(),
          ])
        )
      await raise(5)
      expect(await cycleOf(db, event)).toBe(0)
      expect(await spots(db, f.customerC)).toEqual([])
      await raise(6)
      expect(await cycleOf(db, event)).toBe(1)
      expect((await spots(db, f.customerC)).map((s) => s.dedupe_key)).toEqual([
        `waitlist_spot:${f.customerC}:${event}:2:1`,
      ])
    })
  })

  it("capacity up: a full session raised by Tal notifies", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      await join(db, f.customerC, event)
      await as(db, f.admin, () =>
        db.query(UPDATE_EVENT, [
          event,
          JSON.stringify({ capacity_adults: 2 }),
          randomUUID(),
        ])
      )
      expect(await spots(db, f.customerC)).toHaveLength(1)
    })
  })

  it("after close: a release after registration_closes_at: no cycle, nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      const a = await book(db, f.customerA, event)
      await join(db, f.customerC, event)
      await db.query(
        "update public.events set registration_closes_at = now() - interval '1 minute' where id = $1",
        [event]
      )
      await as(db, f.admin, () =>
        db.query(ADMIN_CANCEL, [a, true, randomUUID()])
      )
      expect(await cycleOf(db, event)).toBe(0)
      expect(await spots(db, f.customerC)).toEqual([])
    })
  })

  it("move: a booking moved out of a full session notifies its waiters", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const source = await insertEvent(db, f)
      const target = await insertEvent(db, f, { dayOffset: 6, capacity: 4 })
      const a = await book(db, f.customerA, source)
      await join(db, f.customerC, source)
      await as(db, f.customerA, () => db.query(MOVE, [a, target, randomUUID()]))
      expect(await spots(db, f.customerC)).toHaveLength(1)
    })
  })
})

describe("the end of an entry", { timeout: 60_000 }, () => {
  it("books herself: the entry becomes booked and leaves her list and Tal's", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      const a = await book(db, f.customerA, event)
      await join(db, f.customerC, event)
      await cancel(db, f.customerA, a)
      await book(db, f.customerC, event)
      expect(await entryOf(db, f.customerC, event)).toMatchObject({
        status: "booked",
        closed: true,
      })
      const list = await as(db, f.customerC, async () => {
        const { rows } = await db.query(MY_WAITLIST)
        return rows[0].r
      })
      expect(list).toEqual([])
      const details = await as(db, f.admin, async () => {
        const { rows } = await db.query(DETAILS, [event])
        return rows[0].r
      })
      expect(details.waitlist).toEqual([])
    })
  })

  it("booked by Tal: booked", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      const a = await book(db, f.customerA, event)
      await join(db, f.customerC, event)
      await cancel(db, f.customerA, a)
      await as(db, f.admin, () =>
        db.query(ADMIN_BOOK, [f.customerC, event, randomUUID()])
      )
      expect(await entryOf(db, f.customerC, event)).toMatchObject({
        status: "booked",
      })
    })
  })

  it("a move's target: booked", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const full = await insertEvent(db, f)
      const other = await insertEvent(db, f, { dayOffset: 6, capacity: 4 })
      const a = await book(db, f.customerA, full)
      const c = await book(db, f.customerC, other)
      await join(db, f.customerC, full)
      await cancel(db, f.customerA, a)
      await as(db, f.customerC, () => db.query(MOVE, [c, full, randomUUID()]))
      expect(await entryOf(db, f.customerC, full)).toMatchObject({
        status: "booked",
      })
    })
  })

  it("business cancel: entries closed, no waitlist_spot", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      await join(db, f.customerC, event)
      await as(db, f.admin, () =>
        db.query(CANCEL_EVENT, [event, "המפגש בוטל", randomUUID()])
      )
      expect(await entryOf(db, f.customerC, event)).toMatchObject({
        status: "closed",
        closed: true,
      })
      expect(await spots(db, f.customerC)).toEqual([])
    })
  })

  it("bind: a pinned purchase bound to her for a session she waits for: booked", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      // A pinned single for a new customer holds the only place (AD-23).
      const r = await as(db, f.admin, () =>
        approve(db, {
          customerId: null,
          productId: f.single,
          eventId: event,
          amount: 12800,
          paidOn: f.today,
          methodId: f.method,
          duplicateConfirmed: true,
          key: randomUUID(),
        })
      )
      await join(db, f.noCard, event)
      await db.query("select private.bind_purchase($1, $2)", [
        r.payment_id,
        f.noCard,
      ])
      expect(await entryOf(db, f.noCard, event)).toMatchObject({
        status: "booked",
        closed: true,
      })
      const { rows } = await db.query(
        "select customer_id from public.bookings where payment_id = $1",
        [r.payment_id]
      )
      expect(rows).toEqual([{ customer_id: f.noCard }])
    })
  })
})

describe("get_taken_waitlist_spots (phone check)", { timeout: 60_000 }, () => {
  async function spotIds(db: Db, customer: string): Promise<string[]> {
    const { rows } = await db.query(
      `select id from public.notifications
       where recipient_id = $1 and type = 'waitlist_spot'
       order by dedupe_key`,
      [customer]
    )
    return rows.map((r) => r.id as string)
  }

  async function taken(db: Db, customer: string, ids: string[]) {
    return as(db, customer, async () => {
      const { rows } = await db.query(
        "select public.get_taken_waitlist_spots($1::uuid[]) as r",
        [ids]
      )
      return [...(rows[0].r as string[])].sort()
    })
  }

  it("current: none; taken by another: marked; old cycle: marked; she booked: none; not hers: none", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      const a = await book(db, f.customerA, event)
      await join(db, f.customerC, event)
      await cancel(db, f.customerA, a)
      const [first] = await spotIds(db, f.customerC)
      expect(await taken(db, f.customerC, [first])).toEqual([])

      const b = await book(db, f.customerB, event)
      expect(await taken(db, f.customerC, [first])).toEqual([first])

      await cancel(db, f.customerB, b)
      const [, second] = await spotIds(db, f.customerC)
      // Free again: the first spot belongs to an old cycle.
      expect(await taken(db, f.customerC, [first, second])).toEqual([first])
      // Someone else's ids give nothing.
      expect(await taken(db, f.customerA, [first, second])).toEqual([])

      await book(db, f.customerC, event)
      expect(await taken(db, f.customerC, [first, second])).toEqual([])
    })
  })
})

describe("grants and RLS", { timeout: 60_000 }, () => {
  it("a customer reads only her own entries and cannot write; the admin reads all", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await book(db, f.customerA, event)
      await join(db, f.customerB, event)
      await join(db, f.customerC, event)
      const mine = await as(db, f.customerB, async () => {
        const { rows } = await db.query(
          "select customer_id from public.waitlist_entries where event_id = $1",
          [event]
        )
        return rows
      })
      expect(mine).toEqual([{ customer_id: f.customerB }])
      expect(
        await as(db, f.customerB, () =>
          queryError(
            db,
            "insert into public.waitlist_entries (customer_id, event_id, party_size) values ($1, $2, 1)",
            [f.customerB, event]
          )
        )
      ).toMatchObject({ code: "42501" })
      expect(
        await as(db, f.customerB, () =>
          queryError(
            db,
            "update public.waitlist_entries set status = 'left' where customer_id = $1",
            [f.customerB]
          )
        )
      ).toMatchObject({ code: "42501" })
      const all = await as(db, f.admin, async () => {
        const { rows } = await db.query(
          "select count(*)::int as n from public.waitlist_entries where event_id = $1",
          [event]
        )
        return rows[0].n
      })
      expect(all).toBe(2)
    })
  })

  it("anon cannot call join_waitlist", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f)
      await db.query("set local role anon")
      expect(await queryError(db, JOIN, [event, randomUUID()])).toMatchObject({
        code: "42501",
      })
      await db.query("reset role")
    })
  })
})

// Story 5.20 (user decision 2026-10-22): reopening registration notifies the
// waitlist, once, merged with a capacity raise in the same save.
describe("admin_update_event reopens registration", { timeout: 60_000 }, () => {
  // A local "YYYY-MM-DDTHH:MM" one day from now (before the session).
  const REOPEN_AT = `to_char((now() + interval '1 day') at time zone 'Asia/Jerusalem', 'YYYY-MM-DD"T"HH24:MI')`

  async function closedWithWaiter(db: Db, f: Fixture, free: boolean) {
    const event = await insertEvent(db, f)
    const a = await book(db, f.customerA, event)
    await join(db, f.customerC, event)
    await db.query(
      "update public.events set registration_closes_at = now() - interval '1 minute' where id = $1",
      [event]
    )
    if (free) {
      // A place frees after the close: nobody is told yet.
      await as(db, f.admin, () =>
        db.query(ADMIN_CANCEL, [a, true, randomUUID()])
      )
      expect(await spots(db, f.customerC)).toEqual([])
    }
    return event
  }

  async function reopen(db: Db, f: Fixture, event: string, extra = {}) {
    const { rows } = await db.query(`select ${REOPEN_AT} as at`)
    await as(db, f.admin, () =>
      db.query(UPDATE_EVENT, [
        event,
        JSON.stringify({ registration_closes_local: rows[0].at, ...extra }),
        randomUUID(),
      ])
    )
  }

  it("closed -> open with a free place: the waiter is told once", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await closedWithWaiter(db, f, true)
      await reopen(db, f, event)
      expect(await cycleOf(db, event)).toBe(1)
      expect((await spots(db, f.customerC)).map((s) => s.dedupe_key)).toEqual([
        `waitlist_spot:${f.customerC}:${event}:1:1`,
      ])
    })
  })

  it("a capacity raise in the same save does not notify twice", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await closedWithWaiter(db, f, false)
      await reopen(db, f, event, { capacity_adults: 2 })
      expect(await cycleOf(db, event)).toBe(1)
      expect(await spots(db, f.customerC)).toHaveLength(1)
    })
  })

  it("reopened but full: nothing (notify_waitlist checks the room)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await closedWithWaiter(db, f, false)
      await reopen(db, f, event)
      expect(await cycleOf(db, event)).toBe(0)
      expect(await spots(db, f.customerC)).toEqual([])
    })
  })

  it("an open registration moved later is not a reopening", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const event = await insertEvent(db, f, { capacity: 2 })
      await book(db, f.customerA, event)
      await book(db, f.customerB, event)
      await join(db, f.customerC, event)
      await reopen(db, f, event)
      expect(await cycleOf(db, event)).toBe(0)
      expect(await spots(db, f.customerC)).toEqual([])
    })
  })
})
