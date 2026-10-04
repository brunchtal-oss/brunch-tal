// Story 2.12: the notification core (AD-12). Templates and their seed,
// private.enqueue_notification / enqueue_admin_notification, who reads the
// notifications, and that nothing else writes them. Fictitious profiles and
// admins without Auth users, all in inRollback.

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

type Fixture = { a: string; b: string; admin1: string; admin2: string }

// As the owner: customers A and B and two admins. Every other admin row is
// removed inside the transaction, so "every admin" means exactly these two.
async function seed(db: Db): Promise<Fixture> {
  const f = {
    a: randomUUID(),
    b: randomUUID(),
    admin1: randomUUID(),
    admin2: randomUUID(),
  }
  await db.query(
    `insert into public.profiles (id, full_name, activated_at)
     values ($1, $2, now()), ($3, $4, now())`,
    [f.a, testName("notify_a"), f.b, testName("notify_b")]
  )
  await db.query("delete from public.admin_roles")
  await db.query("insert into public.admin_roles (user_id) values ($1), ($2)", [
    f.admin1,
    f.admin2,
  ])
  return f
}

const ENQUEUE =
  "select private.enqueue_notification($1, $2, $3, $4::jsonb, $5, $6) as id"

async function enqueue(
  db: Db,
  recipient: string | null,
  type: string,
  discriminator: string | null,
  vars: Record<string, unknown> | null,
  targetPath: string | null,
  bodyOverride: string | null = null
): Promise<string | null> {
  const { rows } = await db.query(ENQUEUE, [
    recipient,
    type,
    discriminator,
    vars === null ? null : JSON.stringify(vars),
    targetPath,
    bodyOverride,
  ])
  return rows[0].id
}

function enqueueError(
  db: Db,
  recipient: string | null,
  type: string,
  discriminator: string | null,
  vars: Record<string, unknown> | null,
  targetPath: string | null,
  bodyOverride: string | null = null
) {
  return queryError(db, ENQUEUE, [
    recipient,
    type,
    discriminator,
    vars === null ? null : JSON.stringify(vars),
    targetPath,
    bodyOverride,
  ])
}

const ENQUEUE_ADMIN =
  "select private.enqueue_admin_notification($1, $2, $3::jsonb, $4, $5) as n"

async function enqueueAdmin(
  db: Db,
  type: string,
  discriminator: string,
  vars: Record<string, unknown> | null,
  targetPath: string,
  bodyOverride: string | null = null
): Promise<number> {
  const { rows } = await db.query(ENQUEUE_ADMIN, [
    type,
    discriminator,
    vars === null ? null : JSON.stringify(vars),
    targetPath,
    bodyOverride,
  ])
  return rows[0].n
}

type NotificationRow = {
  id: string
  recipient_id: string
  recipient_kind: string
  type: string
  payload: { title: string; body: string; template_version: number }
  target_path: string
  dedupe_key: string
  read_at: string | null
}

async function notificationsOf(
  db: Db,
  recipients: string[]
): Promise<NotificationRow[]> {
  const { rows } = await db.query(
    `select id, recipient_id, recipient_kind, type, payload, target_path,
            dedupe_key, read_at
     from public.notifications
     where recipient_id = any($1::uuid[])
     order by created_at, id`,
    [recipients]
  )
  return rows
}

async function jobsOf(db: Db, recipients: string[]) {
  const { rows } = await db.query(
    `select j.notification_id, j.status, j.attempt_count, j.lease_until,
            j.finished_at, j.scheduled_at <= now() as due
     from public.notification_jobs j
     join public.notifications n on n.id = j.notification_id
     where n.recipient_id = any($1::uuid[])`,
    [recipients]
  )
  return rows
}

const CARD_EXPIRING_VARS = { units: "3", expires_on: "10.11" }

