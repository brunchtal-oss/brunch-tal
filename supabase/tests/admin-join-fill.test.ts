// Story 2.15: Tal fills the join form for a customer who paid (user decision
// 2026-11-09). admin_begin_join_fill replaces the purchase's live link with
// a fresh internal one (1 hour), without an audit row, and the unchanged
// join core (join_begin -> Auth -> join_complete) runs with it; token_view
// reads a revoked link of a bound purchase as 'used'. Along the I/O matrix
// of the spec. Time is simulated by updating expires_at / claiming_at as the
// owner; Auth users are rows in auth.users inside the rolled-back
// transaction.

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

const FILL = "select public.admin_begin_join_fill($1, $2, $3, $4) as r"
const BEGIN = "select public.join_begin($1, $2, $3, $4) as r"
const COMPLETE = "select public.join_complete($1, $2::jsonb, $3) as r"
const VIEW = "select public.token_view($1) as r"
const VOID = "select public.admin_void_purchase($1, $2, $3, $4) as r"
const ITEMS = "select public.admin_get_attention_items() as r"
const ISSUE = "select public.admin_issue_link('join', $1, $2) as r"

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
    duplicateConfirmed: true,
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
  const digits = (parseInt(testName("").slice(5, 11), 16) + 700 + phoneCounter)
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

function profile(email: string, phone: string) {
  return {
    email,
    phone,
    full_name: testName("filled"),
    dietary_notes: null,
    privacy_consent: true,
    photo_consent: true,
    personal_photo_consent: false,
    babies: [{ name: testName("baby"), birth_date: "2026-09-01" }],
  }
}

async function asUser<T = Record<string, unknown>>(
  db: Db,
  userId: string,
  query: string,
  params: unknown[]
): Promise<T> {
  await asAuthenticated(db, userId)
  const { rows } = await db.query(query, params)
  await db.query("reset role")
  return rows[0].r as T
}

async function asUserError(
  db: Db,
  userId: string,
  query: string,
  params: unknown[]
) {
  await asAuthenticated(db, userId)
  const error = await queryError(db, query, params)
  await db.query("reset role")
  return error
}

async function service(db: Db, query: string, params: unknown[]) {
  await asServiceRole(db)
  const { rows } = await db.query(query, params)
  await db.query("reset role")
  return rows[0].r as Record<string, unknown>
}

async function serviceError(db: Db, query: string, params: unknown[]) {
  await asServiceRole(db)
  const error = await queryError(db, query, params)
  await db.query("reset role")
  return error
}

async function tokenRow(db: Db, tokenId: string) {
  const { rows } = await db.query(
    "select * from public.activation_tokens where id = $1",
    [tokenId]
  )
  return rows[0]
}

async function adminAuditCount(db: Db, adminId: string): Promise<number> {
  const { rows } = await db.query(
    "select count(*)::int as n from public.audit_log where actor_id = $1",
    [adminId]
  )
  return rows[0].n
}

async function fill(
  db: Db,
  a: Approved,
  email: string,
  phone: string,
  key = randomUUID()
) {
  return asUser(db, a.f.admin, FILL, [a.paymentId, email, phone, key])
}

// The join core with a token, as the server runs it: join_begin, the Auth
// user with the pending id, join_complete.
async function joinWith(
  db: Db,
  token: string,
  email: string,
  phone: string,
  key = randomUUID()
) {
  const begun = await service(db, BEGIN, [token, email, phone, key])
  expect(begun.outcome).toBe("claiming")
  const userId = begun.pending_user_id as string
  // The Auth user has the input's email, as createUser would (join_complete
  // checks it); the label is the email's local part (freshEmail).
  await insertAuthUser(db, email.split("@")[0].replace(/^test_[^_]+_/, ""), {
    id: userId,
  })
  const done = await service(db, COMPLETE, [
    token,
    JSON.stringify(profile(email, phone)),
    key,
  ])
  return { begun, done, userId }
}

async function attention(db: Db, adminId: string, ids: string[]) {
  const items = await asUser<Array<{ kind: string; id: string }>>(
    db,
    adminId,
    ITEMS,
    []
  )
  return items.filter((i) => ids.includes(i.id)).map((i) => i.kind)
}

