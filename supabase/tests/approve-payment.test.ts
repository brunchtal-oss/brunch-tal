// Story 2.1: admin_approve_payment, preview_admin_approve_payment and the
// approval core (AD-7, AD-10, AD-14). Everything runs in inRollback.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  inRollback,
  queryError,
  sql,
  type Db,
} from "./support/db"
import {
  APPROVE,
  approve,
  approveParams,
  insertProduct,
  seedMoney,
  type ApproveInput,
  type MoneyFixture,
} from "./support/money"

const PREVIEW =
  "select public.preview_admin_approve_payment(null, 'Test payer', $1, $2, $3, $4::date, null) as r"

function cardInput(f: MoneyFixture, extra: Partial<ApproveInput> = {}) {
  return {
    productId: f.card,
    amount: 47200,
    paidOn: f.today,
    methodId: f.method,
    key: randomUUID(),
    ...extra,
  }
}

async function count(db: Db, text: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from (${text}) q`,
    params
  )
  return rows[0].n
}

async function paymentsOf(db: Db, productId: string) {
  return count(db, "select 1 from public.payments where product_id = $1", [
    productId,
  ])
}

async function addDays(db: Db, day: string, days: number): Promise<string> {
  const { rows } = await db.query("select ($1::date + $2::int)::text as d", [
    day,
    days,
  ])
  return rows[0].d
}

describe("admin_approve_payment", () => {
  it("approves a card: payment, entitlement, grant, join token, audit", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, cardInput(f, { reference: " 1234 " }))

      const expiresOn = await addDays(db, f.today, 49)
      expect(r.reissue_required).toBe(false)
      expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(r.expires_on).toBe(expiresOn)
      expect(r).toHaveProperty("link_expires_at")

      await db.query("reset role")
      const { rows: payments } = await db.query(
        "select * from public.payments where id = $1",
        [r.payment_id]
      )
      expect(payments).toHaveLength(1)
      const payment = payments[0]
      expect(payment).toMatchObject({
        customer_id: null,
        product_id: f.card,
        source: "manual",
        recorded_by: f.admin,
        payment_method_id: f.method,
        amount_agorot: 47200,
        reference: "1234",
        amount_override_reason: null,
        status: "approved",
        provider: null,
      })
      expect(payment.product_snapshot).toMatchObject({
        id: f.card,
        price_agorot: 47200,
        validity_days: 49,
      })
      expect(typeof payment.product_snapshot.payment_method_name).toBe("string")

      const { rows: entitlements } = await db.query(
        `select *, valid_from::text as vf, expires_on::text as eo
         from public.entitlements where payment_id = $1`,
        [r.payment_id]
      )
      expect(entitlements).toHaveLength(1)
      expect(entitlements[0]).toMatchObject({
        id: r.entitlement_id,
        customer_id: null,
        kind: "card",
        original_units: 4,
        vf: f.today,
        eo: expiresOn,
        pinned_event_id: null,
        allowed_weekdays: [1, 4],
        eligible_event_kind: "regular",
        status: "active",
      })
      expect(entitlements[0].eligibility_snapshot.validity_mode).toBe("days")

      const { rows: movements } = await db.query(
        "select action, units, actor_id from public.entitlement_movements where entitlement_id = $1",
        [r.entitlement_id]
      )
      expect(movements).toEqual([
        { action: "grant", units: 4, actor_id: f.admin },
      ])

      const { rows: tokens } = await db.query(
        "select purpose, state, payment_id, bound_user_id from public.activation_tokens where id = $1",
        [r.token_id]
      )
      expect(tokens).toEqual([
        {
          purpose: "join",
          state: "pending",
          payment_id: r.payment_id,
          bound_user_id: null,
        },
      ])

      const { rows: audit } = await db.query(
        `select entity_type, entity_id, actor_id, actor_kind, after::text as after
         from public.audit_log
         where entity_id = any($1::uuid[]) order by entity_type`,
        [[r.payment_id, r.entitlement_id, r.token_id]]
      )
      // The payment has two rows: the core's insert and the payer name
      // (required for a new customer since 2026-10-05).
      expect(audit.map((a) => [a.entity_type, a.entity_id])).toEqual([
        ["activation_tokens", r.token_id],
        ["entitlements", r.entitlement_id],
        ["payments", r.payment_id],
        ["payments", r.payment_id],
      ])
      for (const row of audit) {
        expect(row.actor_id).toBe(f.admin)
        expect(row.actor_kind).toBe("admin")
        expect(row.after).not.toContain(r.token as string)
      }
      // audit_diff masks the token hash on the new token path.
      const tokenAudit = audit.find(
        (a) => a.entity_type === "activation_tokens"
      )
      expect(JSON.parse(tokenAudit!.after).token_hash).toBe("<changed>")
    })
  })

  it("returns the stored result for the same key, without a token or new rows", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const input = cardInput(f)
      const first = await approve(db, input)
      const again = await approve(db, input)

      expect(again.payment_id).toBe(first.payment_id)
      expect(again.token_id).toBe(first.token_id)
      expect(again.reissue_required).toBe(true)
      expect(again).not.toHaveProperty("token")

      await db.query("reset role")
      expect(await paymentsOf(db, f.card)).toBe(1)
      expect(
        await count(
          db,
          "select 1 from public.activation_tokens where payment_id = $1",
          [first.payment_id]
        )
      ).toBe(1)
      expect(
        await count(
          db,
          "select 1 from public.audit_log where entity_id = any($1::uuid[])",
          [[first.payment_id, first.entitlement_id, first.token_id]]
        )
        // The payment's second row is its payer name (2026-10-05).
      ).toBe(4)
    })
  })

  it("rejects the same key with another request", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const input = cardInput(f)
      await approve(db, input)
      const error = await queryError(
        db,
        APPROVE,
        approveParams({ ...input, amount: 40000, confirmed: true })
      )
      expect(error).toMatchObject({
        code: "P0001",
        message: "IDEMPOTENCY_KEY_REUSED",
      })
    })
  })

  it.each([
    // Israel DST 2026: starts Friday 27.03, ends Sunday 25.10.
    ["2026-02-06", "2026-03-27", "2026-03-27 21:00:00+00"],
    ["2026-09-06", "2026-10-25", "2026-10-25 22:00:00+00"],
  ])(
    "preview and the saved entitlement agree (paid %s, expires %s)",
    async (paidOn, expiresOn, expiresAt) => {
      await inRollback(async (db) => {
        const f = await seedMoney(db)
        await asAuthenticated(db, f.admin)
        const { rows } = await db.query(PREVIEW, [f.card, null, 47200, paidOn])
        const plan = rows[0].r
        expect(plan).toMatchObject({
          product_id: f.card,
          kind: "card",
          units: 4,
          valid_from: paidOn,
          expires_on: expiresOn,
          price_agorot: 47200,
          amount_agorot: 47200,
          price_changed: false,
        })

        const r = await approve(db, cardInput(f, { paidOn }))
        const { rows: saved } = await db.query(
          `select e.expires_on::text as expires_on,
                  b.expires_at = $2::timestamptz as same_at,
                  b.expires_at = $3::timestamptz as expected_at
           from public.entitlements e
           join public.entitlement_balances b on b.entitlement_id = e.id
           where e.id = $1`,
          [r.entitlement_id, plan.expires_at, expiresAt]
        )
        expect(saved).toEqual([
          { expires_on: expiresOn, same_at: true, expected_at: true },
        ])
      })
    }
  )

  it.each([40000, 0])(
    "requires confirmation for amount %i and keeps the reason",
    async (amount) => {
      await inRollback(async (db) => {
        const f = await seedMoney(db)
        await asAuthenticated(db, f.admin)
        const error = await queryError(
          db,
          APPROVE,
          approveParams(cardInput(f, { amount, reason: "gift" }))
        )
        expect(error).toMatchObject({
          code: "P0001",
          message: "CONFIRM_REQUIRED",
        })

        const { rows } = await db.query(PREVIEW, [
          f.card,
          null,
          amount,
          f.today,
        ])
        expect(rows[0].r.price_changed).toBe(true)

        const r = await approve(
          db,
          cardInput(f, { amount, reason: "gift", confirmed: true })
        )
        await db.query("reset role")
        const { rows: payments } = await db.query(
          "select amount_agorot, amount_override_reason from public.payments where id = $1",
          [r.payment_id]
        )
        expect(payments).toEqual([
          { amount_agorot: amount, amount_override_reason: "gift" },
        ])
        // The core's row keeps the reason; the payer name's row has none.
        const { rows: audit } = await db.query(
          "select reason from public.audit_log where entity_id = $1 and reason is not null",
          [r.payment_id]
        )
        expect(audit).toEqual([{ reason: "gift" }])
      })
    }
  )

  it("does not keep a reason when the amount equals the price", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, cardInput(f, { reason: "ignored" }))
      await db.query("reset role")
      const { rows } = await db.query(
        "select amount_override_reason from public.payments where id = $1",
        [r.payment_id]
      )
      expect(rows).toEqual([{ amount_override_reason: null }])
    })
  })

  it("rejects a negative amount, a missing amount, a future or missing date", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const tomorrow = await addDays(db, f.today, 1)
      await asAuthenticated(db, f.admin)
      for (const extra of [
        { amount: -1, confirmed: true },
        { amount: null, confirmed: true },
        { paidOn: tomorrow },
        { paidOn: null },
      ]) {
        const error = await queryError(
          db,
          APPROVE,
          approveParams(cardInput(f, extra))
        )
        expect(error).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      }
      expect(
        (await queryError(db, PREVIEW, [f.card, null, 47200, tomorrow]))
          ?.message
      ).toBe("INVALID_INPUT")
      await db.query("reset role")
      expect(await paymentsOf(db, f.card)).toBe(0)
    })
  })

  // Story 3.11: PINNED_NOT_AVAILABLE is gone; placement is tested in
  // pinned-approval.test.ts.
  it("rejects a pinned product without a session or with an unknown one, creating nothing", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const single = await insertProduct(db, {
        label: "single",
        type: "single",
        price: 12800,
        units: 1,
        validityMode: "session",
      })
      await asAuthenticated(db, f.admin)
      for (const [eventId, code] of [
        [null, "PINNED_EVENT_REQUIRED"],
        [randomUUID(), "EVENT_NOT_BOOKABLE"],
      ] as const) {
        const error = await queryError(
          db,
          APPROVE,
          approveParams({
            productId: single,
            eventId,
            amount: 12800,
            paidOn: f.today,
            methodId: f.method,
            key: randomUUID(),
          })
        )
        expect(error).toMatchObject({ code: "P0001", message: code })
        expect(
          (await queryError(db, PREVIEW, [single, eventId, 12800, f.today]))
            ?.message
        ).toBe(code)
      }
      await db.query("reset role")
      expect(await paymentsOf(db, single)).toBe(0)
    })
  })

  it("rejects a session for a days product", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const error = await queryError(
        db,
        APPROVE,
        approveParams(cardInput(f, { eventId: randomUUID() }))
      )
      expect(error).toMatchObject({
        code: "P0001",
        message: "EVENT_NOT_ALLOWED",
      })
    })
  })

  it("rejects a hidden or missing payment method", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      for (const methodId of [f.hiddenMethod, null, randomUUID()]) {
        const error = await queryError(
          db,
          APPROVE,
          approveParams(cardInput(f, { methodId }))
        )
        expect(error).toMatchObject({
          code: "P0001",
          message: "PAYMENT_METHOD_NOT_SELECTABLE",
        })
      }
      await db.query("reset role")
      expect(await paymentsOf(db, f.card)).toBe(0)
    })
  })

  it("rejects an inactive or missing product", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const inactive = await insertProduct(db, {
        label: "inactive",
        active: false,
      })
      await asAuthenticated(db, f.admin)
      for (const productId of [inactive, randomUUID()]) {
        const error = await queryError(
          db,
          APPROVE,
          approveParams(cardInput(f, { productId }))
        )
        expect(error).toMatchObject({
          code: "P0001",
          message: "PRODUCT_NOT_AVAILABLE",
        })
        expect(
          (await queryError(db, PREVIEW, [productId, null, 47200, f.today]))
            ?.message
        ).toBe("PRODUCT_NOT_AVAILABLE")
      }
    })
  })

  it("refuses a customer and a user without a role, for both RPCs", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      for (const user of [f.customerA, randomUUID()]) {
        await db.query("reset role")
        await asAuthenticated(db, user)
        expect(
          await queryError(db, APPROVE, approveParams(cardInput(f)))
        ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
        expect(
          await queryError(db, PREVIEW, [f.card, null, 47200, f.today])
        ).toMatchObject({ code: "P0001", message: "NOT_AUTHORIZED" })
      }
      await db.query("reset role")
      expect(await paymentsOf(db, f.card)).toBe(0)
    })
  })

  it("rejects a missing idempotency key", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const params = approveParams(cardInput(f))
      params[12] = null
      expect(await queryError(db, APPROVE, params)).toMatchObject({
        code: "P0001",
        message: "INVALID_INPUT",
      })
    })
  })
})

describe("entitlement_balances", () => {
  it("shows 4 available after a card approval", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, cardInput(f))
      const { rows } = await db.query(
        "select available, reserved, used, is_expired from public.entitlement_balances where entitlement_id = $1",
        [r.entitlement_id]
      )
      expect(rows).toEqual([
        { available: 4, reserved: 0, used: 0, is_expired: false },
      ])
    })
  })

  it("derives reserved and used from reserve, use and release", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, cardInput(f))
      await db.query("reset role")
      // booking_id has a FK to bookings since 3.2: two real bookings.
      const { rows: bookings } = await db.query<{ id: string }>(
        `with e as (
           insert into public.events (concept_id, kind, starts_at, ends_at, capacity_adults)
           select id, 'regular', now() + interval '7 days', now() + interval '7 days 2 hours', 12
           from public.concepts order by sort_order limit 1
           returning id
         )
         insert into public.bookings (payment_id, event_id, party_size, booked_by, policy_snapshot)
         select $1, e.id, 1, 'admin',
           '{"cancel_window_hours": 48, "reminder_lead_hours": 24}'::jsonb
         from e, generate_series(1, 2)
         returning id`,
        [r.payment_id]
      )
      const [b1, b2] = bookings.map((b) => b.id)
      const move = (booking: string, action: string, units: number) =>
        db.query(
          `insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
           values ($1, $2, $3, $4)`,
          [r.entitlement_id, booking, action, units]
        )
      const balance = async () =>
        (
          await db.query(
            "select available, reserved, used from public.entitlement_balances where entitlement_id = $1",
            [r.entitlement_id]
          )
        ).rows[0]

      await move(b1, "reserve", -1)
      await move(b2, "reserve", -1)
      await move(b2, "use", 0)
      expect(await balance()).toEqual({ available: 2, reserved: 1, used: 1 })

      await move(b1, "release", 1)
      expect(await balance()).toEqual({ available: 3, reserved: 0, used: 1 })
    })
  })

  it("is expired from the end of the local expiry day", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      const paidOn = await addDays(db, f.today, -49)
      await asAuthenticated(db, f.admin)
      const fresh = await approve(db, cardInput(f, { paidOn }))
      const old = await approve(
        db,
        cardInput(f, {
          paidOn: await addDays(db, f.today, -50),
          duplicateConfirmed: true,
        })
      )
      const { rows } = await db.query(
        "select entitlement_id, is_expired from public.entitlement_balances where entitlement_id = any($1::uuid[])",
        [[fresh.entitlement_id, old.entitlement_id]]
      )
      const expired = Object.fromEntries(
        rows.map((row) => [row.entitlement_id, row.is_expired])
      )
      expect(expired[fresh.entitlement_id as string]).toBe(false)
      expect(expired[old.entitlement_id as string]).toBe(true)
    })
  })
})

describe("approval core", () => {
  const CORE = `select private.approve_payment_core(
    $1, $2, $3, null, $4, null, 47200, null, $5::date, $6, null, null, null, null, $7) as id`

  it.each([
    ["source", "other", "admin", "raise"],
    ["source", null, "admin", "raise"],
    ["actor kind", "manual", "other", "raise"],
    ["seat failure", "manual", "admin", "other"],
    ["seat failure", "manual", "admin", null],
  ])(
    "rejects an unknown %s value",
    async (_label, source, actorKind, onSeatFailure) => {
      await inRollback(async (db) => {
        const f = await seedMoney(db)
        const error = await queryError(db, CORE, [
          source,
          f.admin,
          actorKind,
          f.card,
          f.today,
          f.method,
          onSeatFailure,
        ])
        expect(error).toMatchObject({ code: "P0001", message: "INVALID_INPUT" })
      })
    }
  )

  it("allows at most one live join token per payment", async () => {
    await inRollback(async (db) => {
      const f = await seedMoney(db)
      await asAuthenticated(db, f.admin)
      const r = await approve(db, cardInput(f))
      await db.query("reset role")
      expect(
        (
          await queryError(db, "select private.issue_token('join', null, $1)", [
            r.payment_id,
          ])
        )?.code
      ).toBe("23505")
      expect(
        (await queryError(db, "select private.issue_token('join', null)"))
          ?.message
      ).toBe("INVALID_INPUT")
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

  it("only private.record_payment inserts into payments", async () => {
    expect(
      await functionsMatching(/insert\s+into\s+public\.payments\b/i)
    ).toEqual(["private.record_payment"])
  })

  it("only the core calls record_payment and grant_from_payment", async () => {
    expect(await functionsMatching(/private\.record_payment\s*\(/i)).toEqual([
      "private.approve_payment_core",
    ])
    expect(
      await functionsMatching(/private\.grant_from_payment\s*\(/i)
    ).toEqual(["private.approve_payment_core"])
  })

  it("only admin_approve_payment calls the core", async () => {
    expect(
      await functionsMatching(/private\.approve_payment_core\s*\(/i)
    ).toEqual(["public.admin_approve_payment"])
  })

  it("only grant_from_payment inserts entitlements", async () => {
    expect(
      await functionsMatching(/insert\s+into\s+public\.entitlements\b/i)
    ).toEqual(["private.grant_from_payment"])
  })
})
