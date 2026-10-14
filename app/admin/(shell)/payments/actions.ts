"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { parseRefundPlan, type RefundPlan } from "./refund-items"

// Tal records a refund she paid outside the app (story 3.9, a sensitive
// action, AD-7). Both RPCs run with the admin's own session
// (private.is_admin() inside) and check everything again; these actions
// check only the shape. The idempotency key is made when the dialog opens
// and again on every change of a field (AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

// What completing the request would do (the dialog's impact box), or why
// it cannot.
export async function previewCompleteRefundAction(input: {
  refundRequestId: string
}): Promise<ActionResult<RefundPlan>> {
  if (
    typeof input?.refundRequestId !== "string" ||
    !UUID.test(input.refundRequestId)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_complete_refund",
    { p_refund_request_id: input.refundRequestId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseRefundPlan(result.data) }
}

// The completion: the day it was paid, the amount in agorot (parsed on the
// screen with parseShekelsToAgorot), an optional reference and the
// dialog's checkbox.
export async function completeRefundAction(input: {
  refundRequestId: string
  refundedOn: string
  amountAgorot: number
  reference: string
  confirmed: boolean
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    typeof input?.refundRequestId !== "string" ||
    !UUID.test(input.refundRequestId) ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.idempotencyKey) ||
    typeof input.refundedOn !== "string" ||
    !DATE.test(input.refundedOn) ||
    !Number.isSafeInteger(input.amountAgorot) ||
    input.amountAgorot < 0 ||
    input.amountAgorot > 2_147_483_647 ||
    typeof input.reference !== "string" ||
    input.reference.length > 1000 ||
    typeof input.confirmed !== "boolean"
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_complete_refund", {
    p_refund_request_id: input.refundRequestId,
    p_refunded_on: input.refundedOn,
    p_amount_agorot: input.amountAgorot,
    p_reference: input.reference,
    p_confirmed: input.confirmed,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  return { ok: true, data: undefined }
}
