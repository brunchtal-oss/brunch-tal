// Story 3.14: the automatic extension of a card for every ended local week
// with no session it fits (private.job_auto_extend and
// private.week_has_eligible_session). One test per row of the spec's I/O
// matrix ("all vars" is in settings-and-templates.test.ts). Each test runs
// the job on its own cards (p_entitlement_ids) with weeks in 2099 and a
// fixed p_today; 2099-03-01 is a Sunday. Everything runs in inRollback,
// except the locked card, which needs a committed card.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  getPool,
  inRollback,
  onCleanup,
  sql,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const JOB = "select private.job_auto_extend($1::date, $2::uuid[]) as n"
const GET = "select public.admin_get_entitlement($1) as r"
const BOOK = "select public.book_session($1, $2) as r"

type Fixture = MoneyFixture & { mothers: string }

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  const { rows } = await db.query<{ id: string }>(
    "select id from public.concepts where archived_at is null order by name limit 1"
  )
  return { ...f, mothers: rows[0].id }
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

// A card of the fixture's product (4 entries, every day, regular), bound to
// customerId (null: a purchase not bound yet), moved to [validFrom,
// expiresOn].
async function card(
  db: Db,
  f: Fixture,
  validFrom: string,
  expiresOn: string,
  customerId: string | null = f.customerA
): Promise<string> {
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
  const { rows } = await db.query<{ id: string }>(
    "select id from public.entitlements where payment_id = $1",
    [r.payment_id]
  )
  await setDates(db, rows[0].id, validFrom, expiresOn)
  return rows[0].id
}

async function setDates(
  db: Db,
  id: string,
  validFrom: string,
  expiresOn: string
): Promise<void> {
  await db.query(
    "update public.entitlements set valid_from = $2, expires_on = $3 where id = $1",
    [id, validFrom, expiresOn]
  )
}

