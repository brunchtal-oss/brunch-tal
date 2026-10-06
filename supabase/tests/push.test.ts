// Story 5.8: the push pipeline in the database. register / unregister
// (authenticated), claim_push_jobs / finish_push_job (service_role), the
// skipped status (no subscription, older than 24 hours), backoff, lease,
// two workers at once, push_failed in "to handle", and the cron job that
// wakes the worker only with Vault values and a ready job. One test per row
// of the spec's I/O matrix (the long body is cut in the worker,
// lib/server/privileged/push-worker.test.ts). Fictitious users only;
// everything runs in inRollback except the two-workers test, which commits
// its rows and removes them in onCleanup.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  getPool,
  inRollback,
  insertAuthUser,
  onCleanup,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"

const CLAIM = "select public.claim_push_jobs($1) as r"
const FINISH =
  "select public.finish_push_job($1, $2::uuid[], $3::uuid[], $4) as r"
const REGISTER =
  "select public.register_push_subscription($1, $2::jsonb, $3) as r"
const UNREGISTER = "select public.unregister_push_subscription($1) as r"
const ITEMS = "select public.admin_get_attention_items() as r"
const JOB = "select private.job_invoke_push_worker() as r"

const KEYS = {
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ",
  auth: "tBHItJI5svbpez7KI4CCXg",
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string }
type Claimed = {
  job_id: string
  title: string
  body: string
  target_path: string
  subscriptions: Sub[]
}
type Fixture = { a: string; b: string; admin: string; inactive: string }

function endpointOf(label: string): string {
  return `https://push.example.test/${testName(label)}/${randomUUID()}`
}

// As the owner: customers A and B (active), an admin and a customer whose
// profile was never activated, each with an Auth user (the subscriptions'
// foreign key).
async function seed(db: Db): Promise<Fixture> {
  const a = (await insertAuthUser(db, "push_a")).id
  const b = (await insertAuthUser(db, "push_b")).id
  const admin = (await insertAuthUser(db, "push_admin")).id
  const inactive = (await insertAuthUser(db, "push_inactive")).id
  await db.query(
    `insert into public.profiles (id, full_name, activated_at)
     values ($1, $2, now()), ($3, $4, now()), ($5, $6, null)`,
    [
      a,
      testName("push_a"),
      b,
      testName("push_b"),
      inactive,
      testName("push_inactive"),
    ]
  )
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  return { a, b, admin, inactive }
}

// As the owner: a subscription of `userId`.
async function addSub(db: Db, userId: string, label: string): Promise<string> {
  const { rows } = await db.query(
    `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, platform)
     values ($1, $2, $3, $4, 'android') returning id`,
    [userId, endpointOf(label), KEYS.p256dh, KEYS.auth]
  )
  return rows[0].id
}

// As the owner: a notification of `recipient` and its queued job (inserted
// here when the type's template has no push).
async function addJob(
  db: Db,
  recipient: string,
  kind: "customer" | "admin" = "customer",
  body = "x"
): Promise<string> {
  const { rows } =
    kind === "customer"
      ? await db.query(
          "select private.enqueue_notification($1, 'purchase_new_card', $2, null, '/me/bookings') as id",
          [recipient, randomUUID()]
        )
      : await db.query(
          "select private.enqueue_notification($1, 'marketing_reminder', $2, null, '/admin', $3) as id",
          [recipient, randomUUID(), body]
        )
  const notificationId = rows[0].id as string
  await db.query(
    `insert into public.notification_jobs (notification_id) values ($1)
     on conflict (notification_id) do nothing`,
    [notificationId]
  )
  const { rows: jobs } = await db.query(
    "select id from public.notification_jobs where notification_id = $1",
    [notificationId]
  )
  return jobs[0].id
}

// As the owner: every other ready job of the dev database waits a day, so a
// claim sees only this test's jobs (rolled back with the test).
async function isolate(db: Db, mine: string[]): Promise<void> {
  await db.query(
    `update public.notification_jobs
     set next_attempt_at = now() + interval '1 day'
     where status = 'queued' and id <> all($1::uuid[])`,
    [mine]
  )
  await db.query(
    `update public.notification_jobs
     set lease_until = now() + interval '1 day'
     where status = 'sending' and id <> all($1::uuid[])`,
    [mine]
  )
}

async function claim(db: Db, limit = 25): Promise<Claimed[]> {
  await asServiceRole(db)
  const { rows } = await db.query(CLAIM, [limit])
  await db.query("reset role")
  return rows[0].r
}

