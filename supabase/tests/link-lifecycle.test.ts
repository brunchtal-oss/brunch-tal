// Story 2.4: link lifecycle and mid-join recovery (AD-5, AD-6, AD-10,
// AD-21). admin_issue_link, admin_revoke_link, admin_list_links,
// claiming_at, entitlements.bound_at / expired_before_bound and the input
// correction in join_begin, along the I/O matrix of the spec. Time is
// simulated by updating expires_at / claiming_at as the owner; Auth users are
// rows in auth.users inside the rolled-back transaction (deleting the row
// stands in for the Admin API's deleteUser).

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
const ISSUE = "select public.admin_issue_link($1, $2, $3) as r"
const REVOKE = "select public.admin_revoke_link($1, $2) as r"
const LIST = "select public.admin_list_links() as r"

type Approved = {
  f: MoneyFixture
  token: string
  tokenId: string
  paymentId: string
}

// As the owner on return.
async function approveCard(
  db: Db,
  options: { f?: MoneyFixture; paidOn?: string } = {}
): Promise<Approved> {
  const f = options.f ?? (await seedMoney(db))
  await asAuthenticated(db, f.admin)
  const r = await approve(db, {
    productId: f.card,
    amount: 47200,
    paidOn: options.paidOn ?? f.today,
    methodId: f.method,
    // Several approvals of one fixture are similar payments (2.5).
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
  const digits = (parseInt(testName("").slice(5, 11), 16) + 500 + phoneCounter)
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
    full_name: testName("joiner"),
    dietary_notes: null,
    privacy_consent: true,
    photo_consent: false,
    personal_photo_consent: false,
    babies: [{ name: testName("baby"), birth_date: "2026-09-01" }],
  }
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

async function asUser(
  db: Db,
  userId: string,
  query: string,
  params: unknown[]
) {
  await asAuthenticated(db, userId)
  const { rows } = await db.query(query, params)
  await db.query("reset role")
  return rows[0].r
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

async function tokenRow(db: Db, tokenId: string) {
  const { rows } = await db.query(
    "select * from public.activation_tokens where id = $1",
    [tokenId]
  )
  return rows[0]
}

// Rows of the money tables of a payment, to show nothing was added.
async function moneyCounts(db: Db, paymentId: string) {
  const { rows } = await db.query(
    `select
       (select count(*)::int from public.payments where id = $1) as payments,
       (select count(*)::int from public.entitlements where payment_id = $1) as entitlements,
       (select count(*)::int from public.entitlement_movements m
          join public.entitlements e on e.id = m.entitlement_id
          where e.payment_id = $1) as movements,
       (select count(*)::int from public.activation_tokens
          where payment_id = $1 and state <> 'revoked') as live_links,
       (select customer_id from public.payments where id = $1) as payment_customer,
       (select expires_on::text from public.entitlements where payment_id = $1) as expires_on`,
    [paymentId]
  )
  return rows[0]
}

// Customer A gets an Auth user (her email) and a phone.
async function giveAccount(db: Db, customerId: string, label: string) {
  const { email } = await insertAuthUser(db, label, { id: customerId })
  const phone = testPhone()
  await db.query("update public.profiles set phone_e164 = $1 where id = $2", [
    e164(phone),
    customerId,
  ])
  return { email, phone }
}

// The states a link can be replaced or revoked from (matrix row 1).
type Setup = "pending" | "expired" | "awaiting_login" | "conflict" | "stuck"

async function linkIn(db: Db, setup: Setup): Promise<Approved> {
  const a = await approveCard(db)
  if (setup === "expired") {
    await db.query(
      "update public.activation_tokens set expires_at = now() - interval '1 minute' where id = $1",
      [a.tokenId]
    )
  } else if (setup === "awaiting_login") {
    const account = await giveAccount(db, a.f.customerA, "await")
    await service(db, BEGIN, [
      a.token,
      account.email,
      testPhone(),
      randomUUID(),
    ])
  } else if (setup === "conflict") {
    const accA = await giveAccount(db, a.f.customerA, "conf_a")
    const accB = await giveAccount(db, a.f.customerB, "conf_b")
    await db.query(
      "update public.activation_tokens set identity_attempts = 2 where id = $1",
      [a.tokenId]
    )
    await service(db, BEGIN, [a.token, accA.email, accB.phone, randomUUID()])
  } else if (setup === "stuck") {
    await service(db, BEGIN, [
      a.token,
      freshEmail("stuck"),
      testPhone(),
      randomUUID(),
    ])
    await db.query(
      "update public.activation_tokens set claiming_at = now() - interval '16 minutes' where id = $1",
      [a.tokenId]
    )
  }
  const row = await tokenRow(db, a.tokenId)
  const expected = {
    pending: "pending",
    expired: "pending",
    awaiting_login: "awaiting_login",
    conflict: "conflict",
    stuck: "claiming",
  }[setup]
  expect(row.state).toBe(expected)
  return a
}

async function issue(db: Db, a: Approved, key = randomUUID()) {
  return asUser(db, a.f.admin, ISSUE, ["join", a.paymentId, key]) as Promise<
    Record<string, unknown>
  >
}

async function list(db: Db, adminId: string) {
  return (await asUser(db, adminId, LIST, [])) as Array<Record<string, unknown>>
}

const SETUPS: Setup[] = [
  "pending",
  "expired",
  "awaiting_login",
  "conflict",
  "stuck",
]

describe("admin_issue_link (replacement)", () => {
  it.each(SETUPS)(
    "revokes a %s link and issues a new pending one for 48 hours on the same payment",
    async (setup) => {
      await inRollback(async (db) => {
        const a = await linkIn(db, setup)
        const before = await moneyCounts(db, a.paymentId)

        const r = await issue(db, a)
        expect(r).toMatchObject({
          reissue_required: false,
          token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        })
        expect(r.token_id).not.toBe(a.tokenId)

        expect(await tokenRow(db, a.tokenId)).toMatchObject({
          state: "revoked",
          revoked_at: expect.any(Date),
        })
        const fresh = await tokenRow(db, r.token_id as string)
        expect(fresh).toMatchObject({
          state: "pending",
          purpose: "join",
          payment_id: a.paymentId,
          identity_attempts: 0,
          bound_user_id: null,
        })
        const { rows } = await db.query(
          "select (expires_at - now()) = interval '48 hours' as exact from public.activation_tokens where id = $1",
          [fresh.id]
        )
        expect(rows[0].exact).toBe(true)

        // Payment and entitlement unchanged; one live link.
        expect(await moneyCounts(db, a.paymentId)).toEqual(before)
        // The old link reads as expired, the new one works.
        expect(await service(db, VIEW, [a.token])).toMatchObject({
          state_public: "expired",
        })
        expect(await service(db, VIEW, [r.token])).toMatchObject({
          state_public: "active",
          product_name: testName("card"),
        })
        expect(
          await serviceError(db, BEGIN, [
            a.token,
            freshEmail("old"),
            testPhone(),
            randomUUID(),
          ])
        ).toMatchObject({ code: "P0001", message: "LINK_EXPIRED" })
        expect(
          await service(db, BEGIN, [
            r.token,
            freshEmail("new"),
            testPhone(),
            randomUUID(),
          ])
        ).toMatchObject({ outcome: "claiming" })
      })
    }
  )

  it("returns the same result without the token for the same key (reissue_required)", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const key = randomUUID()
      const first = await issue(db, a, key)
      const again = await issue(db, a, key)
      expect(again).toEqual({
        token_id: first.token_id,
        link_expires_at: first.link_expires_at,
        revoked_pending_user_id: null,
        reissue_required: true,
      })
      expect(again).not.toHaveProperty("token")
      const { rows } = await db.query(
        "select count(*)::int as n from public.activation_tokens where payment_id = $1",
        [a.paymentId]
      )
      expect(rows[0].n).toBe(2)
    })
  })

  it("never stores the raw token in the idempotency result or the audit log", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const r = await issue(db, a)
      const { rows } = await db.query(
        `select
           (select count(*)::int from private.idempotency_results
             where result::text like '%' || $1 || '%') as stored,
           (select count(*)::int from public.audit_log
             where before::text || after::text like '%' || $1 || '%') as audited`,
        [r.token]
      )
      expect(rows[0]).toEqual({ stored: 0, audited: 0 })
    })
  })

  it("returns the pending Auth user of a revoked stuck claiming link", async () => {
    await inRollback(async (db) => {
      const a = await linkIn(db, "stuck")
      const pending = (await tokenRow(db, a.tokenId)).pending_user_id
      await insertAuthUser(db, "stuck_user", { id: pending })
      const r = await issue(db, a)
      expect(r.revoked_pending_user_id).toBe(pending)
    })
  })

  it("refuses another purpose or a missing target with INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      for (const params of [
        ["reset", a.paymentId, randomUUID()],
        ["claim", a.paymentId, randomUUID()],
        ["join", null, randomUUID()],
        ["join", randomUUID(), randomUUID()],
      ]) {
        expect(await asUserError(db, a.f.admin, ISSUE, params)).toMatchObject({
          code: "P0001",
          message: "INVALID_INPUT",
        })
      }
    })
  })
})

