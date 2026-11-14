// Story 6.11: our own email verification record and what reads and writes
// it. private.email_verifications binds a user to the hash of the email
// that was verified, so any change of the Auth email un-verifies by itself.
// Covers our one-time token (request_email_verification /
// consume_email_verification), get_my_email_verified,
// get_email_reset_eligibility (the forgot-password matrix), the Send Email
// Hook, admin_get_customer's email_verified, the removal of details
// deleting the record, the customer's own email change (service_role,
// begin_my_email_change / finish_my_email_change), and who may call what.
// Auth's own update is stood in for by an update of auth.users as the
// owner (the guard trigger fires the same). Emails: pg_net sends a request
// only after its transaction commits, and every test here rolls back, so
// nothing is ever sent; a Resend key is put in Vault only inside the
// transaction. Fictitious users only.

import { randomBytes, randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  insertAuthUser,
  queryError,
  testName,
  type Db,
} from "./support/db"

const REQUEST = "select public.request_email_verification($1, $2) as r"
const CONSUME = "select public.consume_email_verification($1, $2) as r"
const ELIGIBILITY = "select public.get_email_reset_eligibility($1) as r"
const MINE = "select public.get_my_email_verified() as r"
const HOOK = "select public.send_email_hook($1::jsonb) as r"
const BEGIN = "select public.begin_my_email_change($1, $2, $3) as r"
const FINISH = "select public.finish_my_email_change($1, $2, $3) as r"
const CARD = "select public.admin_get_customer($1) as r"
const ANONYMIZE = "select public.admin_anonymize_customer($1, true, $2) as r"
const SITE = "https://site.example.test"

// As the owner: an activated customer with an Auth user.
async function customer(db: Db, label: string) {
  const user = await insertAuthUser(db, label)
  await db.query(
    "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
    [user.id, testName(label)]
  )
  return user
}

async function admin(db: Db, label: string) {
  const user = await insertAuthUser(db, label)
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    user.id,
  ])
  return user
}

async function asService<T>(db: Db, run: () => Promise<T>): Promise<T> {
  await asServiceRole(db)
  try {
    return await run()
  } finally {
    await db.query("reset role")
  }
}

async function as<T>(db: Db, userId: string, run: () => Promise<T>) {
  await asAuthenticated(db, userId)
  try {
    return await run()
  } finally {
    await db.query("reset role")
  }
}

const rawToken = () => randomBytes(32).toString("base64url")

// As the owner: a token for the user's current address, as
// request_email_verification stores it (the raw value is known here only).
async function issueToken(
  db: Db,
  userId: string,
  { expiresIn = "1 hour" }: { expiresIn?: string } = {}
): Promise<string> {
  const raw = rawToken()
  await db.query(
    `insert into private.email_verification_tokens (token_hash, user_id, email_hash, expires_at)
     select private.token_hash($1), u.id, private.email_hash(u.email), now() + $3::interval
     from auth.users u where u.id = $2`,
    [raw, userId, expiresIn]
  )
  return raw
}

// The browser session's user id the server passes: by default the token's
// own user (as the owner reads it), a random id for an unknown token.
async function sessionFor(db: Db, raw: string | null): Promise<string> {
  const { rows } = await db.query(
    "select user_id from private.email_verification_tokens where token_hash = private.token_hash($1)",
    [raw ?? ""]
  )
  return rows[0]?.user_id ?? randomUUID()
}

async function consume(db: Db, raw: string, sessionUserId?: string) {
  const session = sessionUserId ?? (await sessionFor(db, raw))
  return asService(
    db,
    async () => (await db.query(CONSUME, [raw, session])).rows[0].r
  )
}

async function consumeError(
  db: Db,
  raw: string | null,
  sessionUserId?: string | null
) {
  const session =
    sessionUserId === undefined ? await sessionFor(db, raw) : sessionUserId
  return asService(db, () => queryError(db, CONSUME, [raw, session]))
}

async function verify(db: Db, userId: string) {
  return consume(db, await issueToken(db, userId))
}