// The approved seed (spec 2.12): recipient, push, body mode, title, body.
const SEED = [
  [
    "purchase_new_card",
    "customer",
    true,
    "template",
    "הכרטיסייה שלך מוכנה.",
    "מומלץ להירשם מראש לארבעת המפגשים כדי לבחור את התאריכים שנוחים לך",
  ],
  [
    "purchase_repeat",
    "customer",
    true,
    "template",
    "הרכישה נוספה לחשבון שלך",
    "{product}, בתוקף עד {expires_on}{card_tip}",
  ],
  [
    "booking_confirmed",
    "customer",
    false,
    "template",
    "ההרשמה אושרה",
    "{date} · {time} · בראנץ׳ {concept}",
  ],
  [
    "reminder",
    "customer",
    true,
    "template",
    "מחכים לך בבראנץ׳",
    "{date} בשעה {time}. נתראה!",
  ],
  [
    "waitlist_spot",
    "customer",
    true,
    "template",
    "התפנה מקום ב{date}",
    "כדי להירשם צריך כניסה מתאימה, והמקום מובטח רק אחרי שההרשמה מאושרת",
  ],
  [
    "booking_cancelled",
    "customer",
    false,
    "template",
    "ההרשמה ל{date} בוטלה",
    "{outcome}",
  ],
  [
    "event_changed",
    "customer",
    true,
    "template_or_override",
    "שינוי בבראנץ׳ של {date}",
    "הבראנץ׳ עבר ל{new_date} בשעה {new_time}. כל הפרטים ומה אפשר לעשות מחכים לך באזור האישי",
  ],
  [
    "event_cancelled",
    "customer",
    true,
    "template_or_override",
    "הבראנץ׳ של {date} בוטל",
    "מצטערות על השינוי. כל הפרטים ומה אפשר לעשות מחכים לך באזור האישי",
  ],
  [
    "entitlement_changed",
    "customer",
    true,
    "template",
    "עדכון בכרטיסייה שלך",
    "בתוקף עד {expires_on}, עם {units} כניסות פנויות. הפרטים באזור האישי",
  ],
  [
    "card_expiring",
    "customer",
    true,
    "template",
    "הכרטיסייה שלך עומדת לפוג",
    "נשארו לך {units} כניסות פנויות עד {expires_on}. זה הזמן לבחור מפגשים",
  ],
  ["broadcast", "customer", true, "override", "הודעה מטל", null],
  [
    "admin_card_expiring",
    "admin",
    true,
    "template",
    "הכרטיסייה של {customer} עומדת לפוג",
    "{units} כניסות פנויות, בתוקף עד {expires_on}",
  ],
  ["marketing_reminder", "admin", true, "override", "תזכורת שיווק", null],
].map(([type, recipient_kind, push, body_mode, title, body]) => ({
  type,
  recipient_kind,
  push,
  body_mode,
  title,
  body,
  version: 1,
}))

describe("notification templates", () => {
  it("hold the approved seed: 13 types, recipient, channel, mode and wording", async () => {
    const rows = await sql(
      `select type, recipient_kind, push, body_mode, title, body, version
       from public.notification_templates
       order by type collate "C"`
    )
    const expected = [...SEED].sort((x, y) =>
      String(x.type) < String(y.type) ? -1 : 1
    )
    expect(rows).toEqual(expected)
  })

  it("purchase_new_card is the wording of source section 2 word for word", async () => {
    const rows = await sql<{ text: string }>(
      `select title || ' ' || body as text
       from public.notification_templates where type = 'purchase_new_card'`
    )
    expect(rows[0].text).toBe(
      "הכרטיסייה שלך מוכנה. מומלץ להירשם מראש לארבעת המפגשים כדי לבחור את התאריכים שנוחים לך"
    )
  })

  it("accept only the 13 types, each with its fixed recipient kind and body", async () => {
    await inRollback(async (db) => {
      const statements = [
        `insert into public.notification_templates
           (type, recipient_kind, push, body_mode, title, body)
         values ('other_type', 'customer', true, 'template', 'x', 'x')`,
        "update public.notification_templates set recipient_kind = 'admin' where type = 'reminder'",
        "update public.notification_templates set recipient_kind = 'customer' where type = 'marketing_reminder'",
        "update public.notification_templates set body = null where type = 'reminder'",
        "update public.notification_templates set body = 'x' where type = 'broadcast'",
        "update public.notification_templates set body_mode = 'other' where type = 'reminder'",
      ]
      for (const text of statements) {
        expect((await queryError(db, text))?.code, text).toBe("23514")
      }
    })
  })
})