describe("blocked links", () => {
  async function consumed(db: Db) {
    const a = await approveCard(db)
    const email = freshEmail("used")
    const phone = testPhone()
    const begun = await service(db, BEGIN, [
      a.token,
      email,
      phone,
      randomUUID(),
    ])
    await insertAuthUser(db, "used", { id: begun.pending_user_id as string })
    await service(db, COMPLETE, [
      a.token,
      JSON.stringify(profile(email, phone)),
      randomUUID(),
    ])
    return a
  }

  async function bound(db: Db) {
    const a = await approveCard(db)
    await db.query(
      "update public.payments set customer_id = $2 where id = $1",
      [a.paymentId, a.f.customerA]
    )
    return a
  }

  async function fresh(db: Db) {
    const a = await approveCard(db)
    await service(db, BEGIN, [
      a.token,
      freshEmail("fresh"),
      testPhone(),
      randomUUID(),
    ])
    return a
  }

  it.each([
    ["consumed", consumed, "LINK_USED"],
    ["bound", bound, "LINK_USED"],
    ["fresh claiming", fresh, "LINK_IN_PROGRESS"],
  ] as const)(
    "refuses to replace or revoke a %s link, changing nothing",
    async (_label, setup, code) => {
      await inRollback(async (db) => {
        const a = await setup(db)
        const before = await tokenRow(db, a.tokenId)
        const money = await moneyCounts(db, a.paymentId)

        expect(
          await asUserError(db, a.f.admin, ISSUE, [
            "join",
            a.paymentId,
            randomUUID(),
          ])
        ).toMatchObject({ code: "P0001", message: code })
        expect(
          await asUserError(db, a.f.admin, REVOKE, [a.tokenId, randomUUID()])
        ).toMatchObject({ code: "P0001", message: code })

        expect(await tokenRow(db, a.tokenId)).toEqual(before)
        expect(await moneyCounts(db, a.paymentId)).toEqual(money)
      })
    }
  )
})

