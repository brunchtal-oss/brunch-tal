// Story 5.11: marketing reminders for Tal. private.job_marketing_reminders
// (one test per row of the spec's I/O matrix), the texts' RPCs
// (admin_add_marketing_reminder_text, admin_update_marketing_reminder_text),
// the texts' and slots' access, the cron.job row and the job_intervals row.
// The schedule's validation is in settings-and-templates.test.ts.
//
// Everything runs in inRollback. Each test sets its own schedule, turns the
// existing texts off and adds its own (testName), and clears the slot log
// (rolled back), so a real run of the job never interferes. p_now is a
// fixed local time far from today (2030), except the DST rows, which use
// the spec's dates. The job notifies every admin, so checks look only at
// this test's admin.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"
import { seedMoney, type MoneyFixture } from "./support/money"

const ADD = "select public.admin_add_marketing_reminder_text($1, $2) as r"
const UPDATE =
  "select public.admin_update_marketing_reminder_text($1, $2, $3, $4, $5) as r"

// 2030-01-06 is a Sunday, 2030-01-07 a Monday.
const SUNDAY = "2030-01-06"
const MONDAY = "2030-01-07"

type Fixture = MoneyFixture & { a: string; b: string }

async function seed(
  db: Db,
  schedule: unknown = [
    { weekday: 0, time: "09:00" },
    { weekday: 1, time: "20:00" },
  ]
): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    "update public.business_settings set marketing_reminder_schedule = $1::jsonb",
    [JSON.stringify(schedule)]
  )
  await db.query("update public.marketing_reminder_texts set active = false")
  await db.query("delete from private.marketing_reminder_slots")
  const { rows } = await db.query<{ id: string }>(
    `insert into public.marketing_reminder_texts (body, sort_order)
     values ($1, 901), ($2, 902)
     returning id`,
    [testName("text_a"), testName("text_b")]
  )
  return { ...f, a: rows[0].id, b: rows[1].id }
}

// Runs the job at a local Jerusalem time ("2030-01-06 09:01").
async function runAt(db: Db, local: string): Promise<number> {
  const { rows } = await db.query(
    "select private.job_marketing_reminders(($1::timestamp at time zone 'Asia/Jerusalem')) as n",
    [local]
  )
  return rows[0].n
}

// Runs the job at a UTC instant.
async function runAtUtc(db: Db, instant: string): Promise<number> {
  const { rows } = await db.query(
    "select private.job_marketing_reminders($1::timestamptz) as n",
    [instant]
  )
  return rows[0].n
}

// This admin's marketing reminders, oldest first.
async function reminders(db: Db, f: Fixture) {
  const { rows } = await db.query(
    `select n.id, n.dedupe_key, n.payload ->> 'body' as body,
       n.payload ->> 'title' as title, n.target_path, n.recipient_kind,
       exists (select 1 from public.notification_jobs j where j.notification_id = n.id) as has_job
     from public.notifications n
     where n.recipient_id = $1 and n.type = 'marketing_reminder'
     order by n.created_at, n.dedupe_key`,
    [f.admin]
  )
  return rows
}

async function lastSent(db: Db, id: string): Promise<string | null> {
  const { rows } = await db.query(
    "select last_sent_at::text as t from public.marketing_reminder_texts where id = $1",
    [id]
  )
  return rows[0].t
}

async function textBody(db: Db, id: string): Promise<string> {
  const { rows } = await db.query(
    "select body from public.marketing_reminder_texts where id = $1",
    [id]
  )
  return rows[0].body
}

async function slots(db: Db): Promise<string[]> {
  const { rows } = await db.query(
    "select slot_key from private.marketing_reminder_slots order by slot_key"
  )
  return rows.map((r) => r.slot_key)
}

async function as<T>(db: Db, user: string, fn: () => Promise<T>): Promise<T> {
  await asAuthenticated(db, user)
  try {
    return await fn()
  } finally {
    await db.query("reset role").catch(() => {})
  }
}

async function textRow(db: Db, id: string) {
  const { rows } = await db.query(
    "select id, body, active, sort_order, version, last_sent_at from public.marketing_reminder_texts where id = $1",
    [id]
  )
  return rows[0]
}

async function auditRows(db: Db, action: string, entityId: string) {
  const { rows } = await db.query(
    "select before, after from public.audit_log where action = $1 and entity_id = $2 order by created_at",
    [action, entityId]
  )
  return rows
}

