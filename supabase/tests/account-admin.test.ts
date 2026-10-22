// Story 2.8: Tal's account section. admin_issue_link('reset'), the
// two-step email change (admin_begin_email_change -> Auth ->
// admin_finish_email_change, AD-21), admin_change_phone,
// admin_get_customer_account, and the auth.users trigger that refuses an
// email or phone change Tal did not start. Auth's own update is stood in for
// by an update of auth.users as the owner (the trigger fires the same).
// Fictitious users only; everything runs in inRollback.

import { createHash, randomUUID } from "node:crypto"

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

const ISSUE = "select public.admin_issue_link('reset', $1, $2) as r"
const BEGIN = "select public.admin_begin_email_change($1, $2, $3) as r"
const FINISH = "select public.admin_finish_email_change($1, $2, $3) as r"
const PHONE = "select public.admin_change_phone($1, $2, $3) as r"
const ACCOUNT = "select public.admin_get_customer_account($1) as r"
const RESET_COMPLETE = "select public.reset_complete($1, $2) as r"

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

type Fixture = { admin: string; customer: string; email: string }

// As the owner: an admin, and an activated customer with an Auth user.
async function seed(db: Db, label = "acct"): Promise<Fixture> {
  const admin = randomUUID()
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  const user = await insertAuthUser(db, `${label}_customer`)
  await db.query(
    "insert into public.profiles (id, full_name, activated_at, phone_e164) values ($1, $2, now(), $3)",
    [user.id, testName(`${label}_customer`), randomPhone()]
  )
  return { admin, customer: user.id, email: user.email }
}

// A fictitious Israeli mobile number unlikely to clash with the dev data.
function randomPhone(): string {
  const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, "0")
  return `+97259${digits}`.slice(0, 13)
}

async function asAdmin<T>(db: Db, f: Fixture, run: () => Promise<T>) {
  await asAuthenticated(db, f.admin)
  try {
    return await run()
  } finally {
    await db.query("reset role")
  }
}

async function call(db: Db, f: Fixture, query: string, params: unknown[]) {
  return asAdmin(db, f, async () => (await db.query(query, params)).rows[0].r)
}

async function callError(db: Db, f: Fixture, query: string, params: unknown[]) {
  return asAdmin(db, f, () => queryError(db, query, params))
}

async function profile(db: Db, id: string) {
  const { rows } = await db.query(
    "select account_op_state, account_op_started_at, account_op_target_hash, phone_e164 from public.profiles where id = $1",
    [id]
  )
  return rows[0]
}

async function authEmail(db: Db, id: string): Promise<string> {
  const { rows } = await db.query(
    "select email from auth.users where id = $1",
    [id]
  )
  return rows[0].email
}

async function auditOf(db: Db, customerId: string, action: string) {
  const { rows } = await db.query(
    "select customer_id, entity_type, entity_id, before, after, row_to_json(a)::text as raw from public.audit_log a where customer_id = $1 and action = $2 order by created_at, id",
    [customerId, action]
  )
  return rows
}

// Auth's update of the email, as the owner (the trigger decides).
const AUTH_UPDATE = "update auth.users set email = $2 where id = $1"

