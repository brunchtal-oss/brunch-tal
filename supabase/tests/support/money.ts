// Fixtures for the money tests (story 2.1). Everything is created as the
// owner inside an inRollback transaction: fictitious profiles and an admin
// without Auth users (no FK to auth.users; asAuthenticated sets auth.uid()).

import { randomUUID } from "node:crypto"

import { testName, type Db } from "./db"

export type MoneyFixture = {
  admin: string
  customerA: string
  customerB: string
  card: string
  method: string
  hiddenMethod: string
  today: string
}

/** Inserts a fictitious product as the owner and returns its id. */
export async function insertProduct(
  db: Db,
  values: {
    label: string
    type?: string
    price?: number
    units?: number
    validityMode?: "days" | "session"
    validityDays?: number | null
    active?: boolean
  }
): Promise<string> {
  const mode = values.validityMode ?? "days"
  const { rows } = await db.query(
    `insert into public.products (
       name, type, price_agorot, units, validity_mode, validity_days,
       allowed_weekdays, eligible_event_kind, party_size, active)
     values ($1, $2, $3, $4, $5, $6, '{1,4}', 'regular', 1, $7)
     returning id`,
    [
      testName(values.label),
      values.type ?? "card",
      values.price ?? 47200,
      values.units ?? 4,
      mode,
      mode === "days" ? (values.validityDays ?? 49) : null,
      values.active ?? true,
    ]
  )
  return rows[0].id
}

/** Admin, two activated customers, a card product and two methods. */
export async function seedMoney(db: Db): Promise<MoneyFixture> {
  const admin = randomUUID()
  const customerA = randomUUID()
  const customerB = randomUUID()
  await db.query("insert into public.admin_roles (user_id) values ($1)", [
    admin,
  ])
  await db.query(
    `insert into public.profiles (id, full_name, activated_at)
     values ($1, $2, now()), ($3, $4, now())`,
    [customerA, testName("money_a"), customerB, testName("money_b")]
  )
  const card = await insertProduct(db, { label: "card" })
  const { rows: methods } = await db.query(
    `insert into public.payment_methods (name, sort_order, hidden)
     values ($1, 901, false), ($2, 902, true)
     returning id, hidden`,
    [testName("method"), testName("hidden_method")]
  )
  const method = methods.find((m) => !m.hidden).id
  const hiddenMethod = methods.find((m) => m.hidden).id
  const { rows } = await db.query(
    "select ((now() at time zone 'Asia/Jerusalem')::date)::text as today"
  )
  return {
    admin,
    customerA,
    customerB,
    card,
    method,
    hiddenMethod,
    today: rows[0].today,
  }
}

export type ApproveInput = {
  // null or missing: a new customer (a join link).
  customerId?: string | null
  // A new customer only: a label Tal sees until the customer joins.
  payerLabel?: string | null
  productId: string
  eventId?: string | null
  amount: number | null
  reason?: string | null
  paidOn: string | null
  methodId: string | null
  reference?: string | null
  note?: string | null
  confirmed?: boolean | null
  // A similar payment (same product, amount, method) within the window.
  duplicateConfirmed?: boolean | null
  key: string
}

// The payer name of a new customer when a test gives none (required since
// 2026-10-05). One name per run, so two unnamed approvals of a test are
// still "similar" as before.
export const DEFAULT_PAYER = testName("payer")

export const APPROVE =
  "select public.admin_approve_payment($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13) as r"

export function approveParams(input: ApproveInput): unknown[] {
  return [
    input.customerId ?? null,
    input.payerLabel ?? (input.customerId ? null : DEFAULT_PAYER),
    input.productId,
    input.eventId ?? null,
    input.amount,
    input.reason ?? null,
    input.paidOn,
    input.methodId,
    input.reference ?? null,
    input.note ?? null,
    input.confirmed ?? null,
    input.duplicateConfirmed ?? null,
    input.key,
  ]
}

/** Calls admin_approve_payment (the caller's role must already be set). */
export async function approve(
  db: Db,
  input: ApproveInput
): Promise<Record<string, unknown>> {
  const { rows } = await db.query(APPROVE, approveParams(input))
  return rows[0].r
}