describe("job_marketing_reminders", { timeout: 30_000 }, () => {
  it("slot reached: one reminder per admin with the oldest text; its last_sent_at = p_now", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(await runAt(db, `${SUNDAY} 09:01`)).toBeGreaterThanOrEqual(1)
      const rows = await reminders(db, f)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        dedupe_key: `marketing_reminder:${f.admin}:${SUNDAY} 09:00`,
        body: await textBody(db, f.a),
        title: "תזכורת שיווק",
        target_path: "/admin",
        recipient_kind: "admin",
        has_job: true,
      })
      const { rows: now } = await db.query(
        "select (($1::timestamp at time zone 'Asia/Jerusalem'))::text as t",
        [`${SUNDAY} 09:01`]
      )
      expect(await lastSent(db, f.a)).toBe(now[0].t)
      expect(await lastSent(db, f.b)).toBeNull()
      expect(await slots(db)).toEqual([`${SUNDAY} 09:00`])
    })
  })

  it("rerun of the same slot: nothing new, no rotation", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await runAt(db, `${SUNDAY} 09:01`)
      const sent = await lastSent(db, f.a)
      expect(await runAt(db, `${SUNDAY} 09:01`)).toBe(0)
      expect(await runAt(db, `${SUNDAY} 09:40`)).toBe(0)
      expect(await reminders(db, f)).toHaveLength(1)
      expect(await lastSent(db, f.a)).toBe(sent)
      expect(await lastSent(db, f.b)).toBeNull()
    })
  })

  it("a day's time moved after its slot fired: nothing new that day", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await runAt(db, `${SUNDAY} 09:01`)
      await db.query(
        "update public.business_settings set marketing_reminder_schedule = $1::jsonb",
        [JSON.stringify([{ weekday: 0, time: "09:20" }])]
      )
      expect(await runAt(db, `${SUNDAY} 09:21`)).toBe(0)
      expect(await reminders(db, f)).toHaveLength(1)
      expect(await lastSent(db, f.b)).toBeNull()
      expect(await slots(db)).toEqual([`${SUNDAY} 09:00`])
    })
  })

  it("next slot: the other text", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await runAt(db, `${SUNDAY} 09:01`)
      await runAt(db, `${MONDAY} 20:03`)
      const rows = await reminders(db, f)
      expect(rows.map((r) => r.body)).toEqual([
        await textBody(db, f.a),
        await textBody(db, f.b),
      ])
      expect(rows[1].dedupe_key).toBe(
        `marketing_reminder:${f.admin}:${MONDAY} 20:00`
      )
      // Then the first again (sent longest ago).
      await db.query(
        "update public.business_settings set marketing_reminder_schedule = $1::jsonb",
        [JSON.stringify([{ weekday: 2, time: "09:00" }])]
      )
      await runAt(db, "2030-01-08 09:00")
      expect((await reminders(db, f))[2].body).toBe(await textBody(db, f.a))
    })
  })

  it("one active text: the same text at both slots", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        "update public.marketing_reminder_texts set active = false where id = $1",
        [f.b]
      )
      await runAt(db, `${SUNDAY} 09:01`)
      await runAt(db, `${MONDAY} 20:01`)
      const body = await textBody(db, f.a)
      expect((await reminders(db, f)).map((r) => r.body)).toEqual([body, body])
    })
  })

  it("no active text: nothing sent, the slot not recorded; a text turned on within the hour still sends", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        "update public.marketing_reminder_texts set active = false where id in ($1, $2)",
        [f.a, f.b]
      )
      expect(await runAt(db, `${SUNDAY} 09:01`)).toBe(0)
      expect(await reminders(db, f)).toHaveLength(0)
      expect(await slots(db)).toEqual([])

      await db.query(
        "update public.marketing_reminder_texts set active = true where id = $1",
        [f.b]
      )
      expect(await runAt(db, `${SUNDAY} 09:45`)).toBeGreaterThanOrEqual(1)
      const rows = await reminders(db, f)
      expect(rows).toHaveLength(1)
      expect(rows[0].body).toBe(await textBody(db, f.b))
    })
  })

  it("before the slot, or more than an hour late: nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(await runAt(db, `${SUNDAY} 08:59`)).toBe(0)
      expect(await runAt(db, `${SUNDAY} 10:00`)).toBe(0)
      expect(await runAt(db, `${SUNDAY} 10:30`)).toBe(0)
      expect(await reminders(db, f)).toHaveLength(0)
      expect(await lastSent(db, f.a)).toBeNull()
      // A missed slot is never sent late, even at the next run.
      expect(await runAt(db, `${MONDAY} 08:00`)).toBe(0)
    })
  })

  it("only the latest slot within the hour; yesterday's late slot counts after midnight", async () => {
    await inRollback(async (db) => {
      const f = await seed(db, [
        { weekday: 6, time: "23:40" },
        { weekday: 0, time: "00:10" },
      ])
      // 2030-01-05 is a Saturday.
      expect(await runAt(db, `${SUNDAY} 00:05`)).toBeGreaterThanOrEqual(1)
      expect((await reminders(db, f))[0].dedupe_key).toBe(
        `marketing_reminder:${f.admin}:2030-01-05 23:40`
      )
      // 00:15: both slots are within the hour; only the latest is taken.
      expect(await runAt(db, `${SUNDAY} 00:15`)).toBeGreaterThanOrEqual(1)
      expect(await slots(db)).toEqual(["2030-01-05 23:40", `${SUNDAY} 00:10`])
    })
  })

  it("DST: Sunday 09:00 fires at 07:00 UTC in winter (IST) and at 06:00 UTC in summer (IDT)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db, [{ weekday: 0, time: "09:00" }])
      expect(await runAtUtc(db, "2026-10-25T06:59:00Z")).toBe(0)
      expect(await runAtUtc(db, "2026-10-25T07:00:00Z")).toBeGreaterThanOrEqual(
        1
      )
      expect(await runAtUtc(db, "2026-03-29T05:59:00Z")).toBe(0)
      expect(await runAtUtc(db, "2026-03-29T06:00:00Z")).toBeGreaterThanOrEqual(
        1
      )
      expect((await reminders(db, f)).map((r) => r.dedupe_key)).toEqual(
        expect.arrayContaining([
          `marketing_reminder:${f.admin}:2026-10-25 09:00`,
          `marketing_reminder:${f.admin}:2026-03-29 09:00`,
        ])
      )
      expect(await reminders(db, f)).toHaveLength(2)
    })
  })

  it("empty schedule: nothing ever", async () => {
    await inRollback(async (db) => {
      const f = await seed(db, [])
      for (const time of ["00:00", "09:00", "09:01", "20:00", "23:59"]) {
        expect(await runAt(db, `${SUNDAY} ${time}`), time).toBe(0)
      }
      expect(await reminders(db, f)).toHaveLength(0)
    })
  })

  it("deletes slot rows older than 30 days", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await db.query(
        `insert into private.marketing_reminder_slots (slot_key, text_id, created_at)
         values ('2029-01-01 09:00', $1, now() - interval '31 days'),
                ('2029-01-02 09:00', $1, now() - interval '29 days')`,
        [f.a]
      )
      await runAt(db, `${SUNDAY} 08:00`)
      expect(await slots(db)).toEqual(["2029-01-02 09:00"])
    })
  })
})