async function finish(
  db: Db,
  jobId: string,
  delivered: string[],
  gone: string[],
  error: string | null
): Promise<{ status: string }> {
  await asServiceRole(db)
  const { rows } = await db.query(FINISH, [jobId, delivered, gone, error])
  await db.query("reset role")
  return rows[0].r
}

type JobRow = {
  status: string
  attempt_count: number
  lease_ok: boolean | null
  next_in_s: number
  finished: boolean
  last_error: string | null
}

async function jobOf(db: Db, jobId: string): Promise<JobRow> {
  const { rows } = await db.query(
    `select status, attempt_count,
       lease_until between now() + interval '119 seconds'
         and now() + interval '121 seconds' as lease_ok,
       round(extract(epoch from next_attempt_at - now()))::int as next_in_s,
       finished_at is not null as finished,
       last_error
     from public.notification_jobs where id = $1`,
    [jobId]
  )
  return rows[0]
}

async function deliveriesOf(db: Db, jobId: string): Promise<string[]> {
  const { rows } = await db.query(
    "select subscription_id from public.notification_deliveries where job_id = $1 order by subscription_id",
    [jobId]
  )
  return rows.map((row) => row.subscription_id)
}

async function subIds(db: Db, userId: string): Promise<string[]> {
  const { rows } = await db.query(
    "select id from public.push_subscriptions where user_id = $1 order by id",
    [userId]
  )
  return rows.map((row) => row.id)
}

function mine(claimed: Claimed[], jobIds: string[]): Claimed[] {
  return claimed.filter((c) => jobIds.includes(c.job_id))
}

