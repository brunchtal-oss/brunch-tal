"use server"

import type { ActionResult, ErrorCode } from "@/lib/errors"
import { formatLocalPhone } from "@/lib/phone"
import { callRpc } from "@/lib/rpc"
import { joinLinkFor } from "@/lib/server/join-link"
import { createClient } from "@/lib/supabase/server"

// The admin's own session (RLS and private.is_admin() inside the RPCs); no
// service role here (AD-4).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_REFERENCE = 100
const MAX_NOTE = 500
const MAX_REASON = 500
const MAX_QUERY = 100
const MAX_PAYER_LABEL = 40
// The generated Args type marks every parameter as required and non-null;
// a days product has no session, a new customer has no id, and these optional fields
// may be empty.
const NONE = null as unknown as string

export type SimilarPayment = {
  // null: a purchase that is not bound yet ("new customer").
  customerName: string | null
  // The payer label of a payment that is not bound yet, or null.
  payerLabel: string | null
  paidOn: string
  createdAt: string
}

export type PaymentPreview = {
  productName: string
  units: number
  expiresOn: string
  // The expiry is already in the past (the server's clock, AD-8).
  expired: boolean
  // The existing customer's name; null for a new customer.
  customerName: string | null
  similar: SimilarPayment[]
  windowDays: number
  // A pinned product (story 3.11): the session the booking is placed in,
  // shown instead of the expiry; null for a days product.
  event: { startsAt: string; conceptName: string } | null
}

type PlanResult = {
  product_name: string
  units: number
  expires_on: string
  expired: boolean
  customer_name: string | null
  similar_payments: {
    customer_name: string | null
    payer_label?: string | null
    paid_on: string
    created_at: string
  }[]
  duplicate_window_days: number
  event_id?: string | null
  event_starts_at?: string | null
  concept_name?: string | null
}

// "What will be created" (AD-7): the same private.plan_approve_payment the
// approval runs, with the customer's name and the similar payments.
export async function previewPaymentAction(input: {
  customerId: string | null
  // A new customer only; empty = none.
  payerLabel: string
  productId: string
  // A pinned product's session (story 3.11); null or missing for a days
  // product.
  eventId?: string | null
  amountAgorot: number
  paidOn: string
  methodId: string
}): Promise<ActionResult<PaymentPreview>> {
  const eventId = input.eventId ?? null
  const payerLabel =
    typeof input.payerLabel === "string" ? input.payerLabel.trim() : ""
  if (
    (input.customerId !== null && !UUID.test(input.customerId)) ||
    !validPayerLabel(payerLabel, input.customerId !== null) ||
    !UUID.test(input.productId) ||
    (eventId !== null && !UUID.test(eventId)) ||
    !UUID.test(input.methodId) ||
    !DATE.test(input.paidOn) ||
    !Number.isSafeInteger(input.amountAgorot) ||
    input.amountAgorot < 0
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_approve_payment",
    {
      p_customer_id: input.customerId ?? NONE,
      p_payer_label: payerLabel || NONE,
      p_product_id: input.productId,
      p_event_id: eventId ?? NONE,
      p_amount_agorot: input.amountAgorot,
      p_paid_on: input.paidOn,
      p_payment_method_id: input.methodId,
    }
  )
  if (!result.ok) return { ok: false, code: result.code }
  const plan = result.data as unknown as PlanResult
  return {
    ok: true,
    data: {
      productName: plan.product_name,
      units: plan.units,
      expiresOn: plan.expires_on,
      expired: plan.expired === true,
      customerName: plan.customer_name ?? null,
      similar: (plan.similar_payments ?? []).map((p) => ({
        customerName: p.customer_name ?? null,
        payerLabel: p.payer_label ?? null,
        paidOn: p.paid_on,
        createdAt: p.created_at,
      })),
      windowDays: plan.duplicate_window_days,
      event:
        plan.event_id && plan.event_starts_at
          ? {
              startsAt: plan.event_starts_at,
              conceptName: plan.concept_name ?? "",
            }
          : null,
    },
  }
}

export type ApprovedResult =
  // A new customer: the one-time join link. link is null only for a repeat
  // of an approval that already succeeded (the raw token is returned once,
  // AD-10).
  | {
      kind: "link"
      link: string | null
      linkExpiresAt: string
      // The payer label sent with the approval, or null.
      payerLabel: string | null
    }
  // An existing customer: the purchase is hers already.
  | { kind: "existing"; productName: string; units: number; expiresOn: string }