describe("the texts' RPCs", { timeout: 30_000 }, () => {
  it("add: trimmed, at the end, active, audited; the same key returns the same result", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const key = randomUUID()
      const body = testName("new")
      const call = () =>
        as(db, f.admin, async () => {
          const { rows } = await db.query(ADD, [`\u00A0 \t${body}\n `, key])
          return rows[0].r
        })
      const first = await call()
      const second = await call()
      expect(second).toEqual(first)
      const { rows: max } = await db.query(
        "select max(sort_order) as m from public.marketing_reminder_texts"
      )
      expect(first).toMatchObject({
        body,
        active: true,
        sort_order: max[0].m,
        version: 1,
      })
      expect(first.sort_order).toBeGreaterThanOrEqual(903)
      const audit = await auditRows(
        db,
        "admin_add_marketing_reminder_text",
        first.text_id
      )
      expect(audit).toHaveLength(1)
      expect(audit[0].after).toMatchObject({ body })
    })
  })

  it.each([[""], [" \n\t\u00A0"], ["א".repeat(501)]])(
    "add refuses %j: INVALID_INPUT",
    async (body) => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const error = await as(db, f.admin, () =>
          queryError(db, ADD, [body, randomUUID()])
        )
        expect(error).toMatchObject({
          code: "P0001",
          message: "INVALID_INPUT",
        })
      })
    }
  )

  it("add accepts 500 characters", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const r = await as(db, f.admin, async () => {
        const { rows } = await db.query(ADD, ["א".repeat(500), randomUUID()])
        return rows[0].r
      })
      expect(r.body).toHaveLength(500)
    })
  })

  it("update: body and on/off, a new version, audited; the same values change nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const body = testName("edited")
      const r = await as(db, f.admin, async () => {
        const { rows } = await db.query(UPDATE, [
          f.a,
          ` ${body} `,
          false,
          1,
          randomUUID(),
        ])
        return rows[0].r
      })
      expect(r).toEqual({ text_id: f.a, body, active: false, version: 2 })
      expect(await textRow(db, f.a)).toMatchObject({
        body,
        active: false,
        version: 2,
      })
      const audit = await auditRows(
        db,
        "admin_update_marketing_reminder_text",
        f.a
      )
      expect(audit).toHaveLength(1)
      expect(audit[0].before).toMatchObject({ active: true })
      expect(audit[0].after).toMatchObject({ active: false, body })

      const same = await as(db, f.admin, async () => {
        const { rows } = await db.query(UPDATE, [
          f.a,
          body,
          false,
          2,
          randomUUID(),
        ])
        return rows[0].r
      })
      expect(same.version).toBe(2)
      expect(
        await auditRows(db, "admin_update_marketing_reminder_text", f.a)
      ).toHaveLength(1)
    })
  })

  it("update: changed since loaded: STALE_VERSION; unknown id: NOT_FOUND; empty body or null active: INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await as(db, f.admin, () =>
        db.query(UPDATE, [f.a, testName("v2"), true, 1, randomUUID()])
      )
      const stale = await as(db, f.admin, () =>
        queryError(db, UPDATE, [f.a, testName("v3"), true, 1, randomUUID()])
      )
      expect(stale).toMatchObject({ code: "P0001", message: "STALE_VERSION" })
      expect(await textRow(db, f.a)).toMatchObject({ version: 2 })

      const missing = await as(db, f.admin, () =>
        queryError(db, UPDATE, [randomUUID(), "x", true, 1, randomUUID()])
      )
      expect(missing).toMatchObject({ message: "NOT_FOUND" })

      for (const params of [
        [f.b, "  ", true, 1, randomUUID()],
        [f.b, "x", null, 1, randomUUID()],
      ]) {
        expect(
          await as(db, f.admin, () => queryError(db, UPDATE, params))
        ).toMatchObject({ message: "INVALID_INPUT" })
      }
    })
  })
})