describe("claim_push_jobs / finish_push_job", { timeout: 30_000 }, () => {
  it("sends: a queued job, two subscriptions -> two deliveries, sent", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const s1 = await addSub(db, f.a, "s1")
      const s2 = await addSub(db, f.a, "s2")
      const job = await addJob(db, f.a)
      await isolate(db, [job])

      const claimed = await claim(db)
      expect(claimed).toHaveLength(1)
      expect(claimed[0]).toMatchObject({
        job_id: job,
        title: "הכרטיסייה שלך מוכנה.",
        body: expect.any(String),
        target_path: "/me/bookings",
      })
      expect(claimed[0].subscriptions.map((s) => s.id)).toEqual([s1, s2].sort())
      expect(claimed[0].subscriptions[0]).toEqual({
        id: expect.any(String),
        endpoint: expect.stringMatching(/^https:\/\/push\.example\.test\//),
        p256dh: KEYS.p256dh,
        auth: KEYS.auth,
      })
      expect(await jobOf(db, job)).toMatchObject({
        status: "sending",
        attempt_count: 1,
        lease_ok: true,
        finished: false,
      })

      expect(await finish(db, job, [s1, s2], [], null)).toEqual({
        status: "sent",
      })
      expect(await jobOf(db, job)).toMatchObject({
        status: "sent",
        lease_ok: null,
        finished: true,
        last_error: null,
      })
      expect(await deliveriesOf(db, job)).toEqual([s1, s2].sort())
      // Nothing left to claim.
      expect(mine(await claim(db), [job])).toEqual([])
    })
  })

  it("retry: one delivered, one 500 -> queued after 1 minute; the next claim sends only to the other", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const s1 = await addSub(db, f.a, "s1")
      const s2 = await addSub(db, f.a, "s2")
      const job = await addJob(db, f.a)
      await isolate(db, [job])

      await claim(db)
      expect(await finish(db, job, [s1], [], "HTTP_500")).toEqual({
        status: "queued",
      })
      const row = await jobOf(db, job)
      expect(row).toMatchObject({
        status: "queued",
        attempt_count: 1,
        lease_ok: null,
        finished: false,
        last_error: "HTTP_500",
      })
      expect(row.next_in_s).toBeGreaterThanOrEqual(59)
      expect(row.next_in_s).toBeLessThanOrEqual(61)
      // Not due yet.
      expect(mine(await claim(db), [job])).toEqual([])

      await db.query(
        "update public.notification_jobs set next_attempt_at = now() where id = $1",
        [job]
      )
      const again = mine(await claim(db), [job])
      expect(again.map((c) => c.subscriptions.map((s) => s.id))).toEqual([[s2]])
      expect((await jobOf(db, job)).attempt_count).toBe(2)

      // The second failure waits 5 minutes.
      await finish(db, job, [], [], "HTTP_500")
      expect((await jobOf(db, job)).next_in_s).toBeGreaterThanOrEqual(299)
      expect((await jobOf(db, job)).next_in_s).toBeLessThanOrEqual(301)
    })
  })

  it("a gone subscription (404/410) is deleted; the job is sent; another user's id is ignored", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const s1 = await addSub(db, f.a, "s1")
      const s2 = await addSub(db, f.a, "s2")
      const other = await addSub(db, f.b, "other")
      const job = await addJob(db, f.a)
      await isolate(db, [job])

      await claim(db)
      expect(await finish(db, job, [s1, other], [s2, other], null)).toEqual({
        status: "sent",
      })
      expect(await subIds(db, f.a)).toEqual([s1])
      expect(await subIds(db, f.b)).toEqual([other])
      expect(await deliveriesOf(db, job)).toEqual([s1])
    })
  })

  it("403 (a wrong VAPID subject): the subscription stays, error, backoff", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const s1 = await addSub(db, f.a, "s1")
      const job = await addJob(db, f.a)
      await isolate(db, [job])

      await claim(db)
      expect(await finish(db, job, [], [], "HTTP_403")).toEqual({
        status: "queued",
      })
      expect(await subIds(db, f.a)).toEqual([s1])
      expect(await jobOf(db, job)).toMatchObject({
        status: "queued",
        last_error: "HTTP_403",
      })
    })
  })

  it("the error is cut to 200 characters", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await addSub(db, f.a, "s1")
      const job = await addJob(db, f.a)
      await isolate(db, [job])
      await claim(db)
      await finish(db, job, [], [], "E".repeat(500))
      expect((await jobOf(db, job)).last_error).toBe("E".repeat(200))
    })
  })

  it("after 5 attempts -> failed, and push_failed in 'to handle' until the week passes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await addSub(db, f.a, "s1")
      const job = await addJob(db, f.a)
      await isolate(db, [job])
      await db.query(
        "update public.notification_jobs set attempt_count = 4 where id = $1",
        [job]
      )

      await claim(db)
      expect(await finish(db, job, [], [], "HTTP_500")).toEqual({
        status: "failed",
      })
      expect(await jobOf(db, job)).toMatchObject({
        status: "failed",
        attempt_count: 5,
        finished: true,
        last_error: "HTTP_500",
      })

      const items = async () => {
        await asAuthenticated(db, f.admin)
        const { rows } = await db.query(ITEMS)
        await db.query("reset role")
        return (rows[0].r as Array<Record<string, unknown>>).filter(
          (i) => i.kind === "push_failed"
        )
      }
      const { rows: counts } = await db.query(
        `select count(*)::int as n, max(finished_at) as since
         from public.notification_jobs
         where status = 'failed' and finished_at >= now() - interval '7 days'`
      )
      const list = await items()
      expect(list).toEqual([
        {
          kind: "push_failed",
          id: "push_failed",
          customer_label: null,
          since: expect.any(String),
          count: counts[0].n,
        },
      ])
      expect(new Date(list[0].since as string).getTime()).toBe(
        new Date(counts[0].since).getTime()
      )

      // Every failure older than a week: the item is gone.
      await db.query(
        "update public.notification_jobs set finished_at = now() - interval '8 days' where status = 'failed'"
      )
      expect(await items()).toEqual([])
    })
  })

  it("a recipient without a subscription -> skipped, no claim", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const job = await addJob(db, f.b)
      await isolate(db, [job])
      expect(mine(await claim(db), [job])).toEqual([])
      expect(await jobOf(db, job)).toMatchObject({
        status: "skipped",
        lease_ok: null,
        finished: true,
      })
    })
  })

  it("older than 24 hours, with a subscription -> skipped, the notification stays", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await addSub(db, f.a, "s1")
      const job = await addJob(db, f.a)
      await isolate(db, [job])
      await db.query(
        `update public.notifications set created_at = now() - interval '25 hours'
         where id = (select notification_id from public.notification_jobs where id = $1)`,
        [job]
      )
      expect(mine(await claim(db), [job])).toEqual([])
      expect(await jobOf(db, job)).toMatchObject({
        status: "skipped",
        finished: true,
      })
      expect(await deliveriesOf(db, job)).toEqual([])
      const { rows } = await db.query(
        `select count(*)::int as n from public.notifications
         where id = (select notification_id from public.notification_jobs where id = $1)`,
        [job]
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("a passed lease: taken again, only for the subscription that did not get it", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const s1 = await addSub(db, f.a, "s1")
      const s2 = await addSub(db, f.a, "s2")
      const job = await addJob(db, f.a)
      await isolate(db, [job])
      await claim(db)
      // The worker died after s1 got it (a delivery from an earlier finish).
      await db.query(
        "insert into public.notification_deliveries (job_id, subscription_id) values ($1, $2)",
        [job, s1]
      )
      // A live lease is not taken.
      expect(mine(await claim(db), [job])).toEqual([])

      await db.query(
        "update public.notification_jobs set lease_until = now() - interval '1 second' where id = $1",
        [job]
      )
      const again = mine(await claim(db), [job])
      expect(again.map((c) => c.subscriptions.map((s) => s.id))).toEqual([[s2]])
      expect(await jobOf(db, job)).toMatchObject({
        status: "sending",
        attempt_count: 2,
        lease_ok: true,
      })
    })
  })

  it("a passed lease after the 5th attempt -> failed", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await addSub(db, f.a, "s1")
      const job = await addJob(db, f.a)
      await isolate(db, [job])
      await db.query(
        `update public.notification_jobs
         set status = 'sending', attempt_count = 5,
             lease_until = now() - interval '1 second'
         where id = $1`,
        [job]
      )
      expect(mine(await claim(db), [job])).toEqual([])
      expect(await jobOf(db, job)).toMatchObject({
        status: "failed",
        finished: true,
        last_error: "LEASE_EXPIRED",
      })
    })
  })

  it("the admin's job reaches the admin's subscriptions with an /admin target", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const s = await addSub(db, f.admin, "admin")
      await addSub(db, f.a, "a")
      const job = await addJob(db, f.admin, "admin", "גוף")
      await isolate(db, [job])
      const claimed = mine(await claim(db), [job])
      expect(claimed).toEqual([
        {
          job_id: job,
          title: "תזכורת שיווק",
          body: "גוף",
          target_path: "/admin",
          subscriptions: [expect.objectContaining({ id: s })],
        },
      ])
    })
  })

  it("the claim limit counts returned jobs only", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await addSub(db, f.a, "s1")
      const skipped = await addJob(db, f.b)
      const j1 = await addJob(db, f.a)
      const j2 = await addJob(db, f.a)
      await isolate(db, [skipped, j1, j2])
      // The job without a subscription comes first and is closed on the way.
      await db.query(
        "update public.notification_jobs set next_attempt_at = now() - interval '1 minute' where id = $1",
        [skipped]
      )
      const first = await claim(db, 1)
      expect(first).toHaveLength(1)
      const second = await claim(db, 1)
      expect(second).toHaveLength(1)
      expect([first[0].job_id, second[0].job_id].sort()).toEqual(
        [j1, j2].sort()
      )
      expect((await jobOf(db, skipped)).status).toBe("skipped")
      expect(await claim(db, 1)).toEqual([])
    })
  })
})