// A session at `time` local (default 10:00) on `day` (YYYY-MM-DD).
async function insertEvent(
  db: Db,
  f: Fixture,
  day: string,
  options: {
    kind?: "regular" | "couple"
    status?: string
    time?: string
  } = {}
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.events (
       concept_id, kind, starts_at, ends_at, capacity_adults,
       registration_closes_at, registration_close_overridden, status)
     select $1, $2, s.t, s.t + interval '2 hours', 12, s.t, true, $3
     from (select ($4::date + $5::time) at time zone 'Asia/Jerusalem' as t) s
     returning id`,
    [
      f.mothers,
      options.kind ?? "regular",
      options.status ?? "published",
      day,
      options.time ?? "10:00",
    ]
  )
  return rows[0].id
}

async function run(db: Db, today: string, ids: string[]): Promise<number> {
  const { rows } = await db.query(JOB, [today, ids])
  return rows[0].n
}

async function expiresOn(db: Db, id: string): Promise<string> {
  const { rows } = await db.query(
    "select expires_on::text as d from public.entitlements where id = $1",
    [id]
  )
  return rows[0].d
}

async function corrections(db: Db, id: string) {
  const { rows } = await db.query(
    `select id, field, old_value, new_value, reason, actor_id, actor_kind,
       week_start::text as week_start, related_event_id
     from public.entitlement_corrections
     where entitlement_id = $1
     order by week_start`,
    [id]
  )
  return rows
}

async function audits(db: Db, id: string) {
  const { rows } = await db.query(
    `select actor_id, actor_kind, entity_type, customer_id, event_id, before,
       after, reason
     from public.audit_log
     where action = 'job_auto_extend' and entity_id = $1
     order by created_at, id`,
    [id]
  )
  return rows
}

async function notifications(db: Db, customer: string) {
  const { rows } = await db.query(
    `select payload, target_path, dedupe_key
     from public.notifications
     where recipient_id = $1 and type = 'entitlement_auto_extended'
     order by created_at, id`,
    [customer]
  )
  return rows
}

const body = (expires: string, units: number) =>
  `לא היו בראנצ׳ים בשבוע שעבר ולכן הארכנו לך את תוקף הכרטיסייה!\nהכרטיסייה שלך בתוקף עד ${expires}, ונשארו בה ${units} כניסות פנויות.`

describe("job_auto_extend", { timeout: 60_000 }, () => {
  it("an empty ended week: +7, one correction with its week, audit, one notification; the admin page shows it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05")

      expect(await run(db, "2099-03-08", [id])).toBe(1)
      expect(await expiresOn(db, id)).toBe("2099-03-12")

      const corr = await corrections(db, id)
      expect(corr).toEqual([
        {
          id: expect.any(String),
          field: "expires_on",
          old_value: "2099-03-05",
          new_value: "2099-03-12",
          reason: null,
          actor_id: null,
          actor_kind: "system",
          week_start: "2099-03-01",
          related_event_id: null,
        },
      ])

      const log = await audits(db, id)
      expect(log).toHaveLength(1)
      expect(log[0]).toMatchObject({
        actor_id: null,
        actor_kind: "system",
        entity_type: "entitlements",
        customer_id: f.customerA,
        event_id: null,
        before: { expires_on: "2099-03-05" },
        after: { expires_on: "2099-03-12" },
        reason: null,
      })

      const sent = await notifications(db, f.customerA)
      expect(sent).toEqual([
        {
          payload: {
            title: "הכרטיסייה הוארכה",
            body: body("12.03", 4),
            template_version: 2,
          },
          target_path: `/me/purchases/${id}`,
          dedupe_key: `entitlement_auto_extended:${f.customerA}:${corr[0].id}`,
        },
      ])
      const { rows: jobs } = await db.query(
        "select 1 from public.notification_jobs j join public.notifications n on n.id = j.notification_id where n.recipient_id = $1 and n.type = 'entitlement_auto_extended'",
        [f.customerA]
      )
      expect(jobs).toHaveLength(1)

      const page = await as(db, f.admin, async () => {
        const { rows } = await db.query(GET, [id])
        return rows[0].r
      })
      expect(page).toMatchObject({
        expires_on: "2099-03-12",
        is_extended: true,
      })
      expect(page.corrections[0]).toMatchObject({
        field: "expires_on",
        actor_kind: "system",
        old_value: "2099-03-05",
        new_value: "2099-03-12",
        week_start: "2099-03-01",
      })
    })
  })

  it("rerun: the second call extends nothing and sends nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05")
      expect(await run(db, "2099-03-08", [id])).toBe(1)
      expect(await run(db, "2099-03-08", [id])).toBe(0)
      expect(await expiresOn(db, id)).toBe("2099-03-12")
      expect(await corrections(db, id)).toHaveLength(1)
      expect(await audits(db, id)).toHaveLength(1)
      expect(await notifications(db, f.customerA)).toHaveLength(1)
    })
  })

  it("only a couple session that week: a regular card is extended", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05")
      await insertEvent(db, f, "2099-03-03", { kind: "couple" })
      expect(await run(db, "2099-03-08", [id])).toBe(1)
    })
  })

  it("the only session was cancelled: extended", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05")
      await insertEvent(db, f, "2099-03-03", { status: "cancelled" })
      expect(await run(db, "2099-03-08", [id])).toBe(1)
    })
  })

  it("a fitting session, published (full or past) or completed: no extension", async () => {
    for (const status of ["published", "completed"]) {
      await inRollback(async (db) => {
        const f = await seed(db)
        const id = await card(db, f, "2099-03-01", "2099-03-05")
        await insertEvent(db, f, "2099-03-03", { status })
        expect(await run(db, "2099-03-08", [id]), status).toBe(0)
        expect(await expiresOn(db, id)).toBe("2099-03-05")
        expect(await corrections(db, id)).toEqual([])
        expect(await notifications(db, f.customerA)).toEqual([])
      })
    }
  })

  it("only a draft session: extended", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05")
      await insertEvent(db, f, "2099-03-03", { status: "draft" })
      expect(await run(db, "2099-03-08", [id])).toBe(1)
    })
  })

  it("weekday: a Sunday-only card and a Tuesday session: extended", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05")
      await db.query(
        "update public.entitlements set allowed_weekdays = '{0}' where id = $1",
        [id]
      )
      await insertEvent(db, f, "2099-03-03")
      expect(await run(db, "2099-03-08", [id])).toBe(1)
      // A Sunday session in the next ended week fits: no second extension.
      await insertEvent(db, f, "2099-03-08")
      expect(await run(db, "2099-03-15", [id])).toBe(0)
    })
  })

  it("the expiry inside the empty week (Tuesday): extended past it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-02-22", "2099-03-03")
      await insertEvent(db, f, "2099-02-24")
      expect(await run(db, "2099-03-08", [id])).toBe(1)
      expect(await expiresOn(db, id)).toBe("2099-03-10")
      expect((await corrections(db, id))[0].week_start).toBe("2099-03-01")
    })
  })

  it("an added week that also ended empty is extended in the same run, with one notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-03")
      expect(await run(db, "2099-03-15", [id])).toBe(2)
      expect(await expiresOn(db, id)).toBe("2099-03-17")
      expect(
        (await corrections(db, id)).map((c) => [
          c.week_start,
          c.old_value,
          c.new_value,
        ])
      ).toEqual([
        ["2099-03-01", "2099-03-03", "2099-03-10"],
        ["2099-03-08", "2099-03-10", "2099-03-17"],
      ])
      expect(await audits(db, id)).toHaveLength(2)
      const sent = await notifications(db, f.customerA)
      expect(sent).toHaveLength(1)
      expect(sent[0].payload.body).toBe(body("17.03", 4))
      const last = (await corrections(db, id))[1].id
      expect(sent[0].dedupe_key).toBe(
        `entitlement_auto_extended:${f.customerA}:${last}`
      )
    })
  })

  it("a fitting session that is full and closed for registration: no extension", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05")
      const { rows } = await db.query<{ id: string }>(
        `insert into public.events (
           concept_id, kind, starts_at, ends_at, capacity_adults,
           registration_closes_at, registration_close_overridden, status)
         select $1, 'regular', s.t, s.t + interval '2 hours', 1,
           now() - interval '1 day', true, 'published'
         from (select ('2099-03-03'::date + time '10:00') at time zone 'Asia/Jerusalem' as t) s
         returning id`,
        [f.mothers]
      )
      await db.query(
        `insert into public.bookings (
           customer_id, event_id, party_size, status, booked_by, policy_snapshot)
         values ($1, $2, 1, 'confirmed', 'admin',
           '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb)`,
        [f.customerB, rows[0].id]
      )
      expect(await run(db, "2099-03-08", [id])).toBe(0)
      expect(await expiresOn(db, id)).toBe("2099-03-05")
      expect(await corrections(db, id)).toEqual([])
    })
  })

  it("several cards in one run: only the card with an empty week is extended and told", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // Sunday only: the Tuesday session does not fit it.
      const extended = await card(db, f, "2099-03-01", "2099-03-05")
      await db.query(
        "update public.entitlements set allowed_weekdays = '{0}' where id = $1",
        [extended]
      )
      // Every day: the Tuesday session fits it.
      const kept = await card(db, f, "2099-03-01", "2099-03-05", f.customerB)
      await insertEvent(db, f, "2099-03-03")

      expect(await run(db, "2099-03-08", [extended, kept])).toBe(1)
      expect(await expiresOn(db, extended)).toBe("2099-03-12")
      expect(await expiresOn(db, kept)).toBe("2099-03-05")
      expect(await corrections(db, kept)).toEqual([])

      const [correction] = await corrections(db, extended)
      const sent = await notifications(db, f.customerA)
      expect(sent).toHaveLength(1)
      expect(sent[0].target_path).toBe(`/me/purchases/${extended}`)
      expect(sent[0].dedupe_key).toBe(
        `entitlement_auto_extended:${f.customerA}:${correction.id}`
      )
      expect(await notifications(db, f.customerB)).toEqual([])
    })
  })

  it("the local week's edges: Saturday 23:30 before it does not count, Sunday 00:30 in it does", async () => {
    // The week of Sunday 2099-03-08.
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-08", "2099-03-12")
      await insertEvent(db, f, "2099-03-07", { time: "23:30" })
      expect(await run(db, "2099-03-15", [id])).toBe(1)
    })
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-08", "2099-03-12")
      await insertEvent(db, f, "2099-03-08", { time: "00:30" })
      expect(await run(db, "2099-03-15", [id])).toBe(0)
    })
  })

  it("the week of the clock change (Friday 2099-03-27): Saturday 23:30 in it counts, Sunday 00:30 after it does not", async () => {
    // The week of Sunday 2099-03-22; summer time starts on Friday 03-27.
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-22", "2099-03-26")
      await insertEvent(db, f, "2099-03-28", { time: "23:30" })
      expect(await run(db, "2099-03-29", [id])).toBe(0)
    })
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-22", "2099-03-26")
      await insertEvent(db, f, "2099-03-29", { time: "00:30" })
      expect(await run(db, "2099-03-29", [id])).toBe(1)
      expect(await expiresOn(db, id)).toBe("2099-04-02")
    })
  })

  it("the current week has not ended: nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05")
      expect(await run(db, "2099-03-07", [id])).toBe(0)
      expect(await expiresOn(db, id)).toBe("2099-03-05")
    })
  })

  it("a pinned purchase and a revoked card: nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const pinned = await card(db, f, "2099-03-01", "2099-03-05")
      const eventId = await insertEvent(db, f, "2099-03-05", {
        status: "cancelled",
      })
      await db.query(
        `update public.entitlements
         set pinned_event_id = $2,
           eligibility_snapshot = eligibility_snapshot || '{"validity_mode": "session"}'::jsonb
         where id = $1`,
        [pinned, eventId]
      )
      const revoked = await card(db, f, "2099-03-01", "2099-03-05")
      await db.query(
        "update public.entitlements set status = 'revoked' where id = $1",
        [revoked]
      )
      expect(await run(db, "2099-03-08", [pinned, revoked])).toBe(0)
      expect(await corrections(db, pinned)).toEqual([])
      expect(await corrections(db, revoked)).toEqual([])
    })
  })

  it("a finished card (nothing available or reserved): nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05")
      await db.query(
        "insert into public.entitlement_movements (entitlement_id, action, units) values ($1, 'adjust', -4)",
        [id]
      )
      expect(await run(db, "2099-03-08", [id])).toBe(0)
      expect(await corrections(db, id)).toEqual([])
    })
  })

  it("nothing available but one reserved entry: extended", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // Booked while the card is valid now, then moved to 2099.
      const id = await card(db, f, f.today, "2099-12-31")
      const { rows } = await db.query(
        `insert into public.events (
           concept_id, kind, starts_at, ends_at, capacity_adults,
           registration_closes_at, registration_close_overridden, status)
         select $1, 'regular', s.t, s.t + interval '2 hours', 12, s.t, true, 'published'
         from (select ((now() at time zone 'Asia/Jerusalem')::date + 5 + time '10:00')
           at time zone 'Asia/Jerusalem' as t) s
         returning id`,
        [f.mothers]
      )
      await as(db, f.customerA, () =>
        db.query(BOOK, [rows[0].id, randomUUID()])
      )
      await db.query(
        "insert into public.entitlement_movements (entitlement_id, action, units) values ($1, 'adjust', -3)",
        [id]
      )
      await setDates(db, id, "2099-03-01", "2099-03-05")
      const { rows: balance } = await db.query(
        "select available, reserved from public.entitlement_balances where entitlement_id = $1",
        [id]
      )
      expect(balance[0]).toEqual({ available: 0, reserved: 1 })

      expect(await run(db, "2099-03-08", [id])).toBe(1)
      const sent = await notifications(db, f.customerA)
      expect(sent[0].payload.body).toBe(body("12.03", 0))
    })
  })

  it("a partial first week: the card starts Thursday, the week's only session was on Monday: no extension", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-05", "2099-03-20")
      await insertEvent(db, f, "2099-03-02")
      expect(await run(db, "2099-03-08", [id])).toBe(0)
      expect(await expiresOn(db, id)).toBe("2099-03-20")
    })
  })

  it("a card not bound yet: extended, no notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await card(db, f, "2099-03-01", "2099-03-05", null)
      expect(await run(db, "2099-03-08", [id])).toBe(1)
      expect(await expiresOn(db, id)).toBe("2099-03-12")
      expect(await audits(db, id)).toHaveLength(1)
      const { rows } = await db.query(
        `select n.id from public.notifications n
         where n.type = 'entitlement_auto_extended' and n.target_path = $1`,
        [`/me/purchases/${id}`]
      )
      expect(rows).toEqual([])
    })
  })
})