describe("admin_revoke_link", () => {
  it.each(SETUPS)(
    "revokes a %s link; a replacement is possible afterwards",
    async (setup) => {
      await inRollback(async (db) => {
        const a = await linkIn(db, setup)
        const money = await moneyCounts(db, a.paymentId)
        const key = randomUUID()
        const r = (await asUser(db, a.f.admin, REVOKE, [
          a.tokenId,
          key,
        ])) as Record<string, unknown>
        expect(r.token_id).toBe(a.tokenId)
        expect(await tokenRow(db, a.tokenId)).toMatchObject({
          state: "revoked",
        })
        expect(await service(db, VIEW, [a.token])).toMatchObject({
          state_public: "expired",
        })
        // The same key returns the same result.
        expect(await asUser(db, a.f.admin, REVOKE, [a.tokenId, key])).toEqual(r)
        // Revoking again with a new key changes nothing.
        expect(
          await asUser(db, a.f.admin, REVOKE, [a.tokenId, randomUUID()])
        ).toEqual({ token_id: a.tokenId, revoked_pending_user_id: null })

        const replaced = await issue(db, a)
        expect(await tokenRow(db, replaced.token_id as string)).toMatchObject({
          state: "pending",
        })
        expect(await moneyCounts(db, a.paymentId)).toEqual(money)
      })
    }
  )

  it("returns the pending user of a stuck claiming link only when it has no profile", async () => {
    await inRollback(async (db) => {
      const a = await linkIn(db, "stuck")
      const pending = (await tokenRow(db, a.tokenId)).pending_user_id
      const r = (await asUser(db, a.f.admin, REVOKE, [
        a.tokenId,
        randomUUID(),
      ])) as Record<string, unknown>
      expect(r.revoked_pending_user_id).toBe(pending)
    })
    await inRollback(async (db) => {
      const a = await linkIn(db, "stuck")
      const pending = (await tokenRow(db, a.tokenId)).pending_user_id
      // A profile with that id (never expected for claiming): not returned.
      await db.query(
        "insert into public.profiles (id, full_name, activated_at) values ($1, $2, now())",
        [pending, testName("has_profile")]
      )
      const r = (await asUser(db, a.f.admin, REVOKE, [
        a.tokenId,
        randomUUID(),
      ])) as Record<string, unknown>
      expect(r.revoked_pending_user_id).toBeNull()
    })
  })

  it("refuses an unknown token or a reset link with INVALID_INPUT", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      expect(
        await asUserError(db, f.admin, REVOKE, [randomUUID(), randomUUID()])
      ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })

      const { rows } = await db.query(
        "select private.issue_token('reset', $1) as r",
        [f.customerA]
      )
      const resetId = rows[0].r.token_id as string
      expect(
        await asUserError(db, f.admin, REVOKE, [resetId, randomUUID()])
      ).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      expect(await tokenRow(db, resetId)).toMatchObject({ state: "pending" })
    })
  })
})