const request = (db: Db, userId: string) =>
  asService(db, async () => (await db.query(REQUEST, [userId, SITE])).rows[0].r)

const eligibility = (db: Db, email: string) =>
  asService(db, async () => (await db.query(ELIGIBILITY, [email])).rows[0].r)

const mine = (db: Db, userId: string) =>
  as(db, userId, async () => (await db.query(MINE)).rows[0].r)

// Auth changes the email (the trigger is bypassed as in the SQL Editor).
async function authChangesEmail(db: Db, userId: string, email: string) {
  await db.query("set local app.allow_auth_identity_change = 'on'")
  await db.query("update auth.users set email = $2 where id = $1", [
    userId,
    email,
  ])
  await db.query("set local app.allow_auth_identity_change = 'off'")
}

// As the owner, inside the transaction only: a Resend key in Vault, or none.
async function setResendKey(db: Db, present: boolean) {
  await db.query("delete from vault.secrets where name = 'resend_api_key'")
  if (present) {
    await db.query(
      "select vault.create_secret('re_test_not_a_real_key', 'resend_api_key')"
    )
  }
}

// As the owner, inside the transaction only: Vault site_url (the reset
// link's base), or none.
async function setSiteUrl(db: Db, value: string | null) {
  await db.query("delete from vault.secrets where name = 'site_url'")
  if (value) {
    await db.query("select vault.create_secret($1, 'site_url')", [value])
  }
}

// The emails this transaction queued: the pg_net requests whose ids
// private.send_email recorded.
async function queuedEmails(db: Db) {
  const { rows } = await db.query(
    `select q.url, convert_from(q.body, 'UTF8')::jsonb as body
     from net.http_request_queue q
     join private.email_requests e on e.request_id = q.id
     order by q.id`
  )
  return rows as {
    url: string
    body: { to: string[]; html: string; subject: string; from: string }
  }[]
}