describe("reset link from the card", () => {
  it("issues a reset link once, revokes the previous pending one, and shows its status", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const first = await call(db, f, ISSUE, [f.customer, randomUUID()])
      expect(first).toMatchObject({ reissue_required: false })
      expect(typeof first.token).toBe("string")

      expect(await call(db, f, ACCOUNT, [f.customer])).toMatchObject({
        customer_id: f.customer,
        is_activated: true,
        account_op_state: null,
        email_change_stuck: false,
        reset_link: { token_id: first.token_id, status: "pending" },
      })

      // One transaction gives both links the same now(): the first one is
      // moved a minute back, as it would be in real use.
      await db.query(
        "update public.activation_tokens set created_at = created_at - interval '1 minute' where id = $1",
        [first.token_id]
      )
      const second = await call(db, f, ISSUE, [f.customer, randomUUID()])
      const { rows } = await db.query(
        "select id, state from public.activation_tokens where id = any($1) order by created_at",
        [[first.token_id, second.token_id]]
      )
      expect(Object.fromEntries(rows.map((r) => [r.id, r.state]))).toEqual({
        [first.token_id]: "revoked",
        [second.token_id]: "pending",
      })

      // The revoke and the issue are logged with the customer, no token.
      const revoked = await auditOf(db, f.customer, "revoke_link")
      expect(revoked).toHaveLength(1)
      const issued = await auditOf(db, f.customer, "admin_issue_link")
      expect(issued).toHaveLength(2)
      for (const row of [...revoked, ...issued]) {
        expect(row.raw).not.toContain(first.token)
        expect(row.raw).not.toContain(second.token)
      }

      // The customer saves a new password with the second link.
      await asServiceRole(db)
      await db.query(RESET_COMPLETE, [second.token, randomUUID()])
      await db.query("reset role")
      const account = await call(db, f, ACCOUNT, [f.customer])
      expect(account.reset_link).toMatchObject({
        token_id: second.token_id,
        status: "consumed",
      })
      expect(account.reset_link.consumed_at).not.toBeNull()
    })
  })

  it("the same key returns the stored result without the token", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const key = randomUUID()
      const first = await call(db, f, ISSUE, [f.customer, key])
      const again = await call(db, f, ISSUE, [f.customer, key])
      expect(again).toMatchObject({
        token_id: first.token_id,
        reissue_required: true,
      })
      expect(again.token).toBeUndefined()
    })
  })

  it("an expired link shows as expired", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const issued = await call(db, f, ISSUE, [f.customer, randomUUID()])
      await db.query(
        "update public.activation_tokens set expires_at = now() - interval '1 second' where id = $1",
        [issued.token_id]
      )
      expect((await call(db, f, ACCOUNT, [f.customer])).reset_link.status).toBe(
        "expired"
      )
    })
  })

  it("refuses an admin, a not activated and a removed profile", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const other = await insertAuthUser(db, "acct_admin_target")
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
        [other.id, testName("acct_admin_target")]
      )
      await db.query("insert into public.admin_roles (user_id) values ($1)", [
        other.id,
      ])
      const inactive = randomUUID()
      const removed = randomUUID()
      await db.query(
        "insert into public.profiles (id, full_name, activated_at, anonymized_at) values ($1, $2, null, null), ($3, $4, now(), now())",
        [inactive, testName("acct_inactive"), removed, testName("acct_removed")]
      )
      for (const target of [other.id, inactive, removed]) {
        expect(
          await callError(db, f, ISSUE, [target, randomUUID()])
        ).toMatchObject({ code: "P0001", message: "RESET_TARGET_INVALID" })
      }
    })
  })
})