describe("permissions", () => {
  it("refuses a customer with NOT_AUTHORIZED and anon with 42501", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      for (const [query, params] of [
        [ISSUE, ["join", a.paymentId, randomUUID()]],
        [REVOKE, [a.tokenId, randomUUID()]],
        [LIST, []],
      ] as const) {
        expect(
          await asUserError(db, a.f.customerA, query, [...params])
        ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
        await db.query("set local role anon")
        expect((await queryError(db, query, [...params]))?.code).toBe("42501")
        await db.query("reset role")
        await db.query("set local role service_role")
        expect((await queryError(db, query, [...params]))?.code).toBe("42501")
        await db.query("reset role")
      }
      expect(await tokenRow(db, a.tokenId)).toMatchObject({ state: "pending" })
    })
  })

  it("gives no grant on the new private helpers", async () => {
    await inRollback(async (db) => {
      for (const role of ["authenticated", "service_role", "anon"]) {
        for (const [query, params] of [
          ["select private.lock_join_payment($1)", [randomUUID()]],
          [
            "select private.join_link_status(null::public.activation_tokens)",
            [],
          ],
          [
            "select private.revoke_join_token(null::public.activation_tokens, $1)",
            [randomUUID()],
          ],
        ] as const) {
          await db.query(`set local role ${role}`)
          expect((await queryError(db, query, [...params]))?.code).toBe("42501")
          await db.query("reset role")
        }
      }
    })
  })
})