describe("enqueue_notification", () => {
  it("creates one row with the rendered wording and a queued job", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await enqueue(
        db,
        f.a,
        "card_expiring",
        "ent-1:2026-11-10",
        CARD_EXPIRING_VARS,
        "/me"
      )
      expect(id).toEqual(expect.any(String))

      const rows = await notificationsOf(db, [f.a])
      expect(rows).toEqual([
        {
          id,
          recipient_id: f.a,
          recipient_kind: "customer",
          type: "card_expiring",
          payload: {
            title: "הכרטיסייה שלך עומדת לפוג",
            body: "נשארו לך 3 כניסות פנויות עד 10.11. זה הזמן לבחור מפגשים",
            template_version: 1,
          },
          target_path: "/me",
          dedupe_key: `card_expiring:${f.a}:ent-1:2026-11-10`,
          read_at: null,
        },
      ])
      expect(await jobsOf(db, [f.a])).toEqual([
        {
          notification_id: id,
          status: "queued",
          attempt_count: 0,
          lease_until: null,
          finished_at: null,
          due: true,
        },
      ])
    })
  })

  it("the same discriminator again returns null and creates nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const args = [
        f.a,
        "card_expiring",
        "D",
        CARD_EXPIRING_VARS,
        "/me",
      ] as const
      expect(await enqueue(db, ...args)).toEqual(expect.any(String))
      expect(await enqueue(db, ...args)).toBeNull()
      expect(await notificationsOf(db, [f.a])).toHaveLength(1)
      expect(await jobsOf(db, [f.a])).toHaveLength(1)
    })
  })

  it("another discriminator creates a second row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await enqueue(db, f.a, "card_expiring", "D", CARD_EXPIRING_VARS, "/me")
      const second = await enqueue(
        db,
        f.a,
        "card_expiring",
        "D2",
        CARD_EXPIRING_VARS,
        "/me"
      )
      expect(second).toEqual(expect.any(String))
      expect(await notificationsOf(db, [f.a])).toHaveLength(2)
      expect(await jobsOf(db, [f.a])).toHaveLength(2)
    })
  })

  it("a type without push creates a row and no job", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const id = await enqueue(
        db,
        f.a,
        "booking_confirmed",
        "booking-1",
        { date: "10.11", time: "10:00", concept: "יווני" },
        "/me/bookings"
      )
      const rows = await notificationsOf(db, [f.a])
      expect(rows.map((row) => row.id)).toEqual([id])
      expect(rows[0].payload.body).toBe("10.11 · 10:00 · בראנץ׳ יווני")
      expect(await jobsOf(db, [f.a])).toEqual([])
    })
  })

  it("a null recipient returns null and creates nothing", async () => {
    await inRollback(async (db) => {
      await seed(db)
      const count = async () => {
        const { rows } = await db.query(
          `select (select count(*) from public.notifications)::int as n,
                  (select count(*) from public.notification_jobs)::int as j`
        )
        return rows[0]
      }
      const before = await count()
      expect(
        await enqueue(db, null, "purchase_new_card", randomUUID(), null, "/me")
      ).toBeNull()
      expect(await count()).toEqual(before)
    })
  })

  it("an invalid target path is refused by the check (23514)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      for (const path of [
        "/admin",
        "/meow",
        "/me//x",
        "/me x",
        "/me\\x",
        "me",
      ]) {
        expect(
          (await enqueueError(db, f.a, "purchase_new_card", path, null, path))
            ?.code,
          path
        ).toBe("23514")
      }
      expect(
        (
          await enqueueError(
            db,
            f.admin1,
            "marketing_reminder",
            "m1",
            null,
            "/me",
            "x"
          )
        )?.code
      ).toBe("23514")
      for (const path of ["/me", "/me/bookings", "/me?tab=cards"]) {
        expect(
          await enqueue(db, f.a, "purchase_new_card", path, null, path)
        ).toEqual(expect.any(String))
      }
      expect(
        await enqueue(
          db,
          f.admin1,
          "marketing_reminder",
          "m1",
          null,
          "/admin/customers",
          "x"
        )
      ).toEqual(expect.any(String))
      expect(await notificationsOf(db, [f.a])).toHaveLength(3)
    })
  })

  it("refuses a missing var, a forbidden or missing override, an unknown type and a wrong recipient", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const cases: Array<Parameters<typeof enqueueError>> = [
        // A {name} that would stay in the text.
        [db, f.a, "card_expiring", "D", { units: "3" }, "/me"],
        [db, f.a, "card_expiring", "D", null, "/me"],
        [
          db,
          f.a,
          "card_expiring",
          "D",
          { units: "3", expires_on: true },
          "/me",
        ],
        // An override on a template-only type, and none on an override type.
        [db, f.a, "card_expiring", "D", CARD_EXPIRING_VARS, "/me", "x"],
        [db, f.a, "broadcast", "D", null, "/me"],
        [db, f.a, "broadcast", "D", null, "/me", "  "],
        [db, f.admin1, "marketing_reminder", "D", null, "/admin"],
        // Unknown type, empty discriminator, vars that are not an object.
        [db, f.a, "no_such_type", "D", null, "/me"],
        [db, f.a, "purchase_new_card", "", null, "/me"],
        [db, f.a, "purchase_new_card", " ", null, "/me"],
        [db, f.a, "purchase_new_card", null, null, "/me"],
        // A customer type for an admin, an admin type for a customer, and a
        // recipient that does not exist.
        [db, f.admin1, "purchase_new_card", "D", null, "/me"],
        [db, f.a, "marketing_reminder", "D", null, "/admin", "x"],
        [db, randomUUID(), "purchase_new_card", "D", null, "/me"],
      ]
      for (const args of cases) {
        expect(
          (await enqueueError(...args))?.message,
          JSON.stringify(args.slice(2))
        ).toBe("INVALID_INPUT")
      }
      expect(
        (
          await queryError(
            db,
            "select private.enqueue_notification($1, 'purchase_new_card', 'D', '[]'::jsonb, '/me')",
            [f.a]
          )
        )?.message
      ).toBe("INVALID_INPUT")
      expect(await notificationsOf(db, [f.a, f.b, f.admin1, f.admin2])).toEqual(
        []
      )
    })
  })

  it("takes the override as the body where the type allows it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await enqueue(
        db,
        f.a,
        "broadcast",
        "broadcast-1",
        null,
        "/me",
        "הודעה {לא} מרונדרת"
      )
      await enqueue(
        db,
        f.a,
        "event_changed",
        "event-1:2",
        { date: "10.11" },
        "/me/bookings",
        "נוסח שטל ערכה"
      )
      await enqueue(
        db,
        f.a,
        "event_cancelled",
        "event-2:3",
        { date: "12.11" },
        "/me"
      )
      // One transaction shares one created_at, so the rows are keyed by type.
      const rows = await notificationsOf(db, [f.a])
      expect(
        Object.fromEntries(rows.map((row) => [row.type, row.payload]))
      ).toEqual({
        broadcast: {
          title: "הודעה מטל",
          body: "הודעה {לא} מרונדרת",
          template_version: 1,
        },
        event_changed: {
          title: "שינוי בבראנץ׳ של 10.11",
          body: "נוסח שטל ערכה",
          template_version: 1,
        },
        event_cancelled: {
          title: "הבראנץ׳ של 12.11 בוטל",
          body: "מצטערות על השינוי. כל הפרטים ומה אפשר לעשות מחכים לך באזור האישי",
          template_version: 1,
        },
      })
    })
  })

  it("renders each placeholder once, even when a value holds braces", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await enqueue(
        db,
        f.a,
        "purchase_repeat",
        "payment-1",
        {
          product: "{expires_on}",
          expires_on: "10.11",
          card_tip: "",
          extra: "x",
        },
        "/me"
      )
      const rows = await notificationsOf(db, [f.a])
      expect(rows[0].payload.body).toBe("{expires_on}, בתוקף עד 10.11")
    })
  })

  it("renders a number value, and a template without placeholders needs no vars", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await enqueue(
        db,
        f.a,
        "card_expiring",
        "D",
        { units: 2, expires_on: "10.11" },
        "/me"
      )
      expect(
        await enqueue(db, f.a, "purchase_new_card", "payment-1", null, "/me")
      ).toEqual(expect.any(String))
      const rows = await notificationsOf(db, [f.a])
      const expiring = rows.find((row) => row.type === "card_expiring")
      expect(expiring?.payload.body).toBe(
        "נשארו לך 2 כניסות פנויות עד 10.11. זה הזמן לבחור מפגשים"
      )
      expect(rows).toHaveLength(2)
    })
  })

  it("refuses a template with an unmatched brace and creates nothing", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      for (const body of ["{units}}", "}{units}", "{units"]) {
        await db.query(
          "update public.notification_templates set body = $1 where type = 'card_expiring'",
          [body]
        )
        expect(
          (
            await enqueueError(
              db,
              f.a,
              "card_expiring",
              "D",
              CARD_EXPIRING_VARS,
              "/me"
            )
          )?.message,
          body
        ).toBe("INVALID_INPUT")
      }
      expect(await notificationsOf(db, [f.a])).toEqual([])
    })
  })

  it("editing a template later does not change an existing notification", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await enqueue(db, f.a, "card_expiring", "D", CARD_EXPIRING_VARS, "/me")
      const before = await notificationsOf(db, [f.a])
      await db.query(
        `update public.notification_templates
         set body = 'נוסח חדש', title = 'כותרת חדשה', version = version + 1,
             updated_at = now()
         where type = 'card_expiring'`
      )
      expect(await notificationsOf(db, [f.a])).toEqual(before)

      await enqueue(db, f.a, "card_expiring", "D2", CARD_EXPIRING_VARS, "/me")
      // Same transaction, same created_at: find the new row by its key.
      const after = await notificationsOf(db, [f.a])
      const added = after.find((row) => row.dedupe_key.endsWith(":D2"))
      expect(added?.payload).toEqual({
        title: "כותרת חדשה",
        body: "נוסח חדש",
        template_version: 2,
      })
    })
  })
})