describe("admin_begin_join_fill", { timeout: 60_000 }, () => {
  it("happy: revokes the customer's link without an audit row, issues a 1-hour link, and the join core binds the purchase as a self-join", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const before = await adminAuditCount(db, a.f.admin)
      const email = freshEmail("happy")
      const phone = testPhone()

      const r = await fill(db, a, email, phone)
      expect(r).toMatchObject({
        outcome: "ready",
        revoked_pending_user_id: null,
        reissue_required: false,
      })
      expect(typeof r.token).toBe("string")
      expect(await adminAuditCount(db, a.f.admin)).toBe(before)

      const old = await tokenRow(db, a.tokenId)
      expect(old.state).toBe("revoked")
      expect(old.revoked_at).not.toBeNull()
      const fresh = await tokenRow(db, r.token_id as string)
      expect(fresh).toMatchObject({
        state: "pending",
        purpose: "join",
        payment_id: a.paymentId,
      })
      const { rows: hour } = await db.query(
        "select expires_at between now() + interval '59 minutes' and now() + interval '61 minutes' as ok from public.activation_tokens where id = $1",
        [r.token_id]
      )
      expect(hour[0].ok).toBe(true)

      const { done, userId } = await joinWith(
        db,
        r.token as string,
        email,
        phone
      )
      expect(done).toMatchObject({ outcome: "joined", customer_id: userId })

      const { rows: p } = await db.query(
        "select * from public.profiles where id = $1",
        [userId]
      )
      expect(p[0]).toMatchObject({
        phone_e164: e164(phone),
        photo_consent: true,
        personal_photo_consent: false,
      })
      expect(p[0].privacy_consent_at).not.toBeNull()
      expect(p[0].activated_at).not.toBeNull()
      const { rows: pay } = await db.query(
        "select customer_id from public.payments where id = $1",
        [a.paymentId]
      )
      expect(pay[0].customer_id).toBe(userId)

      // The audit equals a self-join's: the customer as actor, no admin row.
      const { rows: audit } = await db.query(
        "select actor_id, actor_kind, entity_type from public.audit_log where customer_id = $1",
        [userId]
      )
      expect(audit.map((row) => row.entity_type).sort()).toEqual([
        "activation_tokens",
        "babies",
        "entitlements",
        "payments",
        "profiles",
      ])
      for (const row of audit) {
        expect(row).toMatchObject({ actor_id: userId, actor_kind: "customer" })
      }
      expect(await adminAuditCount(db, a.f.admin)).toBe(before)

      // The raw token is stored nowhere.
      const { rows: stored } = await db.query(
        `select count(*)::int as n from private.idempotency_results
         where result::text like '%' || $1 || '%'`,
        [r.token]
      )
      expect(stored[0].n).toBe(0)

      // Tal first: the customer's old link reads used; submitting it fails.
      expect(await service(db, VIEW, [a.token])).toMatchObject({
        state_public: "used",
      })
      expect(
        await serviceError(db, BEGIN, [
          a.token,
          freshEmail("late"),
          testPhone(),
          randomUUID(),
        ])
      ).toMatchObject({ message: "LINK_EXPIRED" })
    })
  })

  it("an expired link, or none (revoked), does not block", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      await db.query(
        "update public.activation_tokens set expires_at = now() - interval '1 minute' where id = $1",
        [a.tokenId]
      )
      const r = await fill(db, a, freshEmail("exp"), testPhone())
      expect(r.outcome).toBe("ready")
      expect((await tokenRow(db, a.tokenId)).state).toBe("revoked")

      const b = await approveCard(db)
      await db.query(
        "update public.activation_tokens set state = 'revoked', revoked_at = now() where id = $1",
        [b.tokenId]
      )
      const r2 = await fill(db, b, freshEmail("none"), testPhone())
      expect(r2.outcome).toBe("ready")
      expect(typeof r2.token).toBe("string")
    })
  })

  it("customer first: LINK_USED, nothing changes", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      await joinWith(db, a.token, freshEmail("self"), testPhone())
      const before = await tokenRow(db, a.tokenId)
      expect(
        await asUserError(db, a.f.admin, FILL, [
          a.paymentId,
          freshEmail("tal"),
          testPhone(),
          randomUUID(),
        ])
      ).toMatchObject({ code: "P0001", message: "LINK_USED" })
      expect(await tokenRow(db, a.tokenId)).toEqual(before)
    })
  })

  it("customer mid-join (claiming under 15 minutes): LINK_IN_PROGRESS, her link stays", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      await service(db, BEGIN, [
        a.token,
        freshEmail("mid"),
        testPhone(),
        randomUUID(),
      ])
      expect(
        await asUserError(db, a.f.admin, FILL, [
          a.paymentId,
          freshEmail("tal"),
          testPhone(),
          randomUUID(),
        ])
      ).toMatchObject({ message: "LINK_IN_PROGRESS" })
      expect((await tokenRow(db, a.tokenId)).state).toBe("claiming")
    })
  })

  it("stuck (claiming 15 minutes or more): revoked, its pending Auth user returned, the fill goes on", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const begun = await service(db, BEGIN, [
        a.token,
        freshEmail("stuck"),
        testPhone(),
        randomUUID(),
      ])
      await db.query(
        "update public.activation_tokens set claiming_at = now() - interval '16 minutes' where id = $1",
        [a.tokenId]
      )
      const email = freshEmail("after_stuck")
      const phone = testPhone()
      const r = await fill(db, a, email, phone)
      expect(r).toMatchObject({
        outcome: "ready",
        revoked_pending_user_id: begun.pending_user_id,
      })
      expect((await tokenRow(db, a.tokenId)).state).toBe("revoked")
      const { done } = await joinWith(db, r.token as string, email, phone)
      expect(done.outcome).toBe("joined")
    })
  })

  it("a fill that fails or is abandoned shows in the attention list; the old link reads expired", async () => {
    await inRollback(async (db) => {
      // Abandoned before the Auth step: after the hour, purchase_without_link.
      const a = await approveCard(db)
      const r = await fill(db, a, freshEmail("gone"), testPhone())
      const fresh = r.token_id as string
      expect(await service(db, VIEW, [a.token])).toMatchObject({
        state_public: "expired",
      })
      expect(await attention(db, a.f.admin, [a.paymentId, fresh])).toEqual([])
      await db.query(
        "update public.activation_tokens set expires_at = now() - interval '1 minute' where id = $1",
        [fresh]
      )
      expect(await attention(db, a.f.admin, [a.paymentId, fresh])).toEqual([
        "purchase_without_link",
      ])

      // Left mid-join: link_stuck after 15 minutes.
      const b = await approveCard(db)
      const rb = await fill(db, b, freshEmail("abandon"), testPhone())
      await service(db, BEGIN, [
        rb.token,
        freshEmail("abandon"),
        testPhone(),
        randomUUID(),
      ])
      await db.query(
        "update public.activation_tokens set claiming_at = now() - interval '16 minutes' where id = $1",
        [rb.token_id]
      )
      expect(
        await attention(db, b.f.admin, [b.paymentId, rb.token_id as string])
      ).toEqual(["link_stuck"])

      // A conflict: link_conflict, and a new fill replaces it.
      const c = await approveCard(db)
      const rc = await fill(db, c, freshEmail("conf"), testPhone())
      await db.query(
        "update public.activation_tokens set state = 'conflict', conflict_reason = 'bind_conflict' where id = $1",
        [rc.token_id]
      )
      expect(
        await attention(db, c.f.admin, [c.paymentId, rc.token_id as string])
      ).toEqual(["link_conflict"])
      const again = await fill(db, c, freshEmail("conf2"), testPhone())
      expect(again.outcome).toBe("ready")
      expect((await tokenRow(db, rc.token_id as string)).state).toBe("revoked")
    })
  })

  it("details of an existing account: details_taken, the customer's link untouched", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const { email } = await insertAuthUser(db, "taken", {
        id: a.f.customerA,
      })
      const before = await adminAuditCount(db, a.f.admin)
      const r = await fill(db, a, email, testPhone())
      expect(r).toEqual({ outcome: "details_taken" })
      const old = await tokenRow(db, a.tokenId)
      expect(old.state).toBe("pending")
      const { rows } = await db.query(
        "select count(*)::int as n from public.activation_tokens where payment_id = $1",
        [a.paymentId]
      )
      expect(rows[0].n).toBe(1)
      expect(await adminAuditCount(db, a.f.admin)).toBe(before)
    })
  })

  it("retry: the same token gives the same pending user, one account", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = freshEmail("retry")
      const phone = testPhone()
      const r = await fill(db, a, email, phone)
      const key = randomUUID()
      const first = await service(db, BEGIN, [r.token, email, phone, key])
      // The Auth step failed; the same page submits again.
      const second = await service(db, BEGIN, [r.token, email, phone, key])
      expect(second.pending_user_id).toBe(first.pending_user_id)
      const { done, userId } = await joinWith(
        db,
        r.token as string,
        email,
        phone,
        key
      )
      expect(userId).toBe(first.pending_user_id)
      expect(done.outcome).toBe("joined")
    })
  })

  it("repeat key: the stored result has no token and asks for a reissue; no second link", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = freshEmail("repeat")
      const phone = testPhone()
      const key = randomUUID()
      const first = await fill(db, a, email, phone, key)
      const again = await fill(db, a, email, phone, key)
      expect(again).toMatchObject({
        outcome: "ready",
        token_id: first.token_id,
        reissue_required: true,
      })
      expect(again.token).toBeUndefined()
      const { rows } = await db.query(
        "select count(*)::int as n from public.activation_tokens where payment_id = $1 and state <> 'revoked'",
        [a.paymentId]
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("a voided purchase: PURCHASE_VOIDED, nothing changes", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      await asUser(db, a.f.admin, VOID, [a.paymentId, null, true, randomUUID()])
      const before = await tokenRow(db, a.tokenId)
      expect(
        await asUserError(db, a.f.admin, FILL, [
          a.paymentId,
          freshEmail("void"),
          testPhone(),
          randomUUID(),
        ])
      ).toMatchObject({ message: "PURCHASE_VOIDED" })
      expect(await tokenRow(db, a.tokenId)).toEqual(before)
    })
  })

  it("not admin: NOT_AUTHORIZED, nothing changes", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      expect(
        await asUserError(db, a.f.customerA, FILL, [
          a.paymentId,
          freshEmail("cust"),
          testPhone(),
          randomUUID(),
        ])
      ).toMatchObject({ message: "NOT_AUTHORIZED" })
      expect((await tokenRow(db, a.tokenId)).state).toBe("pending")
    })
  })

  it("rejects a missing key or payment", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      expect(
        await asUserError(db, a.f.admin, FILL, [
          a.paymentId,
          freshEmail("nokey"),
          testPhone(),
          null,
        ])
      ).toMatchObject({ message: "INVALID_INPUT" })
      expect(
        await asUserError(db, a.f.admin, FILL, [
          null,
          freshEmail("nopay"),
          testPhone(),
          randomUUID(),
        ])
      ).toMatchObject({ message: "INVALID_INPUT" })
    })
  })

  it("stuck link whose pending Auth user has the same email: the orphan does not count, ready, and it is returned for deletion", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = freshEmail("same_orphan")
      const begun = await service(db, BEGIN, [
        a.token,
        email,
        testPhone(),
        randomUUID(),
      ])
      const orphan = begun.pending_user_id as string
      // The Admin API's createUser for the customer's attempt.
      const user = await insertAuthUser(db, "same_orphan", { id: orphan })
      expect(user.email).toBe(email)
      await db.query(
        "update public.activation_tokens set claiming_at = now() - interval '16 minutes' where id = $1",
        [a.tokenId]
      )
      const r = await fill(db, a, email, testPhone())
      expect(r).toMatchObject({
        outcome: "ready",
        revoked_pending_user_id: orphan,
      })
      expect((await tokenRow(db, a.tokenId)).state).toBe("revoked")
    })
  })
})

describe("token_view after a replacement (story 2.15)", () => {
  it("a link revoked by admin_issue_link reads used once the purchase is bound through the new link", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const issued = await asUser(db, a.f.admin, ISSUE, [
        a.paymentId,
        randomUUID(),
      ])
      expect((await tokenRow(db, a.tokenId)).state).toBe("revoked")
      expect(await service(db, VIEW, [a.token])).toMatchObject({
        state_public: "expired",
      })
      const { done } = await joinWith(
        db,
        issued.token as string,
        freshEmail("replaced"),
        testPhone()
      )
      expect(done.outcome).toBe("joined")
      expect(await service(db, VIEW, [a.token])).toMatchObject({
        state_public: "used",
      })
    })
  })
})