describe("our verification token", () => {
  it("consume records the current email; any change of the email un-verifies", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_record")
      expect(await mine(db, c.id)).toEqual({ verified: false })

      expect(await verify(db, c.id)).toEqual({ is_admin: false })
      expect(await mine(db, c.id)).toEqual({ verified: true })

      await authChangesEmail(db, c.id, `${testName("ev_other")}@example.test`)
      expect(await mine(db, c.id)).toEqual({ verified: false })

      // Verifying again records the new address (an upsert, no duplicate).
      await verify(db, c.id)
      expect(await mine(db, c.id)).toEqual({ verified: true })
      const { rows } = await db.query(
        "select count(*)::int as n from private.email_verifications where user_id = $1",
        [c.id]
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("is single use, expires, and is refused when unknown or malformed", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_once")
      const raw = await issueToken(db, c.id)
      await consume(db, raw)
      expect(await consumeError(db, raw)).toMatchObject({
        code: "P0001",
        message: "LINK_INVALID",
      })

      const expired = await issueToken(db, c.id, { expiresIn: "-1 second" })
      expect(await consumeError(db, expired)).toMatchObject({
        message: "LINK_INVALID",
      })
      for (const bad of [rawToken(), "short", "bad token!", null]) {
        expect(await consumeError(db, bad)).toMatchObject({
          message: "LINK_INVALID",
        })
      }
    })
  })

  it("only the token's own account verifies; another session leaves it unused", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_own_session")
      const other = await customer(db, "ev_other_session")
      const raw = await issueToken(db, c.id)
      for (const session of [other.id, null]) {
        expect(await consumeError(db, raw, session)).toMatchObject({
          message: "LINK_INVALID",
        })
      }
      const { rows } = await db.query(
        "select used_at from private.email_verification_tokens where token_hash = private.token_hash($1)",
        [raw]
      )
      expect(rows[0].used_at).toBeNull()
      expect(await mine(db, other.id)).toEqual({ verified: false })
      // The right account still can.
      expect(await consume(db, raw, c.id)).toEqual({ is_admin: false })
    })
  })

  it("an old link never verifies a new address", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_moved_link")
      const raw = await issueToken(db, c.id)
      await authChangesEmail(
        db,
        c.id,
        `${testName("ev_moved_link_new")}@example.test`
      )
      expect(await consumeError(db, raw)).toMatchObject({
        message: "LINK_INVALID",
      })
      expect(await mine(db, c.id)).toEqual({ verified: false })
      const { rows } = await db.query(
        "select count(*)::int as n from private.email_verifications where user_id = $1",
        [c.id]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("tells the caller when the user is an admin", async () => {
    await inRollback(async (db) => {
      const a = await admin(db, "ev_admin")
      expect(await verify(db, a.id)).toEqual({ is_admin: true })
      expect(await mine(db, a.id)).toEqual({ verified: true })
    })
  })

  it("request: voids her earlier tokens, stores only a hash, and sends the link", async () => {
    await inRollback(async (db) => {
      await setResendKey(db, true)
      const c = await customer(db, "ev_request")
      const earlier = await issueToken(db, c.id)

      expect(await request(db, c.id)).toEqual({ sent: true })

      const { rows } = await db.query(
        "select token_hash, used_at, expires_at - created_at as ttl from private.email_verification_tokens where user_id = $1 order by created_at, used_at nulls last",
        [c.id]
      )
      const live = rows.filter((r) => r.used_at === null)
      expect(live).toHaveLength(1)
      expect(live[0].ttl).toMatchObject({ hours: 1 })
      expect(await consumeError(db, earlier)).toMatchObject({
        message: "LINK_INVALID",
      })

      const emails = await queuedEmails(db)
      expect(emails).toHaveLength(1)
      expect(emails[0].url).toBe("https://api.resend.com/emails")
      expect(emails[0].body.to).toEqual([c.email])
      expect(emails[0].body.from).toBe(
        "בראנץ׳ אצל טל <noreply@morethanfood.co.il>"
      )
      const link = /href="([^"]+)"/.exec(emails[0].body.html)?.[1] ?? ""
      expect(link.startsWith(`${SITE}/verify-email?token=`)).toBe(true)
      const raw = link.slice(`${SITE}/verify-email?token=`.length)
      // The raw token is stored only as its hash; it verifies once.
      const { rows: stored } = await db.query(
        "select count(*)::int as n from private.email_verification_tokens where token_hash = private.token_hash($1)",
        [raw]
      )
      expect(stored[0].n).toBe(1)
      expect(JSON.stringify(rows)).not.toContain(raw)
      expect(await consume(db, raw)).toEqual({ is_admin: false })
    })
  })

  it("request: deletes her used and expired tokens", async () => {
    await inRollback(async (db) => {
      await setResendKey(db, true)
      const c = await customer(db, "ev_request_clean")
      await consume(db, await issueToken(db, c.id))
      // Verified now; un-verify by a new address, and leave an expired token.
      await authChangesEmail(
        db,
        c.id,
        `${testName("ev_clean_new")}@example.test`
      )
      await issueToken(db, c.id, { expiresIn: "-1 second" })
      expect(await request(db, c.id)).toEqual({ sent: true })
      const { rows } = await db.query(
        "select count(*)::int as n, (count(*) filter (where used_at is null and expires_at > now()))::int as live from private.email_verification_tokens where user_id = $1",
        [c.id]
      )
      expect(rows[0]).toEqual({ n: 1, live: 1 })
    })
  })

  it("consume refuses while her details are removed or being removed", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_consume_removing")
      const raw = await issueToken(db, c.id)
      await db.query(
        "update public.profiles set account_op_state = 'anonymization_pending', account_op_started_at = now() where id = $1",
        [c.id]
      )
      expect(await consumeError(db, raw)).toMatchObject({
        message: "LINK_INVALID",
      })
      const { rows } = await db.query(
        "select count(*)::int as n from private.email_verifications where user_id = $1",
        [c.id]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("request: nothing when already verified, and no request without a key", async () => {
    await inRollback(async (db) => {
      await setResendKey(db, true)
      const c = await customer(db, "ev_request_noop")
      await verify(db, c.id)
      expect(await request(db, c.id)).toEqual({
        sent: false,
        reason: "verified",
      })
      expect(await queuedEmails(db)).toEqual([])

      await setResendKey(db, false)
      const other = await customer(db, "ev_request_nokey")
      expect(await request(db, other.id)).toEqual({ sent: false })
      expect(await queuedEmails(db)).toEqual([])
    })
  })

  it("request: refuses a bad site URL and an unknown user", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_request_bad")
      await asServiceRole(db)
      expect(
        await queryError(db, REQUEST, [c.id, "javascript:alert(1)"])
      ).toMatchObject({ message: "INVALID_INPUT" })
      expect(await queryError(db, REQUEST, [randomUUID(), SITE])).toMatchObject(
        { message: "NOT_FOUND" }
      )
    })
  })

  it("normalizes one way everywhere (private.email_hash)", async () => {
    await inRollback(async (db) => {
      const { rows } = await db.query(
        "select private.email_hash('  Foo@X.com ') = private.email_hash('foo@x.com') as same"
      )
      expect(rows[0].same).toBe(true)

      const c = await customer(db, "ev_case")
      await verify(db, c.id)
      await authChangesEmail(db, c.id, `  ${c.email.toUpperCase()} `)
      expect(await mine(db, c.id)).toEqual({ verified: true })
    })
  })
})