describe("a locked card", { timeout: 30_000 }, () => {
  it("a card held by another transaction is skipped on this run and extended on the next", async () => {
    const customer = randomUUID()
    const product = randomUUID()
    const method = randomUUID()
    const entitlement = randomUUID()

    onCleanup(async () => {
      const client = await getPool().connect()
      try {
        await client.query("begin")
        await client.query(
          "delete from public.notifications where recipient_id = $1",
          [customer]
        )
        await client.query(
          "delete from public.audit_log where customer_id = $1 or entity_id = $2",
          [customer, entitlement]
        )
        await client.query(
          "delete from public.entitlement_corrections where entitlement_id = $1",
          [entitlement]
        )
        await client.query(
          "alter table public.entitlement_movements disable trigger entitlement_movements_no_update_delete"
        )
        await client.query(
          "delete from public.entitlement_movements where entitlement_id = $1",
          [entitlement]
        )
        await client.query(
          "alter table public.entitlement_movements enable trigger entitlement_movements_no_update_delete"
        )
        await client.query("delete from public.entitlements where id = $1", [
          entitlement,
        ])
        await client.query(
          "delete from public.payments where customer_id = $1",
          [customer]
        )
        await client.query("delete from public.products where id = $1", [
          product,
        ])
        await client.query("delete from public.payment_methods where id = $1", [
          method,
        ])
        await client.query("delete from public.profiles where id = $1", [
          customer,
        ])
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    })

    await sql(
      "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
      [customer, testName("auto_extend_locked")]
    )
    await sql(
      `insert into public.products (
         id, name, type, price_agorot, units, validity_mode, validity_days,
         allowed_weekdays, eligible_event_kind, party_size)
       values ($1, $2, 'card', 47200, 4, 'days', 49, null, 'regular', 1)`,
      [product, testName("auto_extend_card")]
    )
    await sql(
      "insert into public.payment_methods (id, name, sort_order) values ($1, $2, 907)",
      [method, testName("auto_extend_method")]
    )
    const [payment] = await sql<{ id: string }>(
      `insert into public.payments (
         customer_id, product_id, source, recorded_by, payment_method_id,
         amount_agorot, paid_on, product_snapshot)
       values ($1, $2, 'manual', $1, $3, 47200,
         (now() at time zone 'Asia/Jerusalem')::date, '{}'::jsonb)
       returning id`,
      [customer, product, method]
    )
    await sql(
      `insert into public.entitlements (
         id, customer_id, payment_id, kind, original_units, valid_from,
         expires_on, eligibility_snapshot, allowed_weekdays, eligible_event_kind)
       values ($1, $2, $3, 'card', 4, '2099-03-01', '2099-03-05',
         '{"validity_mode": "days"}'::jsonb, null, 'regular')`,
      [entitlement, customer, payment.id]
    )
    await sql(
      "insert into public.entitlement_movements (entitlement_id, action, units) values ($1, 'grant', 4)",
      [entitlement]
    )

    const holder = await getPool().connect()
    try {
      await holder.query("begin")
      await holder.query(
        "select 1 from public.entitlements where id = $1 for update",
        [entitlement]
      )
      await inRollback(async (db) => {
        expect(await run(db, "2099-03-08", [entitlement])).toBe(0)
        expect(await expiresOn(db, entitlement)).toBe("2099-03-05")
        expect(await corrections(db, entitlement)).toEqual([])
      })
    } finally {
      await holder.query("rollback").catch(() => {})
      holder.release()
    }

    await inRollback(async (db) => {
      expect(await run(db, "2099-03-08", [entitlement])).toBe(1)
      expect(await expiresOn(db, entitlement)).toBe("2099-03-12")
    })
  })
})