describe("email change", () => {
  it("begin -> Auth -> finish: the new email, state cleared, logged without the address", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const newEmail = `${testName("acct_new")}@example.test`.toLowerCase()

      const begun = await call(db, f, BEGIN, [
        f.customer,
        ` ${newEmail.toUpperCase()} `,
        randomUUID(),
      ])
      expect(begun).toEqual({ result: "pending", user_id: f.customer })
      expect(await profile(db, f.customer)).toMatchObject({
        account_op_state: "email_change_pending",
        account_op_target_hash: sha256(newEmail),
      })

      // Auth takes the address Tal started.
      await db.query(AUTH_UPDATE, [f.customer, newEmail])
      expect(await authEmail(db, f.customer)).toBe(newEmail)

      expect(
        await call(db, f, FINISH, [f.customer, true, randomUUID()])
      ).toEqual({ result: "changed" })
      expect(await profile(db, f.customer)).toMatchObject({
        account_op_state: null,
        account_op_started_at: null,
        account_op_target_hash: null,
      })

      const rows = [
        ...(await auditOf(db, f.customer, "admin_begin_email_change")),
        ...(await auditOf(db, f.customer, "admin_finish_email_change")),
      ]
      // Story 5.20 (fix 6): only the finish writes a row (the begin step
      // is technical).
      expect(rows).toHaveLength(1)
      expect(rows[0].after).toMatchObject({ email: "<changed>" })
      for (const row of rows) {
        expect(row.raw).not.toContain(newEmail)
        expect(row.raw).not.toContain(f.email)
        expect(row.raw).not.toContain(sha256(newEmail))
      }

      // Finishing again: nothing pending.
      expect(
        await call(db, f, FINISH, [f.customer, true, randomUUID()])
      ).toEqual({ result: "not_pending" })
    })
  })

  it("an email of another account or of a pending import is taken: nothing changes, no row is logged (story 5.20)", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const other = await insertAuthUser(db, "acct_other")
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
        [other.id, testName("acct_other")]
      )
      const importEmail =
        `${testName("acct_import")}@example.test`.toLowerCase()
      await db.query(
        "insert into public.profiles (id, full_name, pending_email) values ($1, $2, $3)",
        [randomUUID(), testName("acct_import"), importEmail]
      )

      for (const email of [other.email, importEmail]) {
        expect(
          await call(db, f, BEGIN, [f.customer, email, randomUUID()])
        ).toEqual({ result: "taken" })
      }
      expect((await profile(db, f.customer)).account_op_state).toBeNull()
      expect(await authEmail(db, f.customer)).toBe(f.email)

      expect(
        await auditOf(db, f.customer, "admin_begin_email_change")
      ).toHaveLength(0)
    })
  })

  it("her own email is EMAIL_UNCHANGED; a bad address is INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await callError(db, f, BEGIN, [
          f.customer,
          f.email.toUpperCase(),
          randomUUID(),
        ])
      ).toMatchObject({ code: "P0001", message: "EMAIL_UNCHANGED" })
      expect(
        await callError(db, f, BEGIN, [
          f.customer,
          "not-an-email",
          randomUUID(),
        ])
      ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
    })
  })

  it("Auth's email_exists: finish(false) clears the state and logs the block", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const newEmail = `${testName("acct_clash")}@example.test`.toLowerCase()
      await call(db, f, BEGIN, [f.customer, newEmail, randomUUID()])
      expect(
        await call(db, f, FINISH, [f.customer, false, randomUUID()])
      ).toEqual({ result: "taken" })
      expect((await profile(db, f.customer)).account_op_state).toBeNull()
      const rows = await auditOf(db, f.customer, "admin_finish_email_change")
      expect(rows).toHaveLength(1)
      expect(rows[0].after).toMatchObject({ result: "taken" })
    })
  })

  it("finish(true) while Auth still has the old address is CONCURRENT_CHANGE and keeps the state", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const newEmail = `${testName("acct_lag")}@example.test`.toLowerCase()
      await call(db, f, BEGIN, [f.customer, newEmail, randomUUID()])
      expect(
        await callError(db, f, FINISH, [f.customer, true, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "CONCURRENT_CHANGE" })
      expect((await profile(db, f.customer)).account_op_state).toBe(
        "email_change_pending"
      )
    })
  })

  it("stuck after 15 minutes; saving the same email again resumes", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const newEmail = `${testName("acct_stuck")}@example.test`.toLowerCase()
      await call(db, f, BEGIN, [f.customer, newEmail, randomUUID()])

      await db.query(
        "update public.profiles set account_op_started_at = now() - interval '14 minutes' where id = $1",
        [f.customer]
      )
      expect(
        (await call(db, f, ACCOUNT, [f.customer])).email_change_stuck
      ).toBe(false)
      await db.query(
        "update public.profiles set account_op_started_at = now() - interval '16 minutes' where id = $1",
        [f.customer]
      )
      expect(await call(db, f, ACCOUNT, [f.customer])).toMatchObject({
        account_op_state: "email_change_pending",
        email_change_stuck: true,
      })

      // Auth already took it before the crash: the same address resumes.
      await db.query(AUTH_UPDATE, [f.customer, newEmail])
      expect(
        await call(db, f, BEGIN, [f.customer, newEmail, randomUUID()])
      ).toEqual({ result: "pending", user_id: f.customer })
      expect(
        await call(db, f, FINISH, [f.customer, true, randomUUID()])
      ).toEqual({ result: "changed" })
    })
  })

  it("refuses an admin and a not activated profile", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const inactive = randomUUID()
      await db.query(
        "insert into public.profiles (id, full_name) values ($1, $2)",
        [inactive, testName("acct_inactive_email")]
      )
      for (const target of [f.admin, inactive]) {
        expect(
          await callError(db, f, BEGIN, [
            target,
            `${testName("acct_x")}@example.test`,
            randomUUID(),
          ])
        ).toMatchObject({ code: "P0001", message: "CUSTOMER_NOT_AVAILABLE" })
      }
    })
  })
})

