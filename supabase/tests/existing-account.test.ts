// Story 2.3: existing account and identity conflicts (AD-3, AD-10).
// private.find_identity (as the owner), join_begin's split into
// existing_account and conflict, claim_join and the new checks, along the
// I/O matrix of the spec. Auth users are rows inserted in auth.users inside
// the rolled-back transaction.

import { randomUUID } from "node:crypto"

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
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const BEGIN = "select public.join_begin($1, $2, $3, $4) as r"
const COMPLETE = "select public.join_complete($1, $2::jsonb, $3) as r"
const VIEW = "select public.token_view($1) as r"
const CLAIM = "select public.claim_join($1, $2) as r"
const FIND = "select private.find_identity($1, $2) as r"

type Approved = {
  f: MoneyFixture
  token: string
  tokenId: string
  paymentId: string
}

// As the owner on return.
async function approveCard(db: Db): Promise<Approved> {
  const f = await seedMoney(db)
  await asAuthenticated(db, f.admin)
  const r = await approve(db, {
    productId: f.card,
    amount: 47200,
    paidOn: f.today,
    methodId: f.method,
    key: randomUUID(),
  })
  await db.query("reset role")
  return {
    f,
    token: r.token as string,
    tokenId: r.token_id as string,
    paymentId: r.payment_id as string,
  }
}

let phoneCounter = 0
function testPhone(): string {
  phoneCounter++
  const digits = (parseInt(testName("").slice(5, 11), 16) + phoneCounter)
    .toString()
    .padStart(7, "0")
    .slice(-7)
  return `058${digits}`
}

function e164(local: string): string {
  return `+972${local.slice(1)}`
}

function freshEmail(label: string): string {
  return `${testName(label)}@example.test`.toLowerCase()
}

async function call(db: Db, query: string, params: unknown[]) {
  await asServiceRole(db)
  const { rows } = await db.query(query, params)
  await db.query("reset role")
  return rows[0].r as Record<string, unknown>
}

async function callError(db: Db, query: string, params: unknown[]) {
  await asServiceRole(db)
  const error = await queryError(db, query, params)
  await db.query("reset role")
  return error
}

async function claimAs(db: Db, userId: string, token: string, key: string) {
  await asAuthenticated(db, userId)
  const { rows } = await db.query(CLAIM, [token, key])
  await db.query("reset role")
  return rows[0].r as Record<string, unknown>
}

async function claimErrorAs(
  db: Db,
  userId: string,
  token: string,
  key: string
) {
  await asAuthenticated(db, userId)
  const error = await queryError(db, CLAIM, [token, key])
  await db.query("reset role")
  return error
}

async function find(db: Db, email: string | null, phone: string | null) {
  const { rows } = await db.query(FIND, [email, phone])
  return rows[0].r as Record<string, unknown>
}