describe("get_email_reset_eligibility (forgot password)", () => {
  it("is eligible only for a verified, activated customer or admin", async () => {
    await inRollback(async (db) => {
      const verified = await customer(db, "ev_ok")
      await verify(db, verified.id)
      const unverified = await customer(db, "ev_unverified")
      const adminUser = await admin(db, "ev_admin_ok")
      await verify(db, adminUser.id)

      const notActive = await insertAuthUser(db, "ev_not_active")
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, null)",
        [notActive.id, testName("ev_not_active")]
      )
      await verify(db, notActive.id)

      const removed = await insertAuthUser(db, "ev_removed")
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
        [removed.id, testName("ev_removed")]
      )
      // Verified before the removal (a token is refused after it).
      await verify(db, removed.id)
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [removed.id]
      )

      // An Auth user with no profile and no admin role.
      const bare = await insertAuthUser(db, "ev_bare")
      await verify(db, bare.id)

      const moved = await customer(db, "ev_moved")
      await verify(db, moved.id)
      const movedTo = `${testName("ev_moved_to")}@example.test`.toLowerCase()
      await authChangesEmail(db, moved.id, movedTo)

      const cases: [string, string | null, boolean][] = [
        [verified.email, verified.id, true],
        [` ${verified.email.toUpperCase()} `, verified.id, true],
        [adminUser.email, adminUser.id, true],
        [unverified.email, unverified.id, false],
        [notActive.email, notActive.id, false],
        [removed.email, removed.id, false],
        [bare.email, bare.id, false],
        [movedTo, moved.id, false],
        [`${testName("ev_unknown")}@example.test`, null, false],
      ]
      for (const [email, userId, eligible] of cases) {
        expect(await eligibility(db, email), email).toEqual({
          user_id: userId,
          eligible,
        })
      }
    })
    // Many round trips to the remote pooler.
  }, 60_000)

  it("refuses an empty address", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      expect(await queryError(db, ELIGIBILITY, ["  "])).toMatchObject({
        code: "P0001",
        message: "INVALID_INPUT",
      })
    })
  })
})