describe("an expired link", () => {
  it("answers LINK_EXPIRED after 48 hours and leaves the purchase unbound", async () => {
    await inRollback(async (db) => {
      const a = await linkIn(db, "expired")
      expect(
        await serviceError(db, BEGIN, [
          a.token,
          freshEmail("late"),
          testPhone(),
          randomUUID(),
        ])
      ).toMatchObject({ code: "P0001", message: "LINK_EXPIRED" })
      expect(await service(db, VIEW, [a.token])).toMatchObject({
        state_public: "expired",
      })
      expect(await moneyCounts(db, a.paymentId)).toMatchObject({
        payment_customer: null,
      })
      const { rows } = await db.query(
        "select customer_id from public.entitlements where payment_id = $1",
        [a.paymentId]
      )
      expect(rows[0].customer_id).toBeNull()
    })
  })
})

describe("join_begin: failure in the middle and corrections", () => {
  it("sets claiming_at on entering claiming", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      await service(db, BEGIN, [
        a.token,
        freshEmail("at"),
        testPhone(),
        randomUUID(),
      ])
      const { rows } = await db.query(
        "select claiming_at = now() as now_at from public.activation_tokens where id = $1",
        [a.tokenId]
      )
      expect(rows[0].now_at).toBe(true)
      expect(
        (
          await queryError(
            db,
            "update public.activation_tokens set claiming_at = null where id = $1",
            [a.tokenId]
          )
        )?.code
      ).toBe("23514")
    })
  })

  it("continues a claiming link with the same input: the same pending user, one Auth user, join_complete succeeds", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = freshEmail("mid")
      const phone = testPhone()
      const first = await service(db, BEGIN, [
        a.token,
        email,
        phone,
        randomUUID(),
      ])
      await insertAuthUser(db, "mid", { id: first.pending_user_id as string })

      const again = await service(db, BEGIN, [
        a.token,
        email,
        phone,
        randomUUID(),
      ])
      expect(again).toEqual(first)
      const done = await service(db, COMPLETE, [
        a.token,
        JSON.stringify(profile(email, phone)),
        randomUUID(),
      ])
      expect(done).toMatchObject({
        outcome: "joined",
        customer_id: first.pending_user_id,
      })
      const { rows } = await db.query(
        "select count(*)::int as n from auth.users where lower(email) = $1",
        [email]
      )
      expect(rows[0].n).toBe(1)
    })
  })

  it("resets a claiming link without an Auth user (email_exists) and classifies the corrected input", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const first = await service(db, BEGIN, [
        a.token,
        freshEmail("taken"),
        testPhone(),
        randomUUID(),
      ])
      const fixed = await service(db, BEGIN, [
        a.token,
        freshEmail("fixed"),
        testPhone(),
        randomUUID(),
      ])
      expect(fixed).toMatchObject({ outcome: "claiming", token_id: a.tokenId })
      expect(fixed.pending_user_id).not.toBe(first.pending_user_id)
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "claiming",
        identity_attempts: 1,
      })
    })
  })

  it("asks to discard the Auth user of the previous input, then resets once it is gone", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const first = await service(db, BEGIN, [
        a.token,
        freshEmail("prev"),
        testPhone(),
        randomUUID(),
      ])
      const pending = first.pending_user_id as string
      await insertAuthUser(db, "prev", { id: pending })

      const email = freshEmail("next")
      const phone = testPhone()
      const key = randomUUID()
      const discard = await service(db, BEGIN, [a.token, email, phone, key])
      expect(discard).toEqual({
        outcome: "discard_pending_user",
        token_id: a.tokenId,
        pending_user_id: pending,
      })
      // No state change; the same key returns the same answer.
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "claiming",
        pending_user_id: pending,
        identity_attempts: 0,
      })
      expect(await service(db, BEGIN, [a.token, email, phone, key])).toEqual(
        discard
      )

      // The server deletes the user (Admin API) and asks with a new key.
      await db.query("delete from auth.users where id = $1", [pending])
      const fixed = await service(db, BEGIN, [
        a.token,
        email,
        phone,
        randomUUID(),
      ])
      expect(fixed).toMatchObject({ outcome: "claiming" })
      expect(fixed.pending_user_id).not.toBe(pending)
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        identity_attempts: 1,
      })

      // And the join completes.
      await insertAuthUser(db, "next", { id: fixed.pending_user_id as string })
      expect(
        await service(db, COMPLETE, [
          a.token,
          JSON.stringify(profile(email, phone)),
          randomUUID(),
        ])
      ).toMatchObject({ outcome: "joined" })
    })
  })

  it("checks new input on an awaiting_login link again and clears bound_user_id when it is no account", async () => {
    await inRollback(async (db) => {
      const a = await linkIn(db, "awaiting_login")
      const r = await service(db, BEGIN, [
        a.token,
        freshEmail("not_me"),
        testPhone(),
        randomUUID(),
      ])
      expect(r).toMatchObject({ outcome: "claiming", token_id: a.tokenId })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "claiming",
        bound_user_id: null,
        identity_attempts: 1,
      })
    })
  })

  it("refuses a correction on an expired claiming link with LINK_EXPIRED, while the same input continues", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = freshEmail("exp")
      const phone = testPhone()
      const first = await service(db, BEGIN, [
        a.token,
        email,
        phone,
        randomUUID(),
      ])
      await db.query(
        "update public.activation_tokens set expires_at = now() - interval '1 minute' where id = $1",
        [a.tokenId]
      )
      expect(
        await serviceError(db, BEGIN, [
          a.token,
          freshEmail("exp2"),
          testPhone(),
          randomUUID(),
        ])
      ).toMatchObject({ code: "P0001", message: "LINK_EXPIRED" })
      expect(
        await service(db, BEGIN, [a.token, email, phone, randomUUID()])
      ).toEqual(first)
    })
  })

  it("asks to discard the Auth user before locking a link with two corrections, so no orphan stays", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const first = await service(db, BEGIN, [
        a.token,
        freshEmail("lock_prev"),
        testPhone(),
        randomUUID(),
      ])
      const pending = first.pending_user_id as string
      await insertAuthUser(db, "lock_prev", { id: pending })
      await db.query(
        "update public.activation_tokens set identity_attempts = 2 where id = $1",
        [a.tokenId]
      )

      const email = freshEmail("lock_next")
      const phone = testPhone()
      expect(
        await service(db, BEGIN, [a.token, email, phone, randomUUID()])
      ).toEqual({
        outcome: "discard_pending_user",
        token_id: a.tokenId,
        pending_user_id: pending,
      })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({ state: "claiming" })

      await db.query("delete from auth.users where id = $1", [pending])
      expect(
        await service(db, BEGIN, [a.token, email, phone, randomUUID()])
      ).toEqual({
        outcome: "conflict",
        token_id: a.tokenId,
        reason: "too_many_attempts",
      })
      const { rows } = await db.query(
        "select count(*)::int as n from auth.users where id = $1",
        [pending]
      )
      expect(rows[0].n).toBe(0)
    })
  })

  it("locks the link as too_many_attempts on the fourth different input", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      // Attempts 1 to 3: the first input and two corrections.
      for (const label of ["try1", "try2", "try3"]) {
        expect(
          await service(db, BEGIN, [
            a.token,
            freshEmail(label),
            testPhone(),
            randomUUID(),
          ])
        ).toMatchObject({ outcome: "claiming" })
      }
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        identity_attempts: 2,
      })
      expect(
        await service(db, BEGIN, [
          a.token,
          freshEmail("try4"),
          testPhone(),
          randomUUID(),
        ])
      ).toEqual({
        outcome: "conflict",
        token_id: a.tokenId,
        reason: "too_many_attempts",
      })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "conflict",
        conflict_reason: "too_many_attempts",
        identity_attempts: 2,
      })
      expect(await service(db, VIEW, [a.token])).toMatchObject({
        state_public: "conflict",
        conflict_reason: "too_many_attempts",
      })
    })
  })
})

