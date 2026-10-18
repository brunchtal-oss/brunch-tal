"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { parseSettlePlan, type SettlePlan } from "./attention-plans"

// The buttons of two "לטיפול" items (story 3.13). The RPCs run with the
// admin's own session (private.is_admin() inside) and check everything
// again; these actions check only the shape.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REASON_MAX = 2000
// The generated Args type marks every parameter as non-null.
const NONE = null as unknown as string

// "טופל" on a booking a card correction left unfit (set_*: no key).
export async function markCorrectionHandledAction(input: {
  bookingId: string
}): Promise<ActionResult> {
  if (typeof input?.bookingId !== "string" || !UUID.test(input.bookingId)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "admin_set_correction_booking_handled",
    { p_booking_id: input.bookingId }
  )
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

// A purchase paid without a place in a session the business cancelled: the
// parked_settle dialog's plan, then the offer of a refund or a credit.
export async function previewSettleParkedAction(input: {
  entitlementId: string
}): Promise<ActionResult<SettlePlan>> {
  if (
    typeof input?.entitlementId !== "string" ||
    !UUID.test(input.entitlementId)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_settle_parked_purchase",
    { p_entitlement_id: input.entitlementId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseSettlePlan(result.data) }
}

export async function settleParkedAction(input: {
  entitlementId: string
  reason: string
  confirmed: boolean
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    typeof input?.entitlementId !== "string" ||
    !UUID.test(input.entitlementId) ||
    typeof input.reason !== "string" ||
    input.reason.length > REASON_MAX ||
    typeof input.confirmed !== "boolean" ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "admin_settle_parked_purchase",
    {
      p_entitlement_id: input.entitlementId,
      p_reason: input.reason.trim() || NONE,
      p_confirmed: input.confirmed,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (!result.ok) return result
  return { ok: true, data: undefined }
}