describe("two workers at once", { timeout: 30_000 }, () => {
  it("every job is taken once", async () => {
    // Committed rows (a second transaction must see them), removed after the
    // file. Deleting the Auth user removes the subscription; the profile and
    // the notifications (with their jobs) are deleted explicitly.
    const user = randomUUID()
    const notifications: string[] = []
    let jobs: string[] = []
    {
      const client = await getPool().connect()
      try {
        await client.query("begin")
        await insertAuthUser(client, "push_workers", { id: user })
        await client.query(
          "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
          [user, testName("push_workers")]
        )
        await addSub(client, user, "workers")
        jobs = [await addJob(client, user), await addJob(client, user)]
        const { rows } = await client.query(
          "select notification_id from public.notification_jobs where id = any($1::uuid[])",
          [jobs]
        )
        notifications.push(...rows.map((row) => row.notification_id))
        await client.query("commit")
        client.release()
      } catch (error) {
        await client.query("rollback").catch(() => {})
        client.release(true)
        throw error
      }
    }
    onCleanup(async () => {
      await sql("delete from public.notifications where id = any($1::uuid[])", [
        notifications,
      ])
      await sql("delete from public.profiles where id = $1", [user])
      await sql("delete from auth.users where id = $1", [user])
    })

    const one = await getPool().connect()
    const two = await getPool().connect()
    try {
      await one.query("begin")
      await two.query("begin")
      await asServiceRole(one)
      await asServiceRole(two)
      const first: Claimed[] = (await one.query(CLAIM, [1])).rows[0].r
      const second: Claimed[] = (await two.query(CLAIM, [25])).rows[0].r
      const a = mine(first, jobs).map((c) => c.job_id)
      const b = mine(second, jobs).map((c) => c.job_id)
      expect(a).toHaveLength(1)
      expect(a.filter((id) => b.includes(id))).toEqual([])
      expect(new Set([...a, ...b]).size).toBe(a.length + b.length)
    } finally {
      await one.query("rollback")
      await two.query("rollback")
      one.release()
      two.release()
    }
  })
})

