// Story 5.17: private.job_reminders (the session reminder) and the reminders
// cron job. One test per row of the spec's I/O matrix. Sessions are booked
// while open (book_session), then, as the owner, the session is moved to
// start soon and the booking's confirmed_at is moved back. The job is called
// directly inside inRollback, as the owner (pg_cron's role); every other
// published session is moved to draft in the seed, so the job's count is
// only this test's reminders. now() is the transaction's start, so it is the
// same for the booking, the move and the job. The locked-booking test needs
// real commits and cleans up after itself.

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
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const JOB = "select private.job_reminders() as n"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2) as r"
const TEMPLATE =
  "select public.admin_update_notification_template($1, $2, $3, $4, $5) as r"

type Fixture = MoneyFixture & {
  single: string
  mothers: string
  mothersName: string
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24`
  )
  // Only this test's sessions are published (and so reminded by the job).
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
    "select id, name from public.concepts where theme_key = 'mothers' and archived_at is null"
  )
  return {
    ...f,
    single: rows[0].id,
    mothers: concepts[0].id,
    mothersName: concepts[0].name,
  }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role")
  }
}

// As the owner: a published session 5 local days from today at 10:00
// Jerusalem time, open for booking until it starts.
async function insertEvent(db: Db, f: Fixture): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true,
       'published'
     from (
       select (((now() at time zone 'Asia/Jerusalem')::date + 5)
               + time '10:00') at time zone 'Asia/Jerusalem' as t
     ) s
     returning id`,
    [f.mothers]
  )
  return rows[0].id
}

// As the admin: approves a product (for a pinned one, with its session).
async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  options: { customerId?: string | null; eventId?: string | null } = {}
): Promise<string> {
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
  return r.payment_id as string
}

// As `customer`: books the session; returns the booking id.
async function book(
  db: Db,
  customer: string,
  eventId: string
): Promise<string> {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    expect(rows[0].r).toHaveProperty("booking_id")
    return rows[0].r.booking_id as string
  })
}

// As the owner: the session starts `startsIn` from now (bumps its revision).
async function moveStart(db: Db, eventId: string, startsIn = "23 hours") {
  await db.query(
    `update public.events
     set registration_closes_at = now() + $2::interval - interval '1 hour',
         starts_at = now() + $2::interval,
         ends_at = now() + $2::interval + interval '2 hours'
     where id = $1`,
    [eventId, startsIn]
  )
}

// As the owner: the booking was confirmed `ago` before now.
async function backdate(db: Db, bookingId: string, ago = "3 days") {
  await db.query(
    "update public.bookings set confirmed_at = now() - $2::interval where id = $1",
    [bookingId, ago]
  )
}

// A card for `customer` and her booking, confirmed 3 days ago, of a session
// that starts in 23 hours.
async function dueBooking(
  db: Db,
  f: Fixture,
  customer = f.customerA
): Promise<{ eventId: string; bookingId: string }> {
  await grant(db, f, f.card, { customerId: customer })
  const eventId = await insertEvent(db, f)
  const bookingId = await book(db, customer, eventId)
  await backdate(db, bookingId)
  await moveStart(db, eventId)
  return { eventId, bookingId }
}

async function runJob(db: Db): Promise<number> {
  const { rows } = await db.query(JOB)
  return rows[0].n as number
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
    `select n.id, n.recipient_id, n.recipient_kind, n.dedupe_key,
       n.target_path, n.payload ->> 'title' as title,
       n.payload ->> 'body' as body,
       (select count(*)::int from public.notification_jobs j
        where j.notification_id = n.id) as jobs
     from public.notifications n
     where n.type = 'reminder' and n.dedupe_key like '%:' || $1 || ':%'
     order by split_part(n.dedupe_key, ':', 4)::int`,
    [bookingId]
  )
  return rows
}