describe("access", { timeout: 30_000 }, () => {
  it("a customer: no texts, no slots, NOT_AUTHORIZED on the RPCs, no admin notifications", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await runAt(db, `${SUNDAY} 09:01`)
      await as(db, f.customerA, async () => {
        const { rows } = await db.query(
          "select id from public.marketing_reminder_texts"
        )
        expect(rows).toEqual([])
        expect(
          await queryError(db, "select * from private.marketing_reminder_slots")
        ).toMatchObject({ code: "42501" })
        expect(
          await queryError(db, ADD, [testName("x"), randomUUID()])
        ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
        expect(
          await queryError(db, UPDATE, [f.a, "x", true, 1, randomUUID()])
        ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
        const { rows: notes } = await db.query(
          "select id from public.notifications where type = 'marketing_reminder'"
        )
        expect(notes).toEqual([])
        expect(
          await queryError(db, "select private.job_marketing_reminders(now())")
        ).toMatchObject({ code: "42501" })
      })
    })
  })

  it("the admin reads the texts and her own reminders", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await runAt(db, `${SUNDAY} 09:01`)
      await as(db, f.admin, async () => {
        const { rows } = await db.query(
          "select id from public.marketing_reminder_texts where id in ($1, $2)",
          [f.a, f.b]
        )
        expect(rows).toHaveLength(2)
        const { rows: notes } = await db.query(
          "select recipient_id from public.notifications where type = 'marketing_reminder'"
        )
        expect(notes.length).toBeGreaterThanOrEqual(1)
        expect(notes.every((n) => n.recipient_id === f.admin)).toBe(true)
      })
    })
  })
})

describe("seed and schedule", () => {
  it("the 20 seeded texts in order", async () => {
    const rows = await sql<{ n: number; first: string; last: string }>(
      `select count(*)::int as n,
         min(sort_order) as first, max(sort_order) as last
       from public.marketing_reminder_texts
       where sort_order between 1 and 20`
    )
    expect(rows[0]).toMatchObject({ n: 20, first: 1, last: 20 })
  })

  it("cron.job runs the job every 5 minutes, and job_intervals lists it", async () => {
    const jobs = await sql(
      "select schedule, command from cron.job where jobname = 'marketing_reminders'"
    )
    expect(jobs).toEqual([
      {
        schedule: "*/5 * * * *",
        command: "select private.job_marketing_reminders()",
      },
    ])
    const intervals = await sql(
      "select every::text as every from private.job_intervals() where jobname = 'marketing_reminders'"
    )
    expect(intervals).toEqual([{ every: "00:05:00" }])
  })
})