describe("the Send Email Hook", () => {
  const event = (userId: string, type: string) => ({
    user: { id: userId, email: "ignored@example.test" },
    email_data: {
      email_action_type: type,
      token: "123456",
      token_hash: "a".repeat(56),
      // Auth's own API address: never used for the link.
      site_url: "https://ref.supabase.co/auth/v1",
      redirect_to: "https://evil.example.test",
    },
  })

  const hook = async (db: Db, payload: unknown) =>
    (await db.query(HOOK, [JSON.stringify(payload)])).rows[0].r

  // Every hook test starts with an empty throttle (inside the transaction).
  const ready = async (db: Db) => {
    await setResendKey(db, true)
    await setSiteUrl(db, "https://site.example.test/")
    await db.query("delete from private.email_hook_sends")
  }

  it("sends only recovery, only to a verified, eligible account", async () => {
    await inRollback(async (db) => {
      await ready(db)
      const ok = await customer(db, "ev_hook_ok")
      await verify(db, ok.id)
      const unverified = await customer(db, "ev_hook_unverified")
      const adminUser = await admin(db, "ev_hook_admin")
      await verify(db, adminUser.id)

      // Every other type is dropped, even for an eligible account.
      for (const type of [
        "magiclink",
        "signup",
        "invite",
        "email_change",
        "email_change_new",
        "reauthentication",
        "email",
      ]) {
        expect(await hook(db, event(ok.id, type))).toEqual({})
      }
      expect(await hook(db, event(unverified.id, "recovery"))).toEqual({})
      expect(await hook(db, event(randomUUID(), "recovery"))).toEqual({})
      expect(await hook(db, { nonsense: true })).toEqual({})
      expect(await queuedEmails(db)).toEqual([])

      expect(await hook(db, event(ok.id, "recovery"))).toEqual({})
      expect(await hook(db, event(adminUser.id, "recovery"))).toEqual({})
      const emails = await queuedEmails(db)
      expect(emails.map((e) => e.body.to)).toEqual([
        [ok.email],
        [adminUser.email],
      ])
      // The link is built from Vault site_url and token_hash, never from
      // the payload's site_url or redirect_to.
      const link = /href="([^"]+)"/.exec(emails[0].body.html)?.[1]
      expect(link).toBe(
        `https://site.example.test/reset-password?token_hash=${"a".repeat(56)}`
      )
      expect(emails[0].body.html).not.toContain("evil.example.test")
      // The header image may be served from Supabase Storage; no link may.
      expect(emails[0].body.html).not.toMatch(/href="[^"]*supabase\.co/)
      expect(emails[0].body.subject).toBe("קישור לאיפוס סיסמה")
    })
  })

  it("sends nothing without a Resend key, and still answers {}", async () => {
    await inRollback(async (db) => {
      await ready(db)
      await setResendKey(db, false)
      const ok = await customer(db, "ev_hook_nokey")
      await verify(db, ok.id)
      expect(await hook(db, event(ok.id, "recovery"))).toEqual({})
      expect(await queuedEmails(db)).toEqual([])
    })
  })

  it("sends nothing without Vault site_url (the payload's is never used)", async () => {
    await inRollback(async (db) => {
      await ready(db)
      await setSiteUrl(db, null)
      const ok = await customer(db, "ev_hook_nosite")
      await verify(db, ok.id)
      expect(await hook(db, event(ok.id, "recovery"))).toEqual({})
      expect(await queuedEmails(db)).toEqual([])
    })
  })

  it("at most 3 per user in an hour; older sends no longer count", async () => {
    await inRollback(async (db) => {
      await ready(db)
      const ok = await customer(db, "ev_hook_user_cap")
      await verify(db, ok.id)
      for (let i = 0; i < 4; i++) {
        expect(await hook(db, event(ok.id, "recovery"))).toEqual({})
      }
      expect(await queuedEmails(db)).toHaveLength(3)

      // An hour later the user may get one again (the old rows are pruned).
      await db.query(
        "update private.email_hook_sends set sent_at = sent_at - interval '61 minutes'"
      )
      await hook(db, event(ok.id, "recovery"))
      expect(await queuedEmails(db)).toHaveLength(4)
      const { rows } = await db.query(
        "select count(*)::int as n from private.email_hook_sends"
      )
      expect(rows[0].n).toBe(1)
    })
  }, 60_000)

  it("at most 20 per project in an hour", async () => {
    await inRollback(async (db) => {
      await ready(db)
      for (let u = 0; u < 7; u++) {
        const c = await customer(db, `ev_hook_project_${u}`)
        await verify(db, c.id)
        for (let i = 0; i < 3; i++) await hook(db, event(c.id, "recovery"))
      }
      expect(await queuedEmails(db)).toHaveLength(20)
    })
  }, 120_000)
})