// The reminder text the job must render now: the current template with
// {date} DD.MM and {time} HH:MM of the session in Jerusalem, {concept} its
// concept's name.
async function expectedText(db: Db, eventId: string) {
  const { rows } = await db.query(
    `select t.title, t.body, c.name as concept,
       to_char(e.starts_at at time zone 'Asia/Jerusalem', 'DD.MM') as date,
       to_char(e.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as time
     from public.notification_templates t, public.events e
     join public.concepts c on c.id = e.concept_id
     where t.type = 'reminder' and e.id = $1`,
    [eventId]
  )
  const { title, body, concept, date, time } = rows[0]
  const fill = (text: string) =>
    text
      .replaceAll("{date}", date)
      .replaceAll("{time}", time)
      .replaceAll("{concept}", concept)
  return { title: fill(title), body: fill(body) }
}

describe("private.job_reminders", { timeout: 30_000 }, () => {
  it("a booking from 3 days ago, the session in 23 hours, snapshot 24: one rendered reminder and one push job", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { eventId, bookingId } = await dueBooking(db, f)

      expect(await runJob(db)).toBe(1)

      const rev = await revision(db, eventId)
      expect(await reminders(db, bookingId)).toEqual([
        {
          id: expect.any(String),
          recipient_id: f.customerA,
          recipient_kind: "customer",
          dedupe_key: `reminder:${f.customerA}:${bookingId}:${rev}`,
          target_path: `/me/sessions/${eventId}`,
          ...(await expectedText(db, eventId)),
          jobs: 1,
        },
      ])
    })
  })

  it("a double run: no new notification, the second run returns 0", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { bookingId } = await dueBooking(db, f)

      expect(await runJob(db)).toBe(1)
      expect(await runJob(db)).toBe(0)
      expect(await reminders(db, bookingId)).toHaveLength(1)
    })
  })

  it("a cancelled booking in the window: no reminder", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.card)
      const eventId = await insertEvent(db, f)
      const bookingId = await book(db, f.customerA, eventId)
      await as(db, f.customerA, () =>
        db.query(CANCEL, [bookingId, randomUUID()])
      )
      await backdate(db, bookingId)
      await moveStart(db, eventId)

      expect(await runJob(db)).toBe(0)
      expect(await reminders(db, bookingId)).toEqual([])
    })
  })

  it("a late booking (confirmed_at after starts_at - 24h): no reminder", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.card)
      const eventId = await insertEvent(db, f)
      const bookingId = await book(db, f.customerA, eventId)
      // confirmed_at = now(), the session in 23 hours.
      await moveStart(db, eventId)

      expect(await runJob(db)).toBe(0)
      expect(await reminders(db, bookingId)).toEqual([])
    })
  })

  it("a pinned booking without a customer: no reminder and no error", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const eventId = await insertEvent(db, f)
      const payment = await grant(db, f, f.single, {
        customerId: null,
        eventId,
      })
      const { rows } = await db.query(
        "select id, customer_id from public.bookings where payment_id = $1",
        [payment]
      )
      expect(rows).toEqual([{ id: expect.any(String), customer_id: null }])
      await backdate(db, rows[0].id)
      await moveStart(db, eventId)

      expect(await runJob(db)).toBe(0)
      expect(await reminders(db, rows[0].id)).toEqual([])
    })
  })

  it("the snapshot wins: snapshot 24 with the setting changed to 2 is reminded; snapshot 2 is not", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.card)
      await grant(db, f, f.card, { customerId: f.customerB })
      const eventId = await insertEvent(db, f)
      const lead24 = await book(db, f.customerA, eventId)
      await db.query(
        "update public.business_settings set reminder_lead_hours = 2"
      )
      const lead2 = await book(db, f.customerB, eventId)
      const { rows } = await db.query(
        `select id, (policy_snapshot ->> 'reminder_lead_hours')::int as lead
         from public.bookings where id = any($1::uuid[]) order by lead`,
        [[lead24, lead2]]
      )
      expect(rows).toEqual([
        { id: lead2, lead: 2 },
        { id: lead24, lead: 24 },
      ])
      await backdate(db, lead24)
      await backdate(db, lead2)
      await moveStart(db, eventId)

      expect(await runJob(db)).toBe(1)
      expect(await reminders(db, lead24)).toHaveLength(1)
      expect(await reminders(db, lead2)).toEqual([])
    })
  })

  it("a time change after the reminder, still in the window: the revision rose, a second reminder with a new discriminator", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { eventId, bookingId } = await dueBooking(db, f)
      expect(await runJob(db)).toBe(1)
      const first = await revision(db, eventId)

      await moveStart(db, eventId, "22 hours")
      const second = await revision(db, eventId)
      expect(second).toBe(first + 1)

      expect(await runJob(db)).toBe(1)
      const sent = await reminders(db, bookingId)
      expect(sent.map((n) => n.dedupe_key)).toEqual([
        `reminder:${f.customerA}:${bookingId}:${first}`,
        `reminder:${f.customerA}:${bookingId}:${second}`,
      ])
      expect(sent[1]).toMatchObject({
        ...(await expectedText(db, eventId)),
        jobs: 1,
      })
    })
  })

  it("a change that keeps the revision (capacity) after the reminder: no new reminder", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { eventId, bookingId } = await dueBooking(db, f)
      expect(await runJob(db)).toBe(1)
      const before = await revision(db, eventId)

      await db.query(
        "update public.events set capacity_adults = 13, description = $2 where id = $1",
        [eventId, testName("description")]
      )
      expect(await revision(db, eventId)).toBe(before)

      expect(await runJob(db)).toBe(0)
      expect(await reminders(db, bookingId)).toHaveLength(1)
    })
  })

  it.each(["0 seconds", "-1 hour"])(
    "the session started (starts_at = now() + %s): no reminder",
    async (startsIn) => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const { eventId, bookingId } = await dueBooking(db, f)
        await moveStart(db, eventId, startsIn)

        expect(await runJob(db)).toBe(0)
        expect(await reminders(db, bookingId)).toEqual([])
      })
    }
  )

  it("the boundary now() = starts_at - lead (the session in exactly 24 hours): one reminder", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { eventId, bookingId } = await dueBooking(db, f)
      await moveStart(db, eventId, "24 hours")

      expect(await runJob(db)).toBe(1)
      expect(await reminders(db, bookingId)).toHaveLength(1)
    })
  })

  it("the boundary confirmed_at = starts_at - lead (confirmed 1 hour ago, the session in 23 hours): no reminder", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { bookingId } = await dueBooking(db, f)
      await backdate(db, bookingId, "1 hour")

      expect(await runJob(db)).toBe(0)
      expect(await reminders(db, bookingId)).toEqual([])
    })
  })

  it("a cancelled session: no reminder", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { eventId, bookingId } = await dueBooking(db, f)
      await db.query(
        "update public.events set status = 'cancelled' where id = $1",
        [eventId]
      )

      expect(await runJob(db)).toBe(0)
      expect(await reminders(db, bookingId)).toEqual([])
    })
  })

  it("every field: the reminder template edited to {concept} {date} {time} renders all three in the real job", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const { rows } = await db.query(
        "select version, allowed_vars from public.notification_templates where type = 'reminder'"
      )
      expect(rows[0].allowed_vars).toEqual(["date", "time", "concept"])
      const updated = await as(db, f.admin, async () => {
        const { rows: r } = await db.query(TEMPLATE, [
          "reminder",
          "T {concept}|{date}|{time}",
          "B {concept}|{date}|{time}",
          rows[0].version,
          randomUUID(),
        ])
        return r[0].r
      })
      expect(updated).toMatchObject({ type: "reminder" })

      const { eventId, bookingId } = await dueBooking(db, f)
      expect(await runJob(db)).toBe(1)

      const { date, time } = (
        await db.query(
          `select to_char(starts_at at time zone 'Asia/Jerusalem', 'DD.MM') as date,
             to_char(starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') as time
           from public.events where id = $1`,
          [eventId]
        )
      ).rows[0]
      expect(await reminders(db, bookingId)).toMatchObject([
        {
          title: `T ${f.mothersName}|${date}|${time}`,
          body: `B ${f.mothersName}|${date}|${time}`,
        },
      ])
    })
  })

  it("the job has no grant: authenticated cannot run it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      expect(await queryError(db, JOB)).toMatchObject({ code: "42501" })
      await db.query("reset role")
    })
  })

  it("cron.job has reminders every minute", async () => {
    const rows = await sql<{ schedule: string; command: string }>(
      "select schedule, command from cron.job where jobname = 'reminders'"
    )
    expect(rows).toEqual([
      { schedule: "* * * * *", command: "select private.job_reminders()" },
    ])
  })
})