describe("enqueue_admin_notification", () => {
  it("creates one row per admin, then nothing for the same discriminator", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const vars = { customer: "דנה", units: "2", expires_on: "10.11" }
      expect(
        await enqueueAdmin(
          db,
          "admin_card_expiring",
          "ent-1:2026-11-10",
          vars,
          "/admin/customers/open-cards"
        )
      ).toBe(2)
      const rows = await notificationsOf(db, [f.admin1, f.admin2])
      expect(
        rows.map((row) => [row.recipient_id, row.recipient_kind]).sort()
      ).toEqual(
        [
          [f.admin1, "admin"],
          [f.admin2, "admin"],
        ].sort()
      )
      expect(rows[0].payload).toEqual({
        title: "הכרטיסייה של דנה עומדת לפוג",
        body: "2 כניסות פנויות, בתוקף עד 10.11",
        template_version: 1,
      })
      expect(await jobsOf(db, [f.admin1, f.admin2])).toHaveLength(2)

      expect(
        await enqueueAdmin(
          db,
          "admin_card_expiring",
          "ent-1:2026-11-10",
          vars,
          "/admin/customers/open-cards"
        )
      ).toBe(0)
      expect(await notificationsOf(db, [f.admin1, f.admin2])).toHaveLength(2)
    })
  })

  it("passes a body override to every admin", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await enqueueAdmin(
          db,
          "marketing_reminder",
          "m1",
          null,
          "/admin",
          "לפרסם את המפגשים של השבוע"
        )
      ).toBe(2)
      const rows = await notificationsOf(db, [f.admin1, f.admin2])
      expect(rows.map((row) => row.recipient_id).sort()).toEqual(
        [f.admin1, f.admin2].sort()
      )
      for (const row of rows) {
        expect(row.payload).toEqual({
          title: "תזכורת שיווק",
          body: "לפרסם את המפגשים של השבוע",
          template_version: 1,
        })
      }
    })
  })

  it("refuses a customer type", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        (
          await queryError(db, ENQUEUE_ADMIN, [
            "purchase_new_card",
            "D",
            null,
            "/admin",
            null,
          ])
        )?.message
      ).toBe("INVALID_INPUT")
      expect(await notificationsOf(db, [f.admin1, f.admin2])).toEqual([])
    })
  })
})

