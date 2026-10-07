// Story 2.2: the join flow (AD-10, AD-21): token_view of a join link,
// join_begin, join_complete and private.bind_purchase, along the I/O matrix
// of the spec. Auth users are rows inserted in auth.users inside the
// rolled-back transaction (insertAuthUser stands in for createUser).

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { cleanToken } from "@/lib/auth/clean-token"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  insertAuthUser,
  queryError,
  sql,
  testName,
  type Db,
} from "./support/db"
import { approve, seedMoney, type MoneyFixture } from "./support/money"

const BEGIN = "select public.join_begin($1, $2, $3, $4) as r"
const COMPLETE = "select public.join_complete($1, $2::jsonb, $3) as r"
const VIEW = "select public.token_view($1) as r"

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

// A phone of this run: 05X + 7 digits from the run id, unique per label.
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

function profile(
  email: string,
  phone: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    email,
    phone,
    full_name: testName("joiner"),
    dietary_notes: null,
    privacy_consent: true,
    photo_consent: false,
    personal_photo_consent: false,
    babies: [{ name: testName("baby"), birth_date: "2026-09-01" }],
    ...overrides,
  }
}

async function call(
  db: Db,
  query: string,
  params: unknown[]
): Promise<Record<string, unknown>> {
  await asServiceRole(db)
  const { rows } = await db.query(query, params)
  await db.query("reset role")
  return rows[0].r
}

async function callError(db: Db, query: string, params: unknown[]) {
  await asServiceRole(db)
  const error = await queryError(db, query, params)
  await db.query("reset role")
  return error
}

async function errorDetail(db: Db, query: string, params: unknown[]) {
  await asServiceRole(db)
  await db.query("savepoint detail")
  try {
    await db.query(query, params)
    throw new Error("expected an error")
  } catch (error) {
    await db.query("rollback to savepoint detail")
    await db.query("reset role")
    const { message, detail } = error as { message: string; detail?: string }
    return { message, detail: detail ? JSON.parse(detail) : null }
  }
}

// begin -> Auth user (pending_user_id) -> complete, as the TS orchestrator.
async function join(
  db: Db,
  a: Approved,
  options: {
    label?: string
    phone?: string
    key?: string
    profile?: Record<string, unknown>
  } = {}
) {
  const label = options.label ?? "joiner"
  const email = `${testName(label)}@example.test`.toLowerCase()
  const phone = options.phone ?? testPhone()
  const key = options.key ?? randomUUID()
  const begun = await call(db, BEGIN, [a.token, email, phone, key])
  expect(begun.outcome).toBe("claiming")
  const userId = begun.pending_user_id as string
  await insertAuthUser(db, label, { id: userId })
  const done = await call(db, COMPLETE, [
    a.token,
    JSON.stringify(profile(email, phone, options.profile)),
    key,
  ])
  return { email, phone, key, userId, done }
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

describe("token_view of a join link", () => {
  it("shows the product name and the amount paid while active", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      expect(await call(db, VIEW, [a.token])).toMatchObject({
        state_public: "active",
        purpose: "join",
        product_name: testName("card"),
        amount_agorot: 47200,
      })
    })
  })

  it("reads a token pasted with invisible direction marks as the same link", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const pasted = cleanToken(`%E2%80%8F${a.token}%E2%80%8E`)
      expect(pasted).toBe(a.token)
      expect(await call(db, VIEW, [pasted])).toMatchObject({
        state_public: "active",
      })
    })
  })

  it("stays active while claiming, and shows no product once used", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = `${testName("view")}@example.test`
      await call(db, BEGIN, [a.token, email, testPhone(), randomUUID()])
      expect(await call(db, VIEW, [a.token])).toMatchObject({
        state_public: "active",
      })
      await db.query(
        "update public.activation_tokens set state = 'consumed', consumed_at = now() where id = $1",
        [a.tokenId]
      )
      expect(await call(db, VIEW, [a.token])).toMatchObject({
        state_public: "used",
        product_name: null,
        amount_agorot: null,
      })
    })
  })
})