describe("a card that expired before the join", () => {
  it("is bound with its expiry unchanged, marked expired_before_bound and shown on /me", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const { rows: dates } = await db.query(
        "select ($1::date - 50)::text as paid_on",
        [f.today]
      )
      const a = await approveCard(db, { f, paidOn: dates[0].paid_on })
      const before = await moneyCounts(db, a.paymentId)

      const email = freshEmail("old_card")
      const phone = testPhone()
      const begun = await service(db, BEGIN, [
        a.token,
        email,
        phone,
        randomUUID(),
      ])
      const userId = begun.pending_user_id as string
      await insertAuthUser(db, "old_card", { id: userId })
      expect(
        await service(db, COMPLETE, [
          a.token,
          JSON.stringify(profile(email, phone)),
          randomUUID(),
        ])
      ).toMatchObject({ outcome: "joined" })

      const { rows } = await db.query(
        "select customer_id, expires_on::text as expires_on, bound_at = now() as bound_now from public.entitlements where payment_id = $1",
        [a.paymentId]
      )
      expect(rows[0]).toEqual({
        customer_id: userId,
        expires_on: before.expires_on,
        bound_now: true,
      })

      // The /me query, as the customer.
      await asAuthenticated(db, userId)
      const { rows: shown } = await db.query(
        `select is_expired, expired_before_bound
         from public.entitlement_balances
         where status = 'active' and (is_expired = false or expired_before_bound = true)`
      )
      await db.query("reset role")
      expect(shown).toEqual([{ is_expired: true, expired_before_bound: true }])
    })
  })

  it("is not expired_before_bound for a card bound in time", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = freshEmail("in_time")
      const phone = testPhone()
      const begun = await service(db, BEGIN, [
        a.token,
        email,
        phone,
        randomUUID(),
      ])
      await insertAuthUser(db, "in_time", {
        id: begun.pending_user_id as string,
      })
      expect(
        await service(db, COMPLETE, [
          a.token,
          JSON.stringify(profile(email, phone)),
          randomUUID(),
        ])
      ).toMatchObject({ outcome: "joined" })
      const { rows } = await db.query(
        `select b.expired_before_bound, b.is_expired, e.bound_at is not null as bound
         from public.entitlement_balances b
         join public.entitlements e on e.id = b.entitlement_id
         where b.payment_id = $1`,
        [a.paymentId]
      )
      expect(rows[0]).toEqual({
        expired_before_bound: false,
        is_expired: false,
        bound: true,
      })
    })
  })
})