describe("register / unregister", { timeout: 30_000 }, () => {
  it("an endpoint registered to B moves to A", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const endpoint = endpointOf("moved")
      await db.query(
        `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, platform)
         values ($1, $2, $3, $4, 'desktop')`,
        [f.b, endpoint, KEYS.p256dh, KEYS.auth]
      )
      await asAuthenticated(db, f.a)
      const { rows } = await db.query(REGISTER, [endpoint, KEYS, "ios"])
      expect(rows[0].r).toEqual({ registered: true })
      await db.query("reset role")
      const { rows: subs } = await db.query(
        "select user_id, platform from public.push_subscriptions where endpoint = $1",
        [endpoint]
      )
      expect(subs).toEqual([{ user_id: f.a, platform: "ios" }])
    })
  })

  it("registering again refreshes the keys and last_seen_at, one row", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const endpoint = endpointOf("again")
      await asAuthenticated(db, f.a)
      await db.query(REGISTER, [endpoint, KEYS, "android"])
      await db.query(REGISTER, [
        endpoint,
        { p256dh: "BBBB", auth: "cccc" },
        "android",
      ])
      await db.query("reset role")
      const { rows } = await db.query(
        "select p256dh, auth from public.push_subscriptions where endpoint = $1",
        [endpoint]
      )
      expect(rows).toEqual([{ p256dh: "BBBB", auth: "cccc" }])
    })
  })

  it("the admin registers her device", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      const { rows } = await db.query(REGISTER, [
        endpointOf("admin"),
        KEYS,
        "desktop",
      ])
      expect(rows[0].r).toEqual({ registered: true })
      await db.query("reset role")
      expect(await subIds(db, f.admin)).toHaveLength(1)
    })
  })

  it.each([
    ["http endpoint", "http://push.example.test/x", KEYS, "ios"],
    ["empty endpoint", "", KEYS, "ios"],
    ["endpoint with a space", "https://push.example.test/a b", KEYS, "ios"],
    [
      "long endpoint",
      `https://push.example.test/${"a".repeat(1000)}`,
      KEYS,
      "ios",
    ],
    ["no keys", "https://push.example.test/k", null, "ios"],
    [
      "keys not strings",
      "https://push.example.test/k",
      { p256dh: 1, auth: "a" },
      "ios",
    ],
    [
      "bad key characters",
      "https://push.example.test/k",
      { p256dh: "a b", auth: "a" },
      "ios",
    ],
    ["unknown platform", "https://push.example.test/k", KEYS, "windows"],
  ])("%s -> INVALID_INPUT", async (_label, endpoint, keys, platform) => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.a)
      expect(
        await queryError(db, REGISTER, [endpoint, keys, platform])
      ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      await db.query("reset role")
    })
  })

  it("unregister: someone else's endpoint -> removed 0 and it stays; her own -> removed 1", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const theirs = endpointOf("theirs")
      const own = endpointOf("own")
      await db.query(
        `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, platform)
         values ($1, $2, $4, $5, 'ios'), ($3, $6, $4, $5, 'ios')`,
        [f.b, theirs, f.a, KEYS.p256dh, KEYS.auth, own]
      )
      await asAuthenticated(db, f.a)
      expect((await db.query(UNREGISTER, [theirs])).rows[0].r).toEqual({
        removed: 0,
      })
      expect((await db.query(UNREGISTER, [own])).rows[0].r).toEqual({
        removed: 1,
      })
      await db.query("reset role")
      expect(await subIds(db, f.b)).toHaveLength(1)
      expect(await subIds(db, f.a)).toEqual([])
    })
  })

  it("deleting the Auth user deletes her subscriptions", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await addSub(db, f.a, "gone")
      await db.query("delete from auth.users where id = $1", [f.a])
      expect(await subIds(db, f.a)).toEqual([])
    })
  })
})