describe("join", () => {
  it("activates the profile, binds the purchase, consumes the link and queues one notification", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const { userId, phone, done } = await join(db, a, {
        profile: {
          dietary_notes: "  ",
          photo_consent: true,
          personal_photo_consent: false,
        },
      })

      expect(done).toEqual({
        outcome: "joined",
        token_id: a.tokenId,
        customer_id: userId,
        payment_id: a.paymentId,
      })

      const { rows: profiles } = await db.query(
        "select * from public.profiles where id = $1",
        [userId]
      )
      expect(profiles).toHaveLength(1)
      const p = profiles[0]
      // The privacy policy is editable since 5.5, so the shared dev database
      // may hold a published version.
      const { rows: privacy } = await db.query(
        "select published_version from public.content_pages where slug = 'privacy'"
      )
      // Both photo consents carry the join-form published version.
      const { rows: joinForm } = await db.query(
        "select published_version from public.content_pages where slug = 'join-form'"
      )
      expect(p).toMatchObject({
        full_name: testName("joiner"),
        phone_e164: e164(phone),
        dietary_notes: null,
        photo_consent: true,
        photo_consent_text_version: joinForm[0].published_version,
        personal_photo_consent: false,
        personal_photo_consent_text_version: joinForm[0].published_version,
        privacy_policy_version: privacy[0].published_version,
        anonymized_at: null,
      })
      expect(p.activated_at).not.toBeNull()
      expect(p.privacy_consent_at).not.toBeNull()
      expect(p.photo_consent_at).not.toBeNull()
      expect(p.personal_photo_consent_at).toEqual(p.photo_consent_at)

      expect(
        await count(db, "select 1 from public.babies where customer_id = $1", [
          userId,
        ])
      ).toBe(1)
      const { rows: bound } = await db.query(
        `select
           (select customer_id from public.payments where id = $1) as payment,
           (select customer_id from public.entitlements where payment_id = $1) as entitlement`,
        [a.paymentId]
      )
      expect(bound[0]).toEqual({ payment: userId, entitlement: userId })

      const token = await tokenRow(db, a.tokenId)
      expect(token).toMatchObject({ state: "consumed", customer_id: userId })

      const { rows: notes } = await db.query(
        `select n.type, n.target_path, n.dedupe_key,
                (select count(*)::int from public.notification_jobs j where j.notification_id = n.id) as jobs
         from public.notifications n where n.recipient_id = $1`,
        [userId]
      )
      expect(notes).toEqual([
        {
          type: "purchase_new_card",
          target_path: "/me",
          dedupe_key: `purchase_new_card:${userId}:${a.paymentId}`,
          jobs: 1,
        },
      ])

      // /me: 4 available, valid until the end of paid_on + 49.
      await asAuthenticated(db, userId)
      const { rows: balances } = await db.query(
        `select available, reserved, (expires_on - valid_from) as days,
                expires_on = $1::date + 49 as from_paid_on
         from public.entitlement_balances`,
        [a.f.today]
      )
      expect(balances).toEqual([
        { available: 4, reserved: 0, days: 49, from_paid_on: true },
      ])
    })
  })

  it("stores the dietary notes and a yes to photos, and audits without personal data", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const { userId, email, phone } = await join(db, a, {
        profile: { dietary_notes: " no nuts ", photo_consent: true },
      })
      const { rows } = await db.query(
        "select dietary_notes, photo_consent from public.profiles where id = $1",
        [userId]
      )
      expect(rows[0]).toEqual({ dietary_notes: "no nuts", photo_consent: true })

      const { rows: audit } = await db.query(
        `select actor_id, actor_kind, action, entity_type, before::text || after::text as diff
         from public.audit_log where customer_id = $1 order by created_at, entity_type`,
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
        for (const secret of [email, phone, e164(phone), "no nuts", a.token]) {
          expect(row.diff).not.toContain(secret)
        }
        expect(row.diff).not.toContain(testName("joiner"))
      }
    })
  })

  it("returns the same result for the same key and LINK_USED for another, all once", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const { email, phone, key, done, userId } = await join(db, a)
      const body = JSON.stringify(profile(email, phone))

      expect(await call(db, COMPLETE, [a.token, body, key])).toEqual(done)
      // A lost response: begin with the same key answers the stored result.
      expect(await call(db, BEGIN, [a.token, email, phone, key])).toEqual(done)

      const other = randomUUID()
      expect(
        await callError(db, BEGIN, [a.token, email, phone, other])
      ).toMatchObject({ code: "P0001", message: "LINK_USED" })
      expect(
        await callError(db, COMPLETE, [a.token, body, other])
      ).toMatchObject({
        code: "P0001",
        message: "LINK_USED",
      })

      expect(
        await count(db, "select 1 from public.profiles where id = $1", [userId])
      ).toBe(1)
      expect(
        await count(db, "select 1 from public.babies where customer_id = $1", [
          userId,
        ])
      ).toBe(1)
      expect(
        await count(
          db,
          "select 1 from public.notifications where recipient_id = $1",
          [userId]
        )
      ).toBe(1)
    })
  })

  it("survives a failure in the middle: claiming, nothing bound, and a retry completes once", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = `${testName("retry")}@example.test`
      const phone = testPhone()
      const first = await call(db, BEGIN, [a.token, email, phone, randomUUID()])
      expect(first.outcome).toBe("claiming")
      await insertAuthUser(db, "retry", { id: first.pending_user_id as string })

      // join_complete never ran.
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "claiming",
        pending_user_id: first.pending_user_id,
      })
      expect(
        await count(db, "select 1 from public.profiles where id = $1", [
          first.pending_user_id,
        ])
      ).toBe(0)
      expect(
        await count(
          db,
          "select 1 from public.payments where id = $1 and customer_id is null",
          [a.paymentId]
        )
      ).toBe(1)

      // The retry (a new page load, a new key) gets the same Auth user, also
      // after the link's expiry.
      await db.query(
        "update public.activation_tokens set expires_at = now() - interval '1 minute' where id = $1",
        [a.tokenId]
      )
      const key = randomUUID()
      const again = await call(db, BEGIN, [a.token, email, phone, key])
      expect(again).toEqual(first)
      const done = await call(db, COMPLETE, [
        a.token,
        JSON.stringify(profile(email, phone)),
        key,
      ])
      expect(done).toMatchObject({
        outcome: "joined",
        customer_id: first.pending_user_id,
      })
      expect(
        await count(
          db,
          "select 1 from public.entitlements where payment_id = $1 and customer_id = $2",
          [a.paymentId, first.pending_user_id]
        )
      ).toBe(1)
    })
  })

  it("asks to discard the Auth user for other input while claiming (story 2.4), and join_complete still refuses other input with LINK_IN_USE", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = `${testName("in_use")}@example.test`
      const phone = testPhone()
      const begun = await call(db, BEGIN, [a.token, email, phone, randomUUID()])
      await insertAuthUser(db, "in_use", {
        id: begun.pending_user_id as string,
      })

      const otherPhone = testPhone()
      expect(
        await call(db, BEGIN, [a.token, email, otherPhone, randomUUID()])
      ).toEqual({
        outcome: "discard_pending_user",
        token_id: a.tokenId,
        pending_user_id: begun.pending_user_id,
      })
      expect(
        await callError(db, COMPLETE, [
          a.token,
          JSON.stringify(profile(email, otherPhone)),
          randomUUID(),
        ])
      ).toMatchObject({ code: "P0001", message: "LINK_IN_USE" })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "claiming",
        pending_user_id: begun.pending_user_id,
        identity_attempts: 0,
      })
    })
  })

  it.each([
    [
      "no privacy consent",
      { privacy_consent: false },
      "CONSENT_REQUIRED",
      null,
    ],
    [
      "no photo answer",
      { photo_consent: null },
      "INVALID_INPUT",
      { field: "photo_consent" },
    ],
    [
      "no personal photo answer",
      { personal_photo_consent: null },
      "INVALID_INPUT",
      { field: "personal_photo_consent" },
    ],
    [
      // undefined: JSON.stringify drops the key, so p_profile lacks it.
      "a profile without the personal photo key",
      { personal_photo_consent: undefined },
      "INVALID_INPUT",
      { field: "personal_photo_consent" },
    ],
    [
      "a personal photo answer that is not a boolean",
      { personal_photo_consent: "yes" },
      "INVALID_INPUT",
      { field: "personal_photo_consent" },
    ],
    ["no baby", { babies: [] }, "INVALID_INPUT", { field: "babies" }],
    [
      "a birth date in the future",
      { babies: [{ name: "x", birth_date: "2999-01-01" }] },
      "INVALID_INPUT",
      { field: "birth_date", index: 0 },
    ],
    [
      "a second baby without a name",
      {
        babies: [
          { name: "x", birth_date: "2026-09-01" },
          { name: " ", birth_date: "2026-09-01" },
        ],
      },
      "INVALID_INPUT",
      { field: "baby_name", index: 1 },
    ],
    [
      "no full name",
      { full_name: "  " },
      "INVALID_INPUT",
      { field: "full_name" },
    ],
  ])(
    "refuses %s and creates no profile",
    async (_label, overrides, code, detail) => {
      await inRollback(async (db) => {
        const a = await approveCard(db)
        const email = `${testName("missing")}@example.test`
        const phone = testPhone()
        const begun = await call(db, BEGIN, [
          a.token,
          email,
          phone,
          randomUUID(),
        ])
        await insertAuthUser(db, "missing", {
          id: begun.pending_user_id as string,
        })

        const error = await errorDetail(db, COMPLETE, [
          a.token,
          JSON.stringify(profile(email, phone, overrides)),
          randomUUID(),
        ])
        expect(error).toEqual({ message: code, detail })
        expect(
          await count(db, "select 1 from public.profiles where id = $1", [
            begun.pending_user_id,
          ])
        ).toBe(0)
        expect(await tokenRow(db, a.tokenId)).toMatchObject({
          state: "claiming",
        })
      })
    }
  )

  it.each([
    ["email", "not-an-email", "0541234567"],
    ["phone", "a@example.test", "123"],
  ])(
    "refuses an invalid %s in join_begin with detail.field",
    async (field, email, phone) => {
      await inRollback(async (db) => {
        const a = await approveCard(db)
        expect(
          await errorDetail(db, BEGIN, [a.token, email, phone, randomUUID()])
        ).toEqual({ message: "INVALID_INPUT", detail: { field } })
        expect(await tokenRow(db, a.tokenId)).toMatchObject({
          state: "pending",
        })
      })
    }
  )

  it.each([
    [
      "expired",
      "update public.activation_tokens set expires_at = now() - interval '1 second' where id = $1",
      "LINK_EXPIRED",
      "expired",
    ],
    [
      "revoked",
      "update public.activation_tokens set state = 'revoked', revoked_at = now() where id = $1",
      "LINK_EXPIRED",
      "expired",
    ],
    [
      "consumed",
      "update public.activation_tokens set state = 'consumed', consumed_at = now() where id = $1",
      "LINK_USED",
      "used",
    ],
  ])("answers a %s link with %s", async (_label, change, code, view) => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      await db.query(change, [a.tokenId])
      const email = `${testName("closed")}@example.test`
      expect(
        await callError(db, BEGIN, [a.token, email, testPhone(), randomUUID()])
      ).toMatchObject({ code: "P0001", message: code })
      expect(await call(db, VIEW, [a.token])).toMatchObject({
        state_public: view,
      })
    })
  })

  it("answers an unknown token and a reset token with LINK_EXPIRED", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const reset = await call(db, "select public.issue_reset_token($1) as r", [
        f.customerA,
      ])
      for (const token of ["x".repeat(43), reset.token as string]) {
        for (const [query, params] of [
          [BEGIN, [token, "a@example.test", testPhone(), randomUUID()]],
          [COMPLETE, [token, "{}", randomUUID()]],
        ] as const) {
          expect(await callError(db, query, [...params])).toMatchObject({
            code: "P0001",
            message: "LINK_EXPIRED",
          })
        }
      }
    })
  })

  it.each([
    ["the email of an Auth user without a profile", "orphan"],
    ["the phone of an activated account", "account"],
  ])(
    "classifies a link whose details match %s (2.3), creating nothing",
    async (_label, match) => {
      await inRollback(async (db) => {
        const a = await approveCard(db)
        const orphan = await insertAuthUser(db, "existing")
        const phone = testPhone()
        await db.query(
          "update public.profiles set phone_e164 = $1 where id = $2",
          [e164(phone), a.f.customerA]
        )
        const email =
          match === "orphan"
            ? orphan.email.toUpperCase()
            : `${testName("fresh")}@example.test`
        const usedPhone = match === "account" ? phone : testPhone()

        const result = await call(db, BEGIN, [
          a.token,
          email,
          usedPhone,
          randomUUID(),
        ])
        if (match === "orphan") {
          expect(result).toEqual({
            outcome: "conflict",
            token_id: a.tokenId,
            reason: "not_activated",
          })
          expect(await tokenRow(db, a.tokenId)).toMatchObject({
            state: "conflict",
            conflict_reason: "not_activated",
            pending_user_id: null,
          })
        } else {
          expect(result).toEqual({
            outcome: "existing_account",
            token_id: a.tokenId,
          })
          expect(await tokenRow(db, a.tokenId)).toMatchObject({
            state: "awaiting_login",
            bound_user_id: a.f.customerA,
            pending_user_id: null,
          })
        }
        // Retrying gives the same answer, and complete does not go on.
        expect(
          await call(db, BEGIN, [a.token, email, usedPhone, randomUUID()])
        ).toEqual(result)
        const body = JSON.stringify(profile(email, usedPhone))
        if (match === "orphan") {
          expect(
            await call(db, COMPLETE, [a.token, body, randomUUID()])
          ).toEqual(result)
        } else {
          expect(
            await callError(db, COMPLETE, [a.token, body, randomUUID()])
          ).toMatchObject({ code: "P0001", message: "LINK_EXPIRED" })
        }
        expect(
          await count(
            db,
            "select 1 from public.payments where id = $1 and customer_id is null",
            [a.paymentId]
          )
        ).toBe(1)
      })
    }
  )

  it("moves the link to conflict on BIND_CONFLICT and changes no row", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = `${testName("bound")}@example.test`
      const phone = testPhone()
      const begun = await call(db, BEGIN, [a.token, email, phone, randomUUID()])
      const userId = begun.pending_user_id as string
      await insertAuthUser(db, "bound", { id: userId })
      // The purchase was bound elsewhere in the meantime.
      await db.query(
        "update public.payments set customer_id = $1 where id = $2",
        [a.f.customerA, a.paymentId]
      )

      const done = await call(db, COMPLETE, [
        a.token,
        JSON.stringify(profile(email, phone)),
        randomUUID(),
      ])
      expect(done).toEqual({
        outcome: "conflict",
        token_id: a.tokenId,
        reason: "bind_conflict",
      })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "conflict",
        conflict_reason: "bind_conflict",
        customer_id: null,
      })
      for (const [text, params] of [
        ["select 1 from public.profiles where id = $1", [userId]],
        ["select 1 from public.babies where customer_id = $1", [userId]],
        [
          "select 1 from public.notifications where recipient_id = $1",
          [userId],
        ],
        [
          "select 1 from public.entitlements where payment_id = $1 and customer_id is not null",
          [a.paymentId],
        ],
      ] as const) {
        expect(await count(db, text, [...params])).toBe(0)
      }
    })
  })

  it("moves the link to conflict when the phone was taken since join_begin (no raw 23505)", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const email = `${testName("race")}@example.test`
      const phone = testPhone()
      const begun = await call(db, BEGIN, [a.token, email, phone, randomUUID()])
      await insertAuthUser(db, "race", { id: begun.pending_user_id as string })
      await db.query(
        "update public.profiles set phone_e164 = $1 where id = $2",
        [e164(phone), a.f.customerB]
      )

      expect(
        await call(db, COMPLETE, [
          a.token,
          JSON.stringify(profile(email, phone)),
          randomUUID(),
        ])
      ).toEqual({
        outcome: "conflict",
        token_id: a.tokenId,
        reason: "phone_taken",
      })
      expect(await tokenRow(db, a.tokenId)).toMatchObject({
        state: "conflict",
        conflict_reason: "phone_taken",
      })
      expect(
        await count(db, "select 1 from public.profiles where id = $1", [
          begun.pending_user_id,
        ])
      ).toBe(0)
    })
  })

  it("bind_purchase refuses a payment that is already bound", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      await db.query("select private.bind_purchase($1, $2)", [
        a.paymentId,
        a.f.customerA,
      ])
      expect(
        await queryError(db, "select private.bind_purchase($1, $2)", [
          a.paymentId,
          a.f.customerB,
        ])
      ).toMatchObject({ code: "P0001", message: "BIND_CONFLICT" })
      const { rows } = await db.query(
        "select customer_id from public.payments where id = $1",
        [a.paymentId]
      )
      expect(rows[0].customer_id).toBe(a.f.customerA)
    })
  })

  it("stores the privacy policy version published at join time, after a second publish (5.5)", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      // From the migration's state: privacy never published, version 0.
      await db.query(
        `update public.content_pages
         set published_content = null, published_at = null, published_version = 0
         where slug = 'privacy'`
      )
      await db.query(
        `update public.content_sections
         set draft_content = null, published_content = null, published_at = null
         where page_slug = 'privacy'`
      )
      const publish = async (body: string) => {
        await asAuthenticated(db, a.f.admin)
        await db.query(
          "select public.admin_set_content_draft('privacy', 'body', $1::jsonb)",
          // privacy › body is legal_text since the phone check: {body}.
          [JSON.stringify({ body: `## ${testName("h")}\n\n${body}` })]
        )
        const { rows } = await db.query(
          "select public.admin_publish_content('privacy', $1) as r",
          [randomUUID()]
        )
        await db.query("reset role")
        return rows[0].r.published_version as number
      }
      expect(await publish("first")).toBe(1)
      expect(await publish("second")).toBe(2)
      // Publishing the same text again does not raise the version.
      expect(await publish("second")).toBe(2)

      const { userId } = await join(db, a)
      const { rows } = await db.query(
        "select privacy_policy_version from public.profiles where id = $1",
        [userId]
      )
      expect(rows[0].privacy_policy_version).toBe(2)
    })
  })
})