describe("notifications row level security", () => {
  async function seedAll(db: Db) {
    const f = await seed(db)
    const ids = {
      a: await enqueue(db, f.a, "purchase_new_card", "p-a", null, "/me"),
      b: await enqueue(db, f.b, "purchase_new_card", "p-b", null, "/me"),
      admin1: await enqueue(
        db,
        f.admin1,
        "marketing_reminder",
        "m",
        null,
        "/admin",
        "x"
      ),
      admin2: await enqueue(
        db,
        f.admin2,
        "marketing_reminder",
        "m",
        null,
        "/admin",
        "x"
      ),
    }
    return { f, ids, all: Object.values(ids) }
  }

  async function visible(db: Db, ids: Array<string | null>) {
    const { rows } = await db.query(
      "select id from public.notifications where id = any($1::uuid[])",
      [ids]
    )
    return rows.map((row) => row.id)
  }

  it("every recipient reads only her own notifications", async () => {
    await inRollback(async (db) => {
      const { f, ids, all } = await seedAll(db)
      for (const who of ["a", "b", "admin1", "admin2"] as const) {
        await asAuthenticated(db, f[who])
        expect(await visible(db, all), who).toEqual([ids[who]])
        await db.query("reset role")
      }
      // Being an admin does not open a customer's notifications.
      for (const who of ["admin1", "admin2"] as const) {
        await asAuthenticated(db, f[who])
        expect(await visible(db, [ids.a]), who).toEqual([])
        await db.query("reset role")
      }
    })
  })

  it("anon cannot read notifications", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      expect(
        (await queryError(db, "select id from public.notifications limit 1"))
          ?.code
      ).toBe("42501")
    })
  })

  it("a customer cannot write notifications or read jobs and templates", async () => {
    await inRollback(async (db) => {
      const { f, ids } = await seedAll(db)
      await asAuthenticated(db, f.a)
      const statements: Array<[string, unknown[]]> = [
        [
          `insert into public.notifications
             (recipient_id, recipient_kind, type, payload, target_path, dedupe_key)
           values ($1, 'customer', 'broadcast',
             '{"title":"x","body":"x","template_version":1}', '/me', 'x')`,
          [f.a],
        ],
        [
          "update public.notifications set read_at = now() where id = $1",
          [ids.a],
        ],
        ["delete from public.notifications where id = $1", [ids.a]],
        ["select * from public.notification_jobs limit 1", []],
        ["select * from public.notification_templates limit 1", []],
        [
          "insert into public.notification_jobs (notification_id) values ($1)",
          [ids.a],
        ],
        ["update public.notification_templates set title = 'x'", []],
      ]
      for (const [text, params] of statements) {
        expect((await queryError(db, text, params))?.code, text).toBe("42501")
      }
      for (const fn of [
        "select private.enqueue_notification($1, 'purchase_new_card', 'x', null, '/me')",
        "select private.enqueue_admin_notification('marketing_reminder', 'x', null, '/admin', $1::text)",
      ]) {
        expect((await queryError(db, fn, [f.a]))?.code, fn).toBe("42501")
      }
    })
  })
})

describe("pg_proc", () => {
  async function functionsMatching(pattern: RegExp): Promise<string[]> {
    const rows = await sql<{ name: string; src: string }>(`
      select n.nspname || '.' || p.proname as name, p.prosrc as src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.oid not in (select objid from pg_depend where deptype = 'e')`)
    return rows
      .filter((row) => pattern.test(row.src))
      .map((row) => row.name)
      .sort()
  }

  it("only enqueue_notification inserts into notifications and notification_jobs", async () => {
    expect(
      await functionsMatching(/insert\s+into\s+public\.notifications\b/i)
    ).toEqual(["private.enqueue_notification"])
    expect(
      await functionsMatching(/insert\s+into\s+public\.notification_jobs\b/i)
    ).toEqual(["private.enqueue_notification"])
  })
})