describe("who may call", { timeout: 30_000 }, () => {
  it("anon cannot register (42501)", async () => {
    await inRollback(async (db) => {
      await db.query(
        "select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)"
      )
      await db.query("set local role anon")
      expect(
        await queryError(db, REGISTER, [endpointOf("anon"), KEYS, "ios"])
      ).toMatchObject({ code: "42501" })
      expect(
        await queryError(db, UNREGISTER, [endpointOf("anon")])
      ).toMatchObject({ code: "42501" })
      await db.query("reset role")
    })
  })

  it("a profile that was never activated -> NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.inactive)
      expect(
        await queryError(db, REGISTER, [endpointOf("inactive"), KEYS, "ios"])
      ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      expect(
        await queryError(db, UNREGISTER, [endpointOf("inactive")])
      ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      await db.query("reset role")
    })
  })

  it("an Auth user without a profile or admin role -> NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      const stranger = (await insertAuthUser(db, "push_stranger")).id
      await asAuthenticated(db, stranger)
      expect(
        await queryError(db, REGISTER, [endpointOf("stranger"), KEYS, "ios"])
      ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      await db.query("reset role")
    })
  })

  it("authenticated cannot claim, finish or run the job (42501)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.admin)
      expect(await queryError(db, CLAIM, [25])).toMatchObject({
        code: "42501",
      })
      expect(
        await queryError(db, FINISH, [randomUUID(), [], [], null])
      ).toMatchObject({ code: "42501" })
      expect(await queryError(db, JOB)).toMatchObject({ code: "42501" })
      await db.query("reset role")
    })
  })

  it("claim as the owner without the service_role claim -> NOT_AUTHORIZED", async () => {
    await inRollback(async (db) => {
      await db.query(
        "select set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', true)"
      )
      expect(await queryError(db, CLAIM, [25])).toMatchObject({
        code: "P0001",
        message: "NOT_AUTHORIZED",
      })
    })
  })

  it("the service role cannot register or read the tables directly", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      expect(
        await queryError(db, REGISTER, [endpointOf("svc"), KEYS, "ios"])
      ).toMatchObject({ code: "42501" })
      expect(
        await queryError(db, "select 1 from public.push_subscriptions limit 1")
      ).toMatchObject({ code: "42501" })
      expect(
        await queryError(
          db,
          "select 1 from public.notification_deliveries limit 1"
        )
      ).toMatchObject({ code: "42501" })
      await db.query("reset role")
    })
  })

  it("claim rejects a limit outside 1..100", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      for (const limit of [0, 101, null]) {
        expect(await queryError(db, CLAIM, [limit])).toMatchObject({
          code: "P0001",
          message: "INVALID_INPUT",
        })
      }
      await db.query("reset role")
    })
  })
})

describe(
  "waking the worker (pg_cron, pg_net, Vault)",
  { timeout: 30_000 },
  () => {
    async function requests(db: Db): Promise<number> {
      const { rows } = await db.query(
        "select count(*)::int as n from net.http_request_queue"
      )
      return rows[0].n
    }

    it("without Vault values the job runs and makes no request", async () => {
      await inRollback(async (db) => {
        const f = await seed(db)
        await addSub(db, f.a, "s1")
        await addJob(db, f.a)
        await db.query(
          "delete from vault.secrets where name in ('app_url', 'cron_secret')"
        )
        const before = await requests(db)
        expect((await db.query(JOB)).rows[0].r).toBeNull()
        expect(await requests(db)).toBe(before)
      })
    })

    it("with Vault values: no request while nothing is ready, one POST when a job is", async () => {
      await inRollback(async (db) => {
        await db.query(
          "delete from vault.secrets where name in ('app_url', 'cron_secret')"
        )
        await db.query(
          "select vault.create_secret('https://app.example.test/', 'app_url'), vault.create_secret('test-secret', 'cron_secret')"
        )
        await isolate(db, [])
        const before = await requests(db)
        expect((await db.query(JOB)).rows[0].r).toBeNull()
        expect(await requests(db)).toBe(before)

        const f = await seed(db)
        await addJob(db, f.a)
        const id = (await db.query(JOB)).rows[0].r
        expect(id).not.toBeNull()
        const { rows } = await db.query(
          "select url, method, headers, timeout_milliseconds from net.http_request_queue where id = $1",
          [id]
        )
        expect(rows[0]).toMatchObject({
          url: "https://app.example.test/api/jobs/push",
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-secret",
          }),
          timeout_milliseconds: 10000,
        })
      })
    })

    it("cron.job has invoke_push_worker every minute", async () => {
      const rows = await sql<{ schedule: string; command: string }>(
        "select schedule, command from cron.job where jobname = 'invoke_push_worker'"
      )
      expect(rows).toEqual([
        {
          schedule: "* * * * *",
          command: "select private.job_invoke_push_worker()",
        },
      ])
    })
  }
)