describe("join permissions", () => {
  it("lets a customer update only her name and dietary notes", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const { userId } = await join(db, a)
      await asAuthenticated(db, userId)

      for (const column of [
        "phone_e164 = '+972541111111'",
        "photo_consent = true",
        "personal_photo_consent = true",
      ]) {
        expect(
          (await queryError(db, `update public.profiles set ${column}`))?.code
        ).toBe("42501")
      }
      const { rows } = await db.query(
        "update public.profiles set full_name = $1, dietary_notes = $2 returning id",
        [testName("renamed"), "vegan"]
      )
      // RLS: only her own row.
      expect(rows).toEqual([{ id: userId }])
    })
  })

  it("lets a customer manage only her own babies", async () => {
    await inRollback(async (db) => {
      const a = await approveCard(db)
      const { userId } = await join(db, a)
      await db.query(
        "insert into public.babies (customer_id, name, birth_date) values ($1, $2, '2026-01-01')",
        [a.f.customerA, testName("other_baby")]
      )
      await asAuthenticated(db, userId)

      expect(
        (
          await queryError(
            db,
            "insert into public.babies (customer_id, name, birth_date) values ($1, $2, '2026-01-01')",
            [a.f.customerA, testName("sneaky")]
          )
        )?.code
      ).toBe("42501")
      // customer_id is never given (story 2.10): its default is her own id.
      const { rows: mine } = await db.query(
        "insert into public.babies (name, birth_date) values ($1, '2026-02-01') returning customer_id",
        [testName("second")]
      )
      expect(mine).toEqual([{ customer_id: userId }])
      expect(
        (
          await queryError(db, "update public.babies set customer_id = $1", [
            a.f.customerA,
          ])
        )?.code
      ).toBe("42501")
      const { rows: visible } = await db.query(
        "select customer_id from public.babies"
      )
      expect(visible.every((row) => row.customer_id === userId)).toBe(true)
      expect(visible).toHaveLength(2)
    })
  })

  it("keeps join_begin and join_complete from authenticated", async () => {
    await inRollback(async (db) => {
      await asAuthenticated(db, randomUUID())
      expect(
        (
          await queryError(db, BEGIN, [
            "x".repeat(43),
            "a@b.co",
            "0541234567",
            randomUUID(),
          ])
        )?.code
      ).toBe("42501")
      expect(
        (await queryError(db, COMPLETE, ["x".repeat(43), "{}", randomUUID()]))
          ?.code
      ).toBe("42501")

      // Even with execute (as the owner), an authenticated JWT is refused by
      // the first line of each RPC.
      await db.query("reset role")
      for (const [query, params] of [
        [BEGIN, ["x".repeat(43), "a@b.co", "0541234567", randomUUID()]],
        [COMPLETE, ["x".repeat(43), "{}", randomUUID()]],
      ] as const) {
        expect(await queryError(db, query, [...params])).toMatchObject({
          code: "P0001",
          message: "NOT_AUTHORIZED",
        })
      }
    })
  })

  it("writes customer_id on payments only in private.bind_purchase", async () => {
    const rows = await sql<{ fn: string }>(
      `select n.nspname || '.' || p.proname as fn
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and p.prosrc ~* 'update[[:space:]]+public[.]payments[[:space:]]+set[^;]*customer_id'
       order by 1`
    )
    expect(rows.map((row) => row.fn)).toEqual(["private.bind_purchase"])
  })
})
