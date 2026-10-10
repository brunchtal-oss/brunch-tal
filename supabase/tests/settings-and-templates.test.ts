// Story 4.7: admin_update_business_settings and
// admin_update_notification_template. One test per row of the spec's I/O
// matrix, then the template contract: every seeded template renders with
// private.template_sample_vars(allowed_vars), and for every type with a
// caller, a template that uses all its allowed fields renders in the real
// flow. Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { asAuthenticated, inRollback, testName, type Db } from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const SETTINGS =
  "select public.admin_update_business_settings($1::jsonb, $2, $3) as r"
const TEMPLATE =
  "select public.admin_update_notification_template($1, $2, $3, $4, $5) as r"
const CREATE_EVENT = "select public.admin_create_event($1::jsonb, $2) as r"
const BOOK = "select public.book_session($1, $2) as r"
const CANCEL = "select public.cancel_booking($1, $2) as r"

type Fixture = MoneyFixture & {
  single: string
  mothers: string
}

async function seed(db: Db): Promise<Fixture> {
  const f = await seedMoney(db)
  await db.query(
    `update public.business_settings
     set cancel_window_hours = 48, reminder_lead_hours = 24,
         default_capacity_regular = 12, default_capacity_couple = 14,
         credit_options_count = 2,
         default_session_start_time = '10:30',
         default_session_end_time = '14:30'`
  )
  // Only this test's sessions count as "the next sessions".
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
    await db.query("reset role")
  }
}

// The error of a statement inside a savepoint, with detail.field.
async function failure(db: Db, text: string, params: unknown[]) {
  await db.query("savepoint failure")
  try {
    await db.query(text, params)
    await db.query("release savepoint failure")
    return null
  } catch (error) {
    await db.query("rollback to savepoint failure")
    const { message, detail } = error as { message?: string; detail?: string }
    return {
      message,
      field: detail
        ? ((JSON.parse(detail) as { field?: string }).field ?? null)
        : null,
    }
  }
}

async function settingsVersion(db: Db): Promise<number> {
  const { rows } = await db.query(
    "select version from public.business_settings"
  )
  return rows[0].version
}

async function updateSettings(
  db: Db,
  f: Fixture,
  changes: Record<string, unknown>,
  key = randomUUID()
) {
  const version = await settingsVersion(db)
  return as(db, f.admin, async () => {
    const { rows } = await db.query(SETTINGS, [
      JSON.stringify(changes),
      version,
      key,
    ])
    return rows[0].r
  })
}

async function settingsFailure(
  db: Db,
  user: string,
  changes: unknown,
  version?: number
) {
  const v = version ?? (await settingsVersion(db))
  return as(db, user, () =>
    failure(db, SETTINGS, [JSON.stringify(changes), v, randomUUID()])
  )
}

async function template(db: Db, type: string) {
  const { rows } = await db.query(
    "select type, title, body, version, allowed_vars, body_mode from public.notification_templates where type = $1",
    [type]
  )
  return rows[0]
}

async function updateTemplate(
  db: Db,
  f: Fixture,
  type: string,
  title: string,
  body: string | null,
  key = randomUUID()
) {
  const { version } = await template(db, type)
  return as(db, f.admin, async () => {
    const { rows } = await db.query(TEMPLATE, [type, title, body, version, key])
    return rows[0].r
  })
}

async function templateFailure(
  db: Db,
  user: string,
  type: string,
  title: string,
  body: string | null,
  version?: number
) {
  const v = version ?? (await template(db, type))?.version ?? 1
  return as(db, user, () =>
    failure(db, TEMPLATE, [type, title, body, v, randomUUID()])
  )
}

async function auditRows(db: Db, action: string) {
  const { rows } = await db.query(
    `select entity_type, entity_id, before, after
     from public.audit_log where action = $1 and actor_id is not null
       and created_at = now()
     order by id`,
    [action]
  )
  return rows
}

// As the admin: a session created from the mothers concept on a date.
async function createEvent(db: Db, f: Fixture, date: string): Promise<string> {
  return as(db, f.admin, async () => {
    const { rows } = await db.query(CREATE_EVENT, [
      JSON.stringify({
        concept_id: f.mothers,
        date,
        start_time: "10:00",
        end_time: "12:00",
      }),
      randomUUID(),
    ])
    return rows[0].r.event_id
  })
}