describe("who may call", () => {
  it("the service-role RPCs refuse authenticated and anon", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_grants")
      const calls = [
        [REQUEST, [c.id, SITE]],
        [CONSUME, [rawToken(), c.id]],
        [ELIGIBILITY, [c.email]],
        [BEGIN, [c.id, "a@example.test", randomUUID()]],
        [FINISH, [c.id, true, randomUUID()]],
        [HOOK, ["{}"]],
      ] as const
      await asAuthenticated(db, c.id)
      for (const [query, params] of calls) {
        expect(await queryError(db, query, [...params]), query).toMatchObject({
          code: "42501",
        })
      }
      await db.query("reset role")
      await db.query("set local role anon")
      for (const [query, params] of [...calls, [MINE, []] as const]) {
        expect(await queryError(db, query, [...params]), query).toMatchObject({
          code: "42501",
        })
      }
    })
  })

  it("the hook is not callable by the service role", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      expect(await queryError(db, HOOK, ["{}"])).toMatchObject({
        code: "42501",
      })
    })
  })

  it("get_my_email_verified is for a signed-in user only", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      expect(await queryError(db, MINE)).toMatchObject({ code: "42501" })
    })
  })

  it("the private tables are not readable by the API roles", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_table")
      await asAuthenticated(db, c.id)
      for (const table of [
        "private.email_verifications",
        "private.email_verification_tokens",
        "private.email_requests",
      ]) {
        expect(
          await queryError(db, `select * from ${table}`),
          table
        ).toMatchObject({ code: "42501" })
      }
    })
  })
})

describe("Tal's card and the removal of details", () => {
  it("admin_get_customer says whether the email is verified", async () => {
    await inRollback(async (db) => {
      const a = await admin(db, "ev_card_admin")
      const c = await customer(db, "ev_card")
      const card = () =>
        as(db, a.id, async () => (await db.query(CARD, [c.id])).rows[0].r)
      expect((await card()).profile.email_verified).toBe(false)
      await verify(db, c.id)
      expect((await card()).profile.email_verified).toBe(true)
    })
  })

  it("admin_anonymize_customer deletes the record and her tokens", async () => {
    await inRollback(async (db) => {
      const a = await admin(db, "ev_anon_admin")
      const c = await customer(db, "ev_anon")
      await verify(db, c.id)
      await issueToken(db, c.id)
      await as(db, a.id, () => db.query(ANONYMIZE, [c.id, randomUUID()]))
      const { rows } = await db.query(
        "select (select count(*)::int from private.email_verifications where user_id = $1) as n, (select count(*)::int from private.email_verification_tokens where user_id = $1) as t",
        [c.id]
      )
      expect(rows[0]).toEqual({ n: 0, t: 0 })
    })
  })
})