describe("a locked booking", { timeout: 30_000 }, () => {
  // A due booking (committed): a fictitious profile without an Auth user, a
  // published session in 23 hours and a booking confirmed 3 days ago,
  // inserted directly as the owner. The real reminders cron also runs on the
  // dev database, so it may remind the booking before the lock; then the
  // attempt is repeated with a new booking.
  async function insertDueBooking(): Promise<string> {
    const customerId = randomUUID()
    const eventId = randomUUID()
    const bookingId = randomUUID()
    onCleanup(async () => {
      const client = await getPool().connect()
      try {
        await client.query("begin")
        await client.query(
          "delete from public.notifications where recipient_id = $1",
          [customerId]
        )
        await client.query("delete from public.bookings where id = $1", [
          bookingId,
        ])
        await client.query("delete from public.events where id = $1", [eventId])
        await client.query("delete from public.profiles where id = $1", [
          customerId,
        ])
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    })

    const client = await getPool().connect()
    try {
      await client.query("begin")
      await client.query(
        `insert into public.profiles (id, full_name, activated_at)
         values ($1, $2, now())`,
        [customerId, testName("locked_customer")]
      )
      await client.query(
        `insert into public.events (
           id, concept_id, kind, starts_at, ends_at, capacity_adults,
           registration_closes_at, registration_close_overridden, status)
         select $1, c.id, 'regular', now() + interval '23 hours',
           now() + interval '25 hours', 12, now() + interval '22 hours', true,
           'published'
         from public.concepts c
         where c.theme_key = 'mothers' and c.archived_at is null
         limit 1`,
        [eventId]
      )
      await client.query(
        `insert into public.bookings (
           id, customer_id, event_id, party_size, booked_by, confirmed_at,
           policy_snapshot)
         values ($1, $2, $3, 1, 'admin', now() - interval '3 days',
           '{"cancel_window_hours": 48, "reminder_lead_hours": 24}')`,
        [bookingId, customerId, eventId]
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback").catch(() => {})
      throw error
    } finally {
      client.release()
    }
    return bookingId
  }

  it("a booking held by another transaction is skipped on this run and reminded on the next", async () => {
    let bookingId: string | null = null

    for (let attempt = 0; attempt < 3 && bookingId === null; attempt++) {
      const candidate = await insertDueBooking()
      const holder = await getPool().connect()
      try {
        // A cancellation in progress holds the booking.
        await holder.query("begin")
        await holder.query(
          "select id from public.bookings where id = $1 for update",
          [candidate]
        )
        const { rows } = await holder.query(
          "select 1 from public.notifications where type = 'reminder' and dedupe_key like '%:' || $1 || ':%'",
          [candidate]
        )
        if (rows.length > 0) {
          continue
        }
        bookingId = candidate

        await inRollback(async (db) => {
          await runJob(db)
          expect(await reminders(db, candidate)).toEqual([])
        })
      } finally {
        await holder.query("rollback").catch(() => {})
        holder.release()
      }
    }

    expect(bookingId).not.toBeNull()
    // The real cron may have reminded it since the lock was released; either
    // way the booking has exactly one reminder. The real cron may also hold
    // the booking at this instant (the job skips it), so up to 3 runs.
    let sent: unknown[] = []
    for (let run = 0; run < 3 && sent.length !== 1; run++) {
      if (run > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      sent = await inRollback(async (db) => {
        await runJob(db)
        return reminders(db, bookingId!)
      })
    }
    expect(sent).toHaveLength(1)
  })
})