// As the owner: a published session `dayOffset` days from today at 10:00
// Jerusalem time, open until it starts.
async function insertEvent(db: Db, f: Fixture, dayOffset: number) {
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
  return rows[0].id as string
}

async function grant(
  db: Db,
  f: Fixture,
  productId: string,
  options: { customerId?: string | null; eventId?: string | null } = {}
) {
  return as(db, f.admin, () =>
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
}

async function book(db: Db, customer: string, eventId: string) {
  return as(db, customer, async () => {
    const { rows } = await db.query(BOOK, [eventId, randomUUID()])
    return rows[0].r.booking_id as string
  })
}

// Rows of one transaction share created_at: ordered by template version.
async function notifications(db: Db, customer: string, type: string) {
  const { rows } = await db.query(
    `select payload ->> 'title' as title, payload ->> 'body' as body,
       (payload ->> 'template_version')::int as version
     from public.notifications
     where recipient_id = $1 and type = $2
     order by (payload ->> 'template_version')::int, id`,
    [customer, type]
  )
  return rows
}

describe("admin_update_business_settings", { timeout: 30_000 }, () => {
  it("a new capacity applies to sessions created after it; the audit holds old and new only", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const before = await createEvent(db, f, "2026-12-15")
      const r = await updateSettings(db, f, { default_capacity_regular: 14 })
      expect(r).toMatchObject({ default_capacity_regular: 14 })
      const after = await createEvent(db, f, "2026-12-16")

      const { rows } = await db.query(
        "select id, capacity_adults from public.events where id = any($1)",
        [[before, after]]
      )
      const capacity = Object.fromEntries(
        rows.map((row) => [row.id, row.capacity_adults])
      )
      expect(capacity[before]).toBe(12)
      expect(capacity[after]).toBe(14)
      expect(await auditRows(db, "admin_update_business_settings")).toEqual([
        {
          entity_type: "business_settings",
          entity_id: null,
          before: { default_capacity_regular: 12 },
          after: { default_capacity_regular: 14 },
        },
      ])
    })
  })

  it("cancel window and reminder: an existing booking keeps its snapshot, a new one takes the new values", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.card)
      const first = await insertEvent(db, f, 5)
      const second = await insertEvent(db, f, 6)
      const old = await book(db, f.customerA, first)

      await updateSettings(db, f, {
        cancel_window_hours: 24,
        reminder_lead_hours: 12,
      })
      const fresh = await book(db, f.customerA, second)

      const { rows } = await db.query(
        "select id, policy_snapshot from public.bookings where id = any($1)",
        [[old, fresh]]
      )
      const snapshot = Object.fromEntries(
        rows.map((row) => [row.id, row.policy_snapshot])
      )
      expect(snapshot[old]).toMatchObject({
        cancel_window_hours: 48,
        reminder_lead_hours: 24,
      })
      expect(snapshot[fresh]).toMatchObject({
        cancel_window_hours: 24,
        reminder_lead_hours: 12,
      })
    })
  })

  it("an old version: STALE_VERSION, nothing saved", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const version = await settingsVersion(db)
      await updateSettings(db, f, { cancel_window_hours: 24 })
      expect(
        await settingsFailure(db, f.admin, { cancel_window_hours: 12 }, version)
      ).toEqual({ message: "STALE_VERSION", field: null })
      const { rows } = await db.query(
        "select cancel_window_hours from public.business_settings"
      )
      expect(rows[0].cancel_window_hours).toBe(24)
    })
  })

  it("an old version with an invalid end time: STALE_VERSION first", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const version = await settingsVersion(db)
      await updateSettings(db, f, { cancel_window_hours: 24 })
      expect(
        await settingsFailure(
          db,
          f.admin,
          { default_session_end_time: "10:00" },
          version
        )
      ).toEqual({ message: "STALE_VERSION", field: null })
    })
  })

  it.each([
    [{ cancel_window_hours: -1 }, "cancel_window_hours"],
    [{ cancel_window_hours: 337 }, "cancel_window_hours"],
    [{ cancel_window_hours: 1.5 }, "cancel_window_hours"],
    [{ cancel_window_hours: "24" }, "cancel_window_hours"],
    [{ version: 9 }, "version"],
    [{ marketing_reminder_schedule: [] }, "marketing_reminder_schedule"],
    [{ credit_options_count: 0 }, "credit_options_count"],
    [{ default_validity_days: 731 }, "default_validity_days"],
    [{ registration_close_days_before: 8 }, "registration_close_days_before"],
    [
      { registration_close_local_time: "02:59" },
      "registration_close_local_time",
    ],
    [
      { registration_close_local_time: "25:00" },
      "registration_close_local_time",
    ],
    [{ default_prep_days: [] }, "default_prep_days"],
    [{ default_prep_days: [-7, 0] }, "default_prep_days"],
    [{ default_prep_days: [0, 0] }, "default_prep_days"],
    [{ default_prep_days: ["a"] }, "default_prep_days"],
    [
      {
        default_session_start_time: "10:30",
        default_session_end_time: "10:00",
      },
      "default_session_end_time",
    ],
    [{ default_session_end_time: "10:30" }, "default_session_end_time"],
  ])("refuses %o: INVALID_INPUT on %s", async (changes, field) => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const version = await settingsVersion(db)
      expect(await settingsFailure(db, f.admin, changes)).toEqual({
        message: "INVALID_INPUT",
        field,
      })
      expect(await settingsVersion(db)).toBe(version)
    })
  })

  it("saves prep days sorted and the edges of the ranges", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const r = await updateSettings(db, f, {
        default_prep_days: [0, -6, -2],
        registration_close_local_time: "03:00",
        cancel_window_hours: 0,
        last_places_threshold: 50,
      })
      expect(r).toMatchObject({
        default_prep_days: [-6, -2, 0],
        registration_close_local_time: "03:00:00",
        cancel_window_hours: 0,
        last_places_threshold: 50,
      })
    })
  })

  it("the same key returns the earlier result without a second audit; an unchanged value writes nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const key = randomUUID()
      const version = await settingsVersion(db)
      const call = () =>
        as(db, f.admin, async () => {
          const { rows } = await db.query(SETTINGS, [
            JSON.stringify({ inactivity_months: 4 }),
            version,
            key,
          ])
          return rows[0].r
        })
      const first = await call()
      const second = await call()
      expect(second).toEqual(first)
      expect(first.version).toBe(version + 1)
      expect(
        await auditRows(db, "admin_update_business_settings")
      ).toHaveLength(1)

      const same = await updateSettings(db, f, { inactivity_months: 4 })
      expect(same.version).toBe(version + 1)
      expect(
        await auditRows(db, "admin_update_business_settings")
      ).toHaveLength(1)
    })
  })

  it("a customer: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await settingsFailure(db, f.customerA, { cancel_window_hours: 24 })
      ).toMatchObject({ message: "NOT_AUTHORIZED" })
    })
  })
})