describe("her own email change (service_role, after the password check)", () => {
  const begin = (db: Db, userId: string, email: string, key = randomUUID()) =>
    asService(
      db,
      async () => (await db.query(BEGIN, [userId, email, key])).rows[0].r
    )
  const beginError = (db: Db, userId: string, email: string) =>
    asService(db, () => queryError(db, BEGIN, [userId, email, randomUUID()]))
  const finish = (db: Db, userId: string, succeeded: boolean) =>
    asService(
      db,
      async () =>
        (await db.query(FINISH, [userId, succeeded, randomUUID()])).rows[0].r
    )

  it("begin -> Auth -> finish: changed, logged by the customer, un-verified", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_self")
      await verify(db, c.id)
      const next = `${testName("ev_self_new")}@example.test`.toLowerCase()

      expect(await begin(db, c.id, next)).toEqual({
        result: "pending",
        user_id: c.id,
      })

      // Auth's update: the trigger accepts it for the pending hash.
      await db.query("update auth.users set email = $2 where id = $1", [
        c.id,
        next,
      ])

      expect(await finish(db, c.id, true)).toEqual({ result: "changed" })

      const { rows: profile } = await db.query(
        "select account_op_state from public.profiles where id = $1",
        [c.id]
      )
      expect(profile[0].account_op_state).toBeNull()

      const { rows: audit } = await db.query(
        "select actor_kind, actor_id, row_to_json(a)::text as raw from public.audit_log a where customer_id = $1 and action = 'finish_my_email_change'",
        [c.id]
      )
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({ actor_kind: "customer", actor_id: c.id })
      expect(audit[0].raw).not.toContain(next)

      expect(await mine(db, c.id)).toEqual({ verified: false })
    })
  })

  it("taken, unchanged, malformed, and a user who is not an active customer", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_self_taken")
      const other = await customer(db, "ev_self_other")

      expect(await begin(db, c.id, other.email)).toEqual({ result: "taken" })
      expect(await beginError(db, c.id, c.email.toUpperCase())).toMatchObject({
        code: "P0001",
        message: "EMAIL_UNCHANGED",
      })
      expect(await beginError(db, c.id, "not-an-email")).toMatchObject({
        message: "INVALID_INPUT",
      })

      const a = await admin(db, "ev_self_admin")
      const inactive = await insertAuthUser(db, "ev_self_inactive")
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, null)",
        [inactive.id, testName("ev_self_inactive")]
      )
      for (const userId of [a.id, inactive.id, randomUUID()]) {
        expect(await beginError(db, userId, "x@example.test")).toMatchObject({
          message: "NOT_AUTHORIZED",
        })
      }
      expect(await finish(db, inactive.id, true)).toEqual({
        result: "not_pending",
      })
    })
  })

  it("resumes the same pending change; refuses a foreign pending one", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_self_pending")
      const next = `${testName("ev_self_pending_new")}@example.test`
      expect(await begin(db, c.id, next)).toMatchObject({ result: "pending" })
      // The same address again (a crash between the steps): resume.
      expect(await begin(db, c.id, next)).toEqual({
        result: "pending",
        user_id: c.id,
      })
      // Another address while that change (or Tal's) is pending.
      expect(
        await beginError(
          db,
          c.id,
          `${testName("ev_self_other_new")}@example.test`
        )
      ).toMatchObject({ message: "ACCOUNT_CHANGE_BLOCKED" })
    })
  })

  it("finish(true) while Auth does not hold the new address: CONCURRENT_CHANGE; finish(false) closes it", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_self_concurrent")
      await begin(db, c.id, `${testName("ev_self_conc_new")}@example.test`)
      expect(
        await asService(db, () =>
          queryError(db, FINISH, [c.id, true, randomUUID()])
        )
      ).toMatchObject({ message: "CONCURRENT_CHANGE" })
      expect(await finish(db, c.id, false)).toEqual({ result: "taken" })
      const { rows } = await db.query(
        "select account_op_state from public.profiles where id = $1",
        [c.id]
      )
      expect(rows[0].account_op_state).toBeNull()
    })
  })

  it("the same key returns the stored answer", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_self_key")
      const next = `${testName("ev_self_key_new")}@example.test`
      const key = randomUUID()
      const first = await begin(db, c.id, next, key)
      expect(await begin(db, c.id, next, key)).toEqual(first)
    })
  })

  it("the trigger still refuses an email change she did not begin", async () => {
    await inRollback(async (db) => {
      const c = await customer(db, "ev_self_guard")
      expect(
        await queryError(db, "update auth.users set email = $2 where id = $1", [
          c.id,
          `${testName("ev_self_guard_new")}@example.test`,
        ])
      ).toMatchObject({ code: "P0001", message: "ACCOUNT_CHANGE_BLOCKED" })
    })
  })
})
