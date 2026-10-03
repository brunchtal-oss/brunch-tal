"use server"

import type { ActionResult, ErrorCode } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { joinLinkFor } from "@/lib/server/join-link"
import { createClient } from "@/lib/supabase/server"

// The admin's own session (RLS and private.is_admin() inside the RPCs); no
// service role here (AD-4).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_REFERENCE = 100
const MAX_NOTE = 500
// The generated Args type marks every parameter as required and non-null;
// a card has no session, and these optional fields may be empty.
const NONE = null as unknown as string

export type PaymentPreview = {
  productName: string
  units: number
  expiresOn: string
}

type PlanResult = {
  product_name: string
  units: number
  expires_on: string
}

// "What will be created" (AD-7): the same private.plan_approve_payment the
// approval runs.
export async function previewPaymentAction(input: {
  productId: string
  amountAgorot: number
  paidOn: string
}): Promise<ActionResult<PaymentPreview>> {
  if (
    !UUID.test(input.productId) ||
    !DATE.test(input.paidOn) ||
    !Number.isSafeInteger(input.amountAgorot)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_approve_payment",
    {
      p_product_id: input.productId,
      p_event_id: NONE,
      p_amount_agorot: input.amountAgorot,
      p_paid_on: input.paidOn,
    }
  )
  if (!result.ok) return result
  const plan = result.data as PlanResult
  return {
    ok: true,
    data: {
      productName: plan.product_name,
      units: plan.units,
      expiresOn: plan.expires_on,
    },
  }
}

export type ApprovePaymentState =
  | null
  | { ok: false; code: ErrorCode }
  // link is null only for a repeat of an approval that already succeeded
  // (the raw token is returned once, AD-10).
  | { ok: true; data: { link: string | null; linkExpiresAt: string } }

type ApproveResult = {
  token?: string
  link_expires_at: string
  reissue_required: boolean
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

export async function approvePaymentAction(
  _previous: ApprovePaymentState,
  formData: FormData
): Promise<ApprovePaymentState> {
  const productId = field(formData, "productId")
  const methodId = field(formData, "paymentMethodId")
  const paidOn = field(formData, "paidOn")
  const amount = Number(field(formData, "amountAgorot"))
  const reference = field(formData, "reference")
  const note = field(formData, "note")
  const idempotencyKey = field(formData, "idempotencyKey")

  if (
    !UUID.test(productId) ||
    !UUID.test(methodId) ||
    !DATE.test(paidOn) ||
    !Number.isSafeInteger(amount) ||
    !UUID.test(idempotencyKey) ||
    reference.length > MAX_REFERENCE ||
    note.length > MAX_NOTE
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }

  // The amount is the product price Tal saw on the form; a price changed in
  // the meantime comes back as CONFIRM_REQUIRED (story 2.5 adds the
  // override and its confirmation).
  const result = await callRpc(await createClient(), "admin_approve_payment", {
    p_product_id: productId,
    p_event_id: NONE,
    p_amount_agorot: amount,
    p_amount_override_reason: NONE,
    p_paid_on: paidOn,
    p_payment_method_id: methodId,
    p_reference: reference || NONE,
    p_note: note || NONE,
    p_confirmed: null as unknown as boolean,
    p_idempotency_key: idempotencyKey,
  })
  if (!result.ok) return { ok: false, code: result.code }

  const approved = result.data as ApproveResult
  return {
    ok: true,
    data: {
      link: approved.token ? await joinLinkFor(approved.token) : null,
      linkExpiresAt: approved.link_expires_at,
    },
  }
}