describe("admin_update_notification_template", { timeout: 30_000 }, () => {
  it("a valid template: a new version, new notifications use it, old ones stay", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await grant(db, f, f.card)
      const first = await insertEvent(db, f, 5)
      const second = await insertEvent(db, f, 6)
      await book(db, f.customerA, first)
      const old = await template(db, "booking_confirmed")

      const r = await updateTemplate(
        db,
        f,
        "booking_confirmed",
        "ההרשמה אושרה",
        "  נתראה ב{date} ב-{time}  "
      )
      expect(r).toEqual({
        type: "booking_confirmed",
        title: "ההרשמה אושרה",
        body: "נתראה ב{date} ב-{time}",
        version: old.version + 1,
      })
      await book(db, f.customerA, second)

      const rows = await notifications(db, f.customerA, "booking_confirmed")
      expect(rows).toHaveLength(2)
      expect(rows[0].body).toContain("בראנץ׳")
      expect(rows[0].version).toBe(old.version)
      expect(rows[1].body).toMatch(/^נתראה ב\d{2}\.\d{2} ב-10:00$/)
      expect(rows[1].version).toBe(old.version + 1)

      const audit = await auditRows(db, "admin_update_notification_template")
      expect(audit).toHaveLength(1)
      expect(audit[0].entity_type).toBe("notification_templates")
      expect(audit[0].before).toMatchObject({ body: old.body })
      expect(audit[0].after).toMatchObject({
        type: "booking_confirmed",
        body: "נתראה ב{date} ב-{time}",
        version: old.version + 1,
        updated_by: f.admin,
      })
    })
  })

  it("a field the type does not pass: TEMPLATE_INVALID on the body", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const old = await template(db, "booking_cancelled")
      expect(
        await templateFailure(
          db,
          f.admin,
          "booking_cancelled",
          old.title,
          "בתוקף עד {expires_on}"
        )
      ).toEqual({ message: "TEMPLATE_INVALID", field: "body" })
      expect(await template(db, "booking_cancelled")).toEqual(old)
    })
  })

  it.each(["נתראה {date", "}", "{}", "{a{date}"])(
    "unbalanced braces %s: TEMPLATE_INVALID",
    async (text) => {
      await inRollback(async (db) => {
        const f = await seed(db)
        const old = await template(db, "reminder")
        expect(
          await templateFailure(db, f.admin, "reminder", text, old.body)
        ).toEqual({ message: "TEMPLATE_INVALID", field: "title" })
        expect(
          await templateFailure(db, f.admin, "reminder", old.title, text)
        ).toEqual({ message: "TEMPLATE_INVALID", field: "body" })
      })
    }
  )

  it("an override type: a body is refused, a title alone is saved", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await templateFailure(db, f.admin, "broadcast", "הודעה מטל", "גוף")
      ).toEqual({ message: "INVALID_INPUT", field: "body" })
      const r = await updateTemplate(db, f, "broadcast", "הודעה חדשה", null)
      expect(r).toMatchObject({ title: "הודעה חדשה", body: null })
    })
  })

  it.each([
    ["template", "reminder", "", "{date}", "title"],
    ["template", "reminder", "x".repeat(201), "{date}", "title"],
    ["template", "reminder", "x", null, "body"],
    ["template", "reminder", "x", "   ", "body"],
    ["template", "reminder", "x", "y".repeat(1001), "body"],
    ["type", "no_such_type", "x", "y", "type"],
  ])(
    "a %s problem (%s): INVALID_INPUT on %s",
    async (_, type, title, body, field) => {
      await inRollback(async (db) => {
        const f = await seed(db)
        expect(
          await templateFailure(db, f.admin, type, title, body, 1)
        ).toEqual({ message: "INVALID_INPUT", field })
      })
    }
  )

  it("an old version: STALE_VERSION; push, mode and allowed fields never change", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const old = await template(db, "reminder")
      await updateTemplate(db, f, "reminder", "תזכורת", "{date} {time}")
      expect(
        await templateFailure(
          db,
          f.admin,
          "reminder",
          "שוב",
          "{date}",
          old.version
        )
      ).toEqual({ message: "STALE_VERSION", field: null })
      const now = await template(db, "reminder")
      expect(now).toMatchObject({
        title: "תזכורת",
        body_mode: old.body_mode,
        allowed_vars: old.allowed_vars,
      })
    })
  })

  it("the same key returns the earlier result without a second audit", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const key = randomUUID()
      const { version } = await template(db, "waitlist_spot")
      const call = () =>
        as(db, f.admin, async () => {
          const { rows } = await db.query(TEMPLATE, [
            "waitlist_spot",
            "מקום ב{date}",
            "אפשר להירשם",
            version,
            key,
          ])
          return rows[0].r
        })
      expect(await call()).toEqual(await call())
      expect(
        await auditRows(db, "admin_update_notification_template")
      ).toHaveLength(1)
    })
  })

  it("a customer: NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await templateFailure(db, f.customerA, "reminder", "x", "{date}")
      ).toMatchObject({ message: "NOT_AUTHORIZED" })
    })
  })

  it("a whitespace-only title (tab, line break): INVALID_INPUT on the title", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const old = await template(db, "reminder")
      expect(
        await templateFailure(db, f.admin, "reminder", "\n\t", old.body)
      ).toEqual({ message: "INVALID_INPUT", field: "title" })
    })
  })

  it("an unchanged title and body: no new version and no audit row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const old = await template(db, "reminder")
      const r = await updateTemplate(db, f, "reminder", old.title, old.body)
      expect(r.version).toBe(old.version)
      expect((await template(db, "reminder")).version).toBe(old.version)
      expect(
        await auditRows(db, "admin_update_notification_template")
      ).toHaveLength(0)
    })
  })

  it("the admin reads all 15 templates (policy and grant)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const types = await as(db, f.admin, async () => {
        const { rows } = await db.query(
          "select type from public.notification_templates"
        )
        return rows.map((row) => row.type as string)
      })
      expect(types).toHaveLength(15)
    })
  })

  it("every template type in the database has a name in the admin copy, and no other", async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query<{ type: string }>(
        "select type from public.notification_templates"
      )
      expect(new Set(Object.keys(adminCopy.settings.templates.types))).toEqual(
        new Set(rows.map((row) => row.type))
      )
    })
  })
})