export type ApprovePaymentState =
  null | { ok: false; code: ErrorCode } | { ok: true; data: ApprovedResult }

type ApproveResult = {
  customer_id?: string | null
  expires_on: string
  product_name?: string
  units?: number
  token?: string
  link_expires_at?: string
  reissue_required?: boolean
}

// Only for a new customer, and then required (user decision 2026-10-05), up
// to 40 characters (the RPC checks again).
function validPayerLabel(label: string, existingCustomer: boolean): boolean {
  if (existingCustomer) return label === ""
  return label !== "" && label.length <= MAX_PAYER_LABEL
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

export async function approvePaymentAction(
  _previous: ApprovePaymentState,
  formData: FormData
): Promise<ApprovePaymentState> {
  const customerId = field(formData, "customerId")
  const payerLabel = field(formData, "payerLabel")
  const productId = field(formData, "productId")
  // A pinned product's session (story 3.11); empty for a days product.
  const eventId = field(formData, "eventId")
  const methodId = field(formData, "paymentMethodId")
  const paidOn = field(formData, "paidOn")
  const amountText = field(formData, "amountAgorot")
  const amount = amountText === "" ? Number.NaN : Number(amountText)
  const reason = field(formData, "amountOverrideReason")
  const reference = field(formData, "reference")
  const note = field(formData, "note")
  const confirmed = field(formData, "confirmed") === "1"
  const duplicateConfirmed = field(formData, "duplicateConfirmed") === "1"
  const idempotencyKey = field(formData, "idempotencyKey")

  if (
    (customerId !== "" && !UUID.test(customerId)) ||
    !validPayerLabel(payerLabel, customerId !== "") ||
    !UUID.test(productId) ||
    (eventId !== "" && !UUID.test(eventId)) ||
    !UUID.test(methodId) ||
    !DATE.test(paidOn) ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !UUID.test(idempotencyKey) ||
    reason.length > MAX_REASON ||
    reference.length > MAX_REFERENCE ||
    note.length > MAX_NOTE
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }

  // A changed amount needs the dialog's confirmation (CONFIRM_REQUIRED); the
  // reason is kept only when the amount differs from the price (the core).
  const result = await callRpc(await createClient(), "admin_approve_payment", {
    p_customer_id: customerId || NONE,
    p_payer_label: payerLabel || NONE,
    p_product_id: productId,
    p_event_id: eventId || NONE,
    p_amount_agorot: amount,
    p_amount_override_reason: reason || NONE,
    p_paid_on: paidOn,
    p_payment_method_id: methodId,
    p_reference: reference || NONE,
    p_note: note || NONE,
    p_confirmed: confirmed,
    p_duplicate_confirmed: duplicateConfirmed,
    p_idempotency_key: idempotencyKey,
  })
  if (!result.ok) return { ok: false, code: result.code }

  const approved = result.data as unknown as ApproveResult
  if (customerId) {
    return {
      ok: true,
      data: {
        kind: "existing",
        productName: approved.product_name ?? "",
        units: approved.units ?? 0,
        expiresOn: approved.expires_on,
      },
    }
  }
  return {
    ok: true,
    data: {
      kind: "link",
      link: approved.token ? await joinLinkFor(approved.token) : null,
      linkExpiresAt: approved.link_expires_at ?? "",
      payerLabel: payerLabel || null,
    },
  }
}

export type CustomerMatch = { id: string; name: string; phone: string }

// Search for an existing customer by part of her name or her phone
// (admin_search_customers: at least 2 characters, up to 20 by name).
export async function searchCustomersAction(
  query: string
): Promise<ActionResult<CustomerMatch[]>> {
  const trimmed = typeof query === "string" ? query.trim() : ""
  if (trimmed.length < 2 || trimmed.length > MAX_QUERY) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_search_customers", {
    p_query: trimmed,
  })
  if (!result.ok) return { ok: false, code: result.code }
  const rows = result.data as unknown as {
    id: string
    full_name: string
    phone_e164: string | null
  }[]
  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      name: row.full_name,
      phone: row.phone_e164 ? formatLocalPhone(row.phone_e164) : "",
    })),
  }
}