async function count(db: Db, text: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from (${text}) q`,
    params
  )
  return rows[0].n
}

async function tokenRow(db: Db, tokenId: string) {
  const { rows } = await db.query(
    "select * from public.activation_tokens where id = $1",
    [tokenId]
  )
  return rows[0]
}

async function unbound(db: Db, paymentId: string) {
  const { rows } = await db.query(
    `select
       (select customer_id from public.payments where id = $1) as payment,
       (select customer_id from public.entitlements where payment_id = $1) as entitlement`,
    [paymentId]
  )
  return rows[0].payment === null && rows[0].entitlement === null
}

// Customer A gets an Auth user (her email) and a phone; returns both.
async function giveAccount(db: Db, customerId: string, label: string) {
  const { email } = await insertAuthUser(db, label, { id: customerId })
  const phone = testPhone()
  await db.query("update public.profiles set phone_e164 = $1 where id = $2", [
    e164(phone),
    customerId,
  ])
  return { email, phone }
}

// A link in awaiting_login for customer A (matched by email).
async function awaitingLogin(db: Db) {
  const a = await approveCard(db)
  const account = await giveAccount(db, a.f.customerA, "acc_a")
  const phone = testPhone()
  const begun = await call(db, BEGIN, [
    a.token,
    account.email,
    phone,
    randomUUID(),
  ])
  expect(begun).toEqual({ outcome: "existing_account", token_id: a.tokenId })
  return { a, account, phone }
}

function R_TWO(tokenId: string) {
  return { outcome: "conflict", token_id: tokenId, reason: "two_accounts" }
}

describe("private.find_identity", () => {
  it("finds nothing for unknown details or nulls", async () => {
    await inRollback(async (db) => {
      expect(await find(db, freshEmail("nobody"), testPhone())).toEqual({
        match: "none",
      })
      expect(await find(db, null, null)).toEqual({ match: "none" })
      expect(await find(db, "  ", "not a phone")).toEqual({ match: "none" })
    })
  })

  it("finds one activated account by email (any case, spaces) or by phone (any format), without the field", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const { email, phone } = await giveAccount(db, f.customerA, "find_a")
      const account = { match: "account", customer_id: f.customerA }

      expect(await find(db, `  ${email.toUpperCase()} `, null)).toEqual(account)
      expect(await find(db, null, phone)).toEqual(account)
      expect(await find(db, null, e164(phone))).toEqual(account)
      expect(await find(db, email, phone)).toEqual(account)
      expect(await find(db, freshEmail("other"), phone)).toEqual(account)
    })
  })

  it("is a two_accounts conflict when email and phone belong to two ids", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const a = await giveAccount(db, f.customerA, "two_a")
      const b = await giveAccount(db, f.customerB, "two_b")
      expect(await find(db, a.email, b.phone)).toEqual({
        match: "conflict",
        reason: "two_accounts",
      })
    })
  })

  it("is a not_activated conflict for an imported profile, an Auth user without a profile, an anonymized profile or an admin", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const notActivated = { match: "conflict", reason: "not_activated" }

      const imported = randomUUID()
      const importedEmail = freshEmail("imported")
      const importedPhone = testPhone()
      await db.query(
        `insert into public.profiles (id, full_name, pending_email, phone_e164)
         values ($1, $2, $3, $4)`,
        [imported, testName("imported"), importedEmail, e164(importedPhone)]
      )
      expect(await find(db, importedEmail.toUpperCase(), null)).toEqual(
        notActivated
      )
      expect(await find(db, null, importedPhone)).toEqual(notActivated)

      // An orphan of a failed join (an Auth user without a profile).
      const orphan = await insertAuthUser(db, "orphan")
      expect(await find(db, orphan.email, null)).toEqual(notActivated)

      const gone = await giveAccount(db, f.customerB, "gone")
      await db.query(
        "update public.profiles set anonymized_at = now() where id = $1",
        [f.customerB]
      )
      expect(await find(db, gone.email, null)).toEqual(notActivated)

      const admin = await insertAuthUser(db, "admin", { id: f.admin })
      expect(await find(db, admin.email, null)).toEqual(notActivated)
    })
  })

  it("has no grant to any API role", async () => {
    await inRollback(async (db) => {
      for (const role of ["authenticated", "service_role", "anon"]) {
        await db.query(`set local role ${role}`)
        expect((await queryError(db, FIND, ["a@b.co", null]))?.code).toBe(
          "42501"
        )
        await db.query("reset role")
      }
    })
  })
})

describe("an admin with an activated profile", () => {
  it("is not_activated in find_identity and a conflict in join_begin, never awaiting_login", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
        [a.f.admin, testName("admin_profile")]
      )
      const admin = await giveAccount(db, a.f.admin, "admin_acc")

      expect(await find(db, admin.email, null)).toEqual({
        match: "conflict",
        reason: "not_activated",
      })
      expect(
        await call(db, BEGIN, [a.token, admin.email, testPhone(), randomUUID()])
      ).toEqual({
        outcome: "conflict",
        token_id: a.tokenId,
        reason: "not_activated",
      })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "conflict",
        conflict_reason: "not_activated",
        bound_user_id: null,
      })
    })
  })
})

describe("join_begin with an existing account", () => {
  it("moves the link to awaiting_login for the email of an account, creating and binding nothing", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const account = await giveAccount(db, a.f.customerA, "mail_a")
      const users = await count(db, "select 1 from auth.users")

      const result = await call(db, BEGIN, [
        a.token,
        `  ${account.email.toUpperCase()} `,
        testPhone(),
        randomUUID(),
      ])
      expect(result).toEqual({
        outcome: "existing_account",
        token_id: a.tokenId,
      })
      const token = await tokenRow(db, a.tokenId)
      expect(token).toMatchObject({
        state: "awaiting_login",
        bound_user_id: a.f.customerA,
        pending_user_id: null,
        conflict_reason: null,
      })
      expect(token.input_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(await count(db, "select 1 from auth.users")).toBe(users)
      expect(await unbound(db, a.paymentId)).toBe(true)

      // The view shows the product, never the account.
      const view = await call(db, VIEW, [a.token])
      expect(view).toMatchObject({
        state_public: "awaiting_login",
        product_name: testName("card"),
        amount_agorot: 47200,
      })
      // Server-only (the page compares it with the session); the result of
      // join_begin never carries it.
      expect(view.bound_user_id).toBe(a.f.customerA)
      expect(JSON.stringify(result)).not.toContain(a.f.customerA)
    })
  })

  it("does the same for the phone alone (05X against +972), and join_complete cannot finish it", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const account = await giveAccount(db, a.f.customerA, "phone_a")
      const email = freshEmail("phone_only")

      const result = await call(db, BEGIN, [
        a.token,
        email,
        account.phone,
        randomUUID(),
      ])
      expect(result).toEqual({
        outcome: "existing_account",
        token_id: a.tokenId,
      })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "awaiting_login",
        bound_user_id: a.f.customerA,
      })

      expect(
        await callError(db, COMPLETE, [
          a.token,
          JSON.stringify({ email, phone: account.phone }),
          randomUUID(),
        ])
      ).toMatchObject({ code: "P0001", message: "LINK_EXPIRED" })
      expect(await unbound(db, a.paymentId)).toBe(true)
    })
  })

  it("answers the same input again with existing_account (another key) and checks other input again (story 2.4)", async () => {
    await inRollback(async (db) => {
      const { a, account, phone } = await awaitingLogin(db)
      expect(
        await call(db, BEGIN, [a.token, account.email, phone, randomUUID()])
      ).toEqual({ outcome: "existing_account", token_id: a.tokenId })
      // The same email with another phone still matches the account.
      expect(
        await call(db, BEGIN, [
          a.token,
          account.email,
          testPhone(),
          randomUUID(),
        ])
      ).toEqual({ outcome: "existing_account", token_id: a.tokenId })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "awaiting_login",
        bound_user_id: a.f.customerA,
        identity_attempts: 1,
      })
    })
  })

  it("answers an expired awaiting_login link with LINK_EXPIRED and shows it expired", async () => {
    await inRollback(async (db) => {
      const { a, account, phone } = await awaitingLogin(db)
      await db.query(
        "update public.activation_tokens set expires_at = now() - interval '1 second' where id = $1",
        [a.tokenId]
      )
      expect(
        await callError(db, BEGIN, [
          a.token,
          account.email,
          phone,
          randomUUID(),
        ])
      ).toMatchObject({ code: "P0001", message: "LINK_EXPIRED" })
      expect(await call(db, VIEW, [a.token])).toMatchObject({
        state_public: "expired",
        product_name: null,
      })
    })
  })

  it("lets two accounts retry twice (identity_retry, pending), then locks the link on the third attempt", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const accA = await giveAccount(db, a.f.customerA, "two_a")
      const accB = await giveAccount(db, a.f.customerB, "two_b")
      const retry = { outcome: "identity_retry", token_id: a.tokenId }

      for (const attempt of [1, 2]) {
        // Each attempt comes with the new key the action hands back.
        expect(
          await call(db, BEGIN, [a.token, accA.email, accB.phone, randomUUID()])
        ).toEqual(retry)
        expect(await tokenRow(db, a.tokenId)).toMatchObject({
          state: "pending",
          conflict_reason: null,
          identity_attempts: attempt,
          input_hash: null,
          pending_user_id: null,
          bound_user_id: null,
        })
        expect(await call(db, VIEW, [a.token])).toMatchObject({
          state_public: "active",
          conflict_reason: null,
        })
      }

      // The same key and input again: the stored result, no extra attempt.
      const key = randomUUID()
      const third = await call(db, BEGIN, [
        a.token,
        accA.email,
        accB.phone,
        key,
      ])
      expect(third).toEqual(R_TWO(a.tokenId))
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "conflict",
        conflict_reason: "two_accounts",
        identity_attempts: 3,
        pending_user_id: null,
        bound_user_id: null,
      })
      expect(
        await call(db, BEGIN, [a.token, accA.email, accB.phone, key])
      ).toEqual(third)

      // After the lock, any input (even one that would not clash) stays a
      // conflict.
      expect(
        await call(db, BEGIN, [
          a.token,
          freshEmail("after_lock"),
          testPhone(),
          randomUUID(),
        ])
      ).toEqual(R_TWO(a.tokenId))
      expect(await unbound(db, a.paymentId)).toBe(true)
      expect(await call(db, VIEW, [a.token])).toMatchObject({
        state_public: "conflict",
        conflict_reason: "two_accounts",
      })
    })
  })

  it("does not count a retry with the same key twice", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const accA = await giveAccount(db, a.f.customerA, "same_a")
      const accB = await giveAccount(db, a.f.customerB, "same_b")
      const key = randomUUID()
      const first = await call(db, BEGIN, [
        a.token,
        accA.email,
        accB.phone,
        key,
      ])
      expect(
        await call(db, BEGIN, [a.token, accA.email, accB.phone, key])
      ).toEqual(first)
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "pending",
        identity_attempts: 1,
      })
    })
  })

  it.each(["claiming", "existing_account"])(
    "classifies corrected input after identity_retry as usual (%s)",
    async (outcome) => {
      await inRollback(async (db) => {
        const a = await approveCard(db)
        const accA = await giveAccount(db, a.f.customerA, "fix_a")
        const accB = await giveAccount(db, a.f.customerB, "fix_b")
        expect(
          await call(db, BEGIN, [a.token, accA.email, accB.phone, randomUUID()])
        ).toMatchObject({ outcome: "identity_retry" })

        const fixed =
          outcome === "claiming"
            ? [freshEmail("fixed"), testPhone()]
            : [accA.email, testPhone()]
        const result = await call(db, BEGIN, [a.token, ...fixed, randomUUID()])
        expect(result).toMatchObject({ outcome, token_id: a.tokenId })
        expect(await tokenRow(db, a.tokenId)).toMatchObject({
          state: outcome === "claiming" ? "claiming" : "awaiting_login",
          identity_attempts: 1,
          conflict_reason: null,
        })
      })
    }
  )

  it.each(["not_activated", "phone_taken", "bind_conflict"])(
    "shows the stored reason %s in token_view",
    async (reason) => {
      await inRollback(async (db) => {
        const a = await approveCard(db)
        expect(await call(db, VIEW, [a.token])).toMatchObject({
          state_public: "active",
          conflict_reason: null,
        })
        await db.query(
          "update public.activation_tokens set state = 'conflict', conflict_reason = $2 where id = $1",
          [a.tokenId, reason]
        )
        expect(await call(db, VIEW, [a.token])).toMatchObject({
          state_public: "conflict",
          conflict_reason: reason,
          product_name: null,
        })
        // join_begin on a stopped link answers with the same reason.
        expect(
          await call(db, BEGIN, [
            a.token,
            freshEmail("reason"),
            testPhone(),
            randomUUID(),
          ])
        ).toEqual({ outcome: "conflict", token_id: a.tokenId, reason })
      })
    }
  )

  it("keeps identity_attempts between 0 and 3", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      for (const value of [-1, 4]) {
        expect(
          (
            await queryError(
              db,
              "update public.activation_tokens set identity_attempts = $2 where id = $1",
              [a.tokenId, value]
            )
          )?.code
        ).toBe("23514")
      }
    })
  })

  it.each(["pending_email", "phone", "auth_user"])(
    "stops on a profile that is not activated (%s): conflict not_activated",
    async (match) => {
      await inRollback(async (db) => {
        const a = await approveCard(db)
        let email = freshEmail("na_fresh")
        let phone = testPhone()
        if (match === "auth_user") {
          email = (await insertAuthUser(db, "na_orphan")).email
        } else {
          const importedEmail = freshEmail("na_imported")
          const importedPhone = testPhone()
          await db.query(
            `insert into public.profiles (id, full_name, pending_email, phone_e164)
             values ($1, $2, $3, $4)`,
            [
              randomUUID(),
              testName("na_imported"),
              importedEmail,
              e164(importedPhone),
            ]
          )
          if (match === "pending_email") email = importedEmail
          else phone = importedPhone
        }

        expect(
          await call(db, BEGIN, [a.token, email, phone, randomUUID()])
        ).toEqual({
          outcome: "conflict",
          token_id: a.tokenId,
          reason: "not_activated",
        })
        expect(await tokenRow(db, a.tokenId)).toMatchObject({
          state: "conflict",
          conflict_reason: "not_activated",
          pending_user_id: null,
        })
        expect(await unbound(db, a.paymentId)).toBe(true)
      })
    }
  )
})

describe("claim_join", () => {
  it("binds the purchase to the signed-in account, consumes the link and queues one notification; the same key returns the same result", async () => {
    await inRollback(async (db) => {
      const { a } = await awaitingLogin(db)
      const key = randomUUID()

      const result = await claimAs(db, a.f.customerA, a.token, key)
      expect(result).toEqual({ outcome: "claimed", payment_id: a.paymentId })

      const { rows } = await db.query(
        `select
           (select customer_id from public.payments where id = $1) as payment,
           (select customer_id from public.entitlements where payment_id = $1) as entitlement`,
        [a.paymentId]
      )
      expect(rows[0]).toEqual({
        payment: a.f.customerA,
        entitlement: a.f.customerA,
      })
      const token = await tokenRow(db, a.tokenId)
      expect(token).toMatchObject({
        state: "consumed",
        customer_id: a.f.customerA,
      })
      expect(token.consumed_at).not.toBeNull()

      const notes = () =>
        count(
          db,
          "select 1 from public.notifications where recipient_id = $1 and type = 'purchase_new_card'",
          [a.f.customerA]
        )
      expect(await notes()).toBe(1)

      const { rows: audit } = await db.query(
        `select actor_id, actor_kind from public.audit_log
         where entity_type = 'activation_tokens' and entity_id = $1 and action = 'claim_join'`,
        [a.tokenId]
      )
      expect(audit).toEqual([
        { actor_id: a.f.customerA, actor_kind: "customer" },
      ])

      expect(await claimAs(db, a.f.customerA, a.token, key)).toEqual(result)
      expect(await notes()).toBe(1)

      // A new key after the link was consumed.
      expect(
        await claimErrorAs(db, a.f.customerA, a.token, randomUUID())
      ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      expect(await call(db, VIEW, [a.token])).toMatchObject({
        state_public: "used",
      })
    })
  })

  // Story 2.13: the claim screen asks no photo question and claim_join
  // leaves both consents as they were.
  it("leaves both photo consents unchanged", async () => {
    await inRollback(async (db) => {
      const { a } = await awaitingLogin(db)
      await db.query(
        `update public.profiles
         set photo_consent = true, photo_consent_at = '2026-09-01T08:00:00Z',
             photo_consent_text_version = 0, personal_photo_consent = false,
             personal_photo_consent_at = null,
             personal_photo_consent_text_version = null
         where id = $1`,
        [a.f.customerA]
      )
      const consents = async () =>
        (
          await db.query(
            `select photo_consent, photo_consent_at, photo_consent_text_version,
                    personal_photo_consent, personal_photo_consent_at,
                    personal_photo_consent_text_version
             from public.profiles where id = $1`,
            [a.f.customerA]
          )
        ).rows[0]
      const before = await consents()

      expect(
        await claimAs(db, a.f.customerA, a.token, randomUUID())
      ).toMatchObject({ outcome: "claimed" })
      expect(await consents()).toEqual(before)
      expect(before).toMatchObject({
        photo_consent: true,
        personal_photo_consent: false,
      })
    })
  })

  it.each(["customer_b", "admin", "expired", "pending", "reset"])(
    "refuses %s with NOT_AUTHORIZED and changes nothing",
    async (scenario) => {
      await inRollback(async (db) => {
        let caller: string
        let token: string
        let a: Approved
        if (scenario === "pending") {
          a = await approveCard(db)
          token = a.token
          caller = a.f.customerA
        } else {
          a = (await awaitingLogin(db)).a
          token = a.token
          caller = a.f.customerA
          if (scenario === "customer_b") caller = a.f.customerB
          if (scenario === "admin") caller = a.f.admin
          if (scenario === "expired") {
            await db.query(
              "update public.activation_tokens set expires_at = now() - interval '1 second' where id = $1",
              [a.tokenId]
            )
          }
          if (scenario === "reset") {
            const reset = await call(
              db,
              "select public.issue_reset_token($1) as r",
              [a.f.customerA]
            )
            token = reset.token as string
          }
        }
        const before = await tokenRow(db, a.tokenId)

        const error = await claimErrorAs(db, caller, token, randomUUID())
        expect(error).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
        expect(await tokenRow(db, a.tokenId)).toEqual(before)
        expect(await unbound(db, a.paymentId)).toBe(true)
      })
    }
  )

  it("refuses a user without an active profile and an unknown token", async () => {
    await inRollback(async (db) => {
      const { a } = await awaitingLogin(db)
      expect(
        await claimErrorAs(db, randomUUID(), a.token, randomUUID())
      ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      expect(
        await claimErrorAs(db, a.f.customerA, "x".repeat(43), randomUUID())
      ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
    })
  })

  it("is not executable by anon or the service role", async () => {
    await inRollback(async (db) => {
      await db.query("set local role anon")
      expect(
        (await queryError(db, CLAIM, ["x".repeat(43), randomUUID()]))?.code
      ).toBe("42501")
      await db.query("reset role")
      await asServiceRole(db)
      expect(
        (await queryError(db, CLAIM, ["x".repeat(43), randomUUID()]))?.code
      ).toBe("42501")
    })
  })

  it("moves the link to conflict (bind_conflict) when the purchase is already bound, with no raw 23505", async () => {
    await inRollback(async (db) => {
      const { a } = await awaitingLogin(db)
      await db.query(
        "update public.payments set customer_id = $1 where id = $2",
        [a.f.customerB, a.paymentId]
      )

      expect(await claimAs(db, a.f.customerA, a.token, randomUUID())).toEqual({
        outcome: "conflict",
      })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "conflict",
        conflict_reason: "bind_conflict",
        customer_id: null,
      })
      expect(
        await count(
          db,
          "select 1 from public.entitlements where payment_id = $1 and customer_id is not null",
          [a.paymentId]
        )
      ).toBe(0)
      expect(
        await count(
          db,
          "select 1 from public.notifications where recipient_id = $1",
          [a.f.customerA]
        )
      ).toBe(0)
    })
  })
})

describe("join_complete conflicts", () => {
  it("turns any other unique violation into bind_conflict (no raw 23505)", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = freshEmail("pkey")
      const phone = testPhone()
      const begun = await call(db, BEGIN, [a.token, email, phone, randomUUID()])
      const userId = begun.pending_user_id as string
      await insertAuthUser(db, "pkey", { id: userId })
      // A profile with that id appeared in the meantime (profiles_pkey).
      await db.query(
        "insert into public.profiles (id, full_name) values ($1, $2)",
        [userId, testName("pkey")]
      )

      expect(
        await call(db, COMPLETE, [
          a.token,
          JSON.stringify({
            email,
            phone,
            full_name: testName("pkey"),
            dietary_notes: null,
            privacy_consent: true,
            photo_consent: false,
            personal_photo_consent: false,
            babies: [{ name: testName("baby"), birth_date: "2026-09-01" }],
          }),
          randomUUID(),
        ])
      ).toEqual({
        outcome: "conflict",
        token_id: a.tokenId,
        reason: "bind_conflict",
      })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "conflict",
        conflict_reason: "bind_conflict",
      })
      expect(await unbound(db, a.paymentId)).toBe(true)
    })
  })
})

describe("checks", () => {
  it("keep conflict_reason in its list and in step with the conflict state", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      for (const change of [
        "state = 'conflict'",
        "conflict_reason = 'two_accounts'",
        "state = 'conflict', conflict_reason = 'identity_match'",
        "state = 'conflict', conflict_reason = 'other'",
        "state = 'awaiting_login'",
      ]) {
        expect(
          (
            await queryError(
              db,
              `update public.activation_tokens set ${change} where id = $1`,
              [a.tokenId]
            )
          )?.code
        ).toBe("23514")
      }
      for (const reason of [
        "two_accounts",
        "not_activated",
        "phone_taken",
        "bind_conflict",
        "too_many_attempts",
      ]) {
        expect(
          await queryError(
            db,
            "update public.activation_tokens set state = 'conflict', conflict_reason = $2 where id = $1",
            [a.tokenId, reason]
          )
        ).toBeNull()
      }
      // A revoked conflict keeps its reason (story 2.4).
      expect(
        await queryError(
          db,
          "update public.activation_tokens set state = 'revoked', revoked_at = now() where id = $1",
          [a.tokenId]
        )
      ).toBeNull()
    })
  })

  it("keep pending_email normalized, unique and only on a profile that is not activated", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const email = freshEmail("pending")
      const insert = (id: string, value: string) =>
        queryError(
          db,
          "insert into public.profiles (id, full_name, pending_email) values ($1, $2, $3)",
          [id, testName("pending"), value]
        )

      expect((await insert(randomUUID(), ` ${email}`))?.code).toBe("23514")
      expect((await insert(randomUUID(), email.toUpperCase()))?.code).toBe(
        "23514"
      )
      expect(await insert(randomUUID(), email)).toBeNull()
      expect((await insert(randomUUID(), email))?.code).toBe("23505")
      expect(
        (
          await queryError(
            db,
            "update public.profiles set pending_email = $1 where id = $2",
            [freshEmail("activated"), f.customerA]
          )
        )?.code
      ).toBe("23514")
    })
  })
})