describe("reading changes nothing", () => {
  it("leaves state, identity_attempts and claiming_at after token_view twice and admin_list_links", async () => {
    await inRollback(async (db) => {
      const a = await linkIn(db, "stuck")
      const before = await tokenRow(db, a.tokenId)
      await service(db, VIEW, [a.token])
      await service(db, VIEW, [a.token])
      await list(db, a.f.admin)
      const after = await tokenRow(db, a.tokenId)
      expect(after).toEqual(before)
    })
  })
})

describe("admin_list_links", () => {
  it("lists every state with its status, detail, name and actions, newest first", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const pending = await approveCard(db, { f })

      const awaiting = await approveCard(db, { f })
      const account = await giveAccount(db, f.customerA, "list_a")
      await service(db, BEGIN, [
        awaiting.token,
        account.email,
        testPhone(),
        randomUUID(),
      ])

      const stuck = await approveCard(db, { f })
      await service(db, BEGIN, [
        stuck.token,
        freshEmail("list_stuck"),
        testPhone(),
        randomUUID(),
      ])
      await db.query(
        "update public.activation_tokens set claiming_at = now() - interval '20 minutes' where id = $1",
        [stuck.tokenId]
      )

      const used = await approveCard(db, { f })
      const email = freshEmail("list_used")
      const phone = testPhone()
      const begun = await service(db, BEGIN, [
        used.token,
        email,
        phone,
        randomUUID(),
      ])
      await insertAuthUser(db, "list_used", {
        id: begun.pending_user_id as string,
      })
      await service(db, COMPLETE, [
        used.token,
        JSON.stringify(profile(email, phone)),
        randomUUID(),
      ])

      const expired = await linkIn(db, "expired")
      const revoked = await approveCard(db, { f })
      const replacement = await issue(db, revoked)

      const rows = await list(db, f.admin)
      const byId = new Map(rows.map((row) => [row.token_id, row]))
      // Never the token or its hash.
      expect(JSON.stringify(rows)).not.toContain(pending.token)
      expect(JSON.stringify(rows)).not.toContain("token_hash")

      expect(byId.get(pending.tokenId)).toMatchObject({
        payment_id: pending.paymentId,
        status: "pending",
        detail: null,
        product_name: testName("card"),
        amount_agorot: 47200,
        paid_on: f.today,
        customer_name: null,
        can_revoke: true,
        can_replace: true,
      })
      expect(byId.get(awaiting.tokenId)).toMatchObject({
        status: "pending",
        detail: "awaiting_login",
        detail_name: testName("money_a"),
      })
      expect(byId.get(stuck.tokenId)).toMatchObject({
        status: "pending",
        detail: "stuck",
        can_revoke: true,
        can_replace: true,
      })
      expect(byId.get(used.tokenId)).toMatchObject({
        status: "consumed",
        customer_name: testName("joiner"),
        consumed_at: expect.any(String),
        can_revoke: false,
        can_replace: false,
      })
      expect(byId.get(expired.tokenId)).toMatchObject({
        status: "expired",
        can_revoke: true,
        can_replace: true,
      })
      expect(byId.get(revoked.tokenId)).toMatchObject({
        status: "revoked",
        revoked_at: expect.any(String),
        can_revoke: false,
        can_replace: false,
      })
      expect(byId.get(replacement.token_id as string)).toMatchObject({
        status: "pending",
        can_replace: true,
      })

      // Newest first.
      const created = rows.map((row) => row.created_at as string)
      expect([...created].sort().reverse()).toEqual(created)
    })
  }, 30_000)

  it("lets only the last revoked link of a payment without a live link be replaced", async () => {
    await inRollback(async (db) => {
      // One link, revoked.
      const only = await approveCard(db)
      await asUser(db, only.f.admin, REVOKE, [only.tokenId, randomUUID()])

      // Two links, both revoked; the first one earlier.
      const two = await approveCard(db, { f: only.f })
      const second = await issue(db, two)
      await asUser(db, two.f.admin, REVOKE, [
        second.token_id as string,
        randomUUID(),
      ])
      await db.query(
        "update public.activation_tokens set revoked_at = now() - interval '1 hour' where id = $1",
        [two.tokenId]
      )

      const rows = await list(db, only.f.admin)
      const byId = new Map(rows.map((row) => [row.token_id, row]))
      expect(byId.get(only.tokenId)).toMatchObject({
        status: "revoked",
        can_revoke: false,
        can_replace: true,
      })
      expect(byId.get(two.tokenId)).toMatchObject({
        status: "revoked",
        can_revoke: false,
        can_replace: false,
      })
      expect(byId.get(second.token_id)).toMatchObject({
        status: "revoked",
        can_revoke: false,
        can_replace: true,
      })
    })
  })

  it("blocks the actions of a fresh claiming link and shows a conflict with its reason", async () => {
    await inRollback(async (db) => {
      const fresh = await approveCard(db)
      await service(db, BEGIN, [
        fresh.token,
        freshEmail("list_fresh"),
        testPhone(),
        randomUUID(),
      ])
      const conflict = await linkIn(db, "conflict")
      const rows = await list(db, fresh.f.admin)
      const byId = new Map(rows.map((row) => [row.token_id, row]))
      expect(byId.get(fresh.tokenId)).toMatchObject({
        status: "pending",
        detail: null,
        can_revoke: false,
        can_replace: false,
      })
      expect(byId.get(conflict.tokenId)).toMatchObject({
        status: "pending",
        detail: "conflict",
        conflict_reason: "two_accounts",
        can_revoke: true,
        can_replace: true,
      })
    })
  })
})