describe("phone change", () => {
  it("changes the phone, normalized, audited as <changed>", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const phone = randomPhone()
      const local = `0${phone.slice(4, 6)}-${phone.slice(6)}`
      expect(
        await call(db, f, PHONE, [f.customer, local, randomUUID()])
      ).toEqual({ result: "changed" })
      expect((await profile(db, f.customer)).phone_e164).toBe(phone)
      const rows = await auditOf(db, f.customer, "admin_change_phone")
      expect(rows).toHaveLength(1)
      expect(rows[0].after).toEqual({ phone_e164: "<changed>" })
      expect(rows[0].raw).not.toContain(phone)
    })
  })

  it("a number of another account is taken: nothing changes, a row is logged", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const taken = randomPhone()
      await db.query(
        "insert into public.profiles (id, full_name, activated_at, phone_e164) values ($1, $2, now(), $3)",
        [randomUUID(), testName("acct_phone_other"), taken]
      )
      const before = (await profile(db, f.customer)).phone_e164
      expect(
        await call(db, f, PHONE, [f.customer, taken, randomUUID()])
      ).toEqual({ result: "taken" })
      expect((await profile(db, f.customer)).phone_e164).toBe(before)
      const rows = await auditOf(db, f.customer, "admin_change_phone")
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ after: { result: "taken" } })
      expect(rows[0].raw).not.toContain(taken)
    })
  })

  it("INVALID_PHONE and PHONE_UNCHANGED", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      const current = (await profile(db, f.customer)).phone_e164
      expect(
        await callError(db, f, PHONE, [f.customer, "12", randomUUID()])
      ).toMatchObject({ code: "P0001", message: "INVALID_PHONE" })
      expect(
        await callError(db, f, PHONE, [f.customer, current, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "PHONE_UNCHANGED" })
      expect(
        await callError(db, f, PHONE, [f.admin, randomPhone(), randomUUID()])
      ).toMatchObject({ code: "P0001", message: "CUSTOMER_NOT_AVAILABLE" })
    })
  })
})

describe("no self change", () => {
  it("an email change Tal did not start is refused in auth.users", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await queryError(db, AUTH_UPDATE, [
          f.customer,
          `${testName("acct_self")}@example.test`,
        ])
      ).toMatchObject({ code: "P0001", message: "ACCOUNT_CHANGE_BLOCKED" })
      expect(
        await queryError(
          db,
          "update auth.users set email_change = $2 where id = $1",
          [f.customer, `${testName("acct_self2")}@example.test`]
        )
      ).toMatchObject({ code: "P0001", message: "ACCOUNT_CHANGE_BLOCKED" })

      // Started by Tal for one address: another address is still refused.
      await call(db, f, BEGIN, [
        f.customer,
        `${testName("acct_started")}@example.test`,
        randomUUID(),
      ])
      expect(
        await queryError(db, AUTH_UPDATE, [
          f.customer,
          `${testName("acct_other_target")}@example.test`,
        ])
      ).toMatchObject({ code: "P0001", message: "ACCOUNT_CHANGE_BLOCKED" })
      expect(await authEmail(db, f.customer)).toBe(f.email)
    })
  })

  it("a phone change in auth.users is always refused; other updates pass", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      expect(
        await queryError(db, "update auth.users set phone = $2 where id = $1", [
          f.customer,
          "972591234567",
        ])
      ).toMatchObject({ code: "P0001", message: "ACCOUNT_CHANGE_BLOCKED" })
      expect(
        await queryError(
          db,
          "update auth.users set last_sign_in_at = now(), encrypted_password = 'x' where id = $1",
          [f.customer]
        )
      ).toBeNull()
    })
  })

  it("the SQL Editor switch lets an admin's own email change", async () => {
    await inRollback(async (db) => {
      const admin = await insertAuthUser(db, "acct_admin_self")
      await db.query("insert into public.admin_roles (user_id) values ($1)", [
        admin.id,
      ])
      const next = `${testName("acct_admin_next")}@example.test`
      expect(await queryError(db, AUTH_UPDATE, [admin.id, next])).toMatchObject(
        { message: "ACCOUNT_CHANGE_BLOCKED" }
      )
      await db.query("set local app.allow_auth_identity_change = 'on'")
      expect(await queryError(db, AUTH_UPDATE, [admin.id, next])).toBeNull()
    })
  })

  it("a customer cannot write her phone or the account state in profiles", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.customer)
      for (const text of [
        "update public.profiles set phone_e164 = '+972591111111' where id = $1",
        "update public.profiles set account_op_state = 'email_change_pending' where id = $1",
      ]) {
        expect(await queryError(db, text, [f.customer])).toMatchObject({
          code: "42501",
        })
      }
    })
  })
})

describe("permissions", () => {
  it("a customer gets NOT_AUTHORIZED on every account RPC", async () => {
    await inRollback(async (db) => {
      const f = await seed(db)
      await asAuthenticated(db, f.customer)
      for (const [text, params] of [
        [ISSUE, [f.customer, randomUUID()]],
        [BEGIN, [f.customer, "a@example.test", randomUUID()]],
        [FINISH, [f.customer, true, randomUUID()]],
        [PHONE, [f.customer, randomPhone(), randomUUID()]],
        [ACCOUNT, [f.customer]],
      ] as const) {
        expect(await queryError(db, text, [...params])).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
    })
  })
})