describe("the template contract", { timeout: 60_000 }, () => {
  it("every seeded template renders with its allowed fields", async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query(
        `select type,
           private.render_notification_text(title, private.template_sample_vars(allowed_vars)) as title,
           case when body is null then null
             else private.render_notification_text(body, private.template_sample_vars(allowed_vars))
           end as body
         from public.notification_templates
         order by type`
      )
      expect(rows).toHaveLength(15)
    })
  })

  // Every allowed field in the title and body, so the real caller must pass
  // each of them.
  async function fillAllFields(db: Db, f: Fixture, type: string) {
    const t = await template(db, type)
    const all = (t.allowed_vars as string[]).map((v) => `{${v}}`).join("|")
    await updateTemplate(db, f, type, `T ${all}`, `B ${all}`)
  }

  function expectRendered(row: { title: string; body: string } | undefined) {
    expect(row).toBeDefined()
    expect(row!.title.startsWith("T ")).toBe(true)
    expect(row!.body.startsWith("B ")).toBe(true)
    expect(`${row!.title}${row!.body}`).not.toMatch(/[{}]/)
  }

  it("booking_confirmed, purchase_repeat and booking_cancelled render in the real flow", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      for (const type of [
        "booking_confirmed",
        "purchase_repeat",
        "booking_cancelled",
      ]) {
        await fillAllFields(db, f, type)
      }
      await grant(db, f, f.card)
      const event = await insertEvent(db, f, 5)
      const booking = await book(db, f.customerA, event)
      await as(db, f.customerA, () => db.query(CANCEL, [booking, randomUUID()]))
      for (const type of [
        "booking_confirmed",
        "purchase_repeat",
        "booking_cancelled",
      ]) {
        const rows = await notifications(db, f.customerA, type)
        expect(rows, type).toHaveLength(1)
        expectRendered(rows[0])
      }
    })
  })

  // Story 3.7: a pinned booking cancelled with a credit, or with a refund
  // request.
  for (const [type, choice] of [
    ["booking_cancelled_pinned", "credit"],
    ["booking_cancelled_refund", "refund"],
  ] as const) {
    it(`${type} renders in the real flow (${choice})`, async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await fillAllFields(db, f, type)
        const event = await insertEvent(db, f, 5)
        await insertEvent(db, f, 6)
        await insertEvent(db, f, 7)
        await grant(db, f, f.single, { eventId: event })
        const { rows } = await db.query(
          "select id from public.bookings where event_id = $1 and customer_id = $2",
          [event, f.customerA]
        )
        await as(db, f.customerA, () =>
          db.query("select public.cancel_booking($1, $2, $3) as r", [
            rows[0].id,
            randomUUID(),
            choice,
          ])
        )
        const sent = await notifications(db, f.customerA, type)
        expect(sent).toHaveLength(1)
        expectRendered(sent[0])
      })
    })
  }

  it("purchase_new_card renders when the purchase is bound", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      // purchase_new_card passes no field: a plain title and body.
      await updateTemplate(db, f, "purchase_new_card", "T כרטיסייה", "B מוכנה")
      const r = await grant(db, f, f.card, { customerId: null })
      await db.query("select private.bind_purchase($1, $2)", [
        r.payment_id,
        f.customerB,
      ])
      const sent = await notifications(db, f.customerB, "purchase_new_card")
      expect(sent).toHaveLength(1)
      expectRendered(sent[0])
    })
  })
})
