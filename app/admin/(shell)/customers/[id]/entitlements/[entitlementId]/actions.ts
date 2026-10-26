"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { deleteOrphanUser } from "@/lib/server/privileged/join"
import { createServiceClient } from "@/lib/server/privileged/service-client"
import type { Json } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"

import {
  isCorrectionField,
  parseCorrectionPlan,
  parseVoidPlan,
  type CorrectionField,
  type CorrectionPlan,
  type VoidPlan,
} from "./entitlement-items"

// Tal corrects one field of a card (story 3.13, a sensitive action, AD-7).
// Both RPCs run with the admin's own session (private.is_admin() inside)
// and check everything again; these actions check only the shape. The
// idempotency key is made when the dialog opens (AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REASON_MAX = 2000
// The generated Args type marks every parameter as non-null; an empty
// session or reason is sent as null.
const NONE = null as unknown as string

// The value's shape per field (the RPC checks the rest): a date string, a
// whole number, null or a list of days, a kind.
function valueShapeOk(field: CorrectionField, value: unknown): boolean {
  switch (field) {
    case "expires_on":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    case "units":
      return (
        Number.isSafeInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= 99
      )
    case "allowed_weekdays":
      return (
        value === null ||
        (Array.isArray(value) &&
          value.length <= 7 &&
          value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
      )
    case "eligible_event_kind":
      return typeof value === "string" && value.length <= 20
  }
}

export async function previewCorrectEntitlementAction(input: {
  entitlementId: string
  field: string
  value: unknown
}): Promise<ActionResult<CorrectionPlan>> {
  if (
    typeof input?.entitlementId !== "string" ||
    !UUID.test(input.entitlementId) ||
    !isCorrectionField(input.field) ||
    !valueShapeOk(input.field, input.value)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_correct_entitlement",
    {
      p_entitlement_id: input.entitlementId,
      p_field: input.field,
      p_value: input.value as Json,
    }
  )
  if (!result.ok) return result
  return { ok: true, data: parseCorrectionPlan(result.data) }
}

export async function correctEntitlementAction(input: {
  entitlementId: string
  field: string
  value: unknown
  relatedEventId: string | null
  reason: string
  confirmed: boolean
  idempotencyKey: string
}): Promise<ActionResult<{ affectedCount: number }>> {
  if (
    typeof input?.entitlementId !== "string" ||
    !UUID.test(input.entitlementId) ||
    !isCorrectionField(input.field) ||
    !valueShapeOk(input.field, input.value) ||
    (input.relatedEventId !== null &&
      (typeof input.relatedEventId !== "string" ||
        !UUID.test(input.relatedEventId))) ||
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
    "admin_correct_entitlement",
    {
      p_entitlement_id: input.entitlementId,
      p_field: input.field,
      p_value: input.value as Json,
      p_related_event_id: input.relatedEventId ?? NONE,
      p_reason: input.reason.trim() || NONE,
      p_confirmed: input.confirmed,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (!result.ok) return result
  const data = result.data as { affected_count?: unknown } | null
  return {
    ok: true,
    data: {
      affectedCount:
        typeof data?.affected_count === "number" ? data.affected_count : 0,
    },
  }
}

// Story 2.14: Tal voids a purchase recorded by mistake (a sensitive,
// final action). The preview lists what it cancels; the void runs with her
// session and checks everything again. The service role is used only
// afterwards, to delete the pending Auth user of a stuck claiming link the
// RPC revoked (as the links screen does); a failed deletion is only logged.
export async function previewVoidPurchaseAction(input: {
  paymentId: string
}): Promise<ActionResult<VoidPlan>> {
  if (typeof input?.paymentId !== "string" || !UUID.test(input.paymentId)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_void_purchase",
    { p_payment_id: input.paymentId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseVoidPlan(result.data) }
}

export async function voidPurchaseAction(input: {
  paymentId: string
  reason: string
  confirmed: boolean
  idempotencyKey: string
}): Promise<ActionResult<{ cancelledCount: number }>> {
  if (
    typeof input?.paymentId !== "string" ||
    !UUID.test(input.paymentId) ||
    typeof input.reason !== "string" ||
    input.reason.length > REASON_MAX ||
    typeof input.confirmed !== "boolean" ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_void_purchase", {
    p_payment_id: input.paymentId,
    p_reason: input.reason.trim() || NONE,
    p_confirmed: input.confirmed,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const data = result.data as {
    cancelled_count?: unknown
    revoked_pending_user_id?: unknown
  } | null
  const orphan = data?.revoked_pending_user_id
  if (typeof orphan === "string" && UUID.test(orphan)) {
    await deleteOrphanUser(createServiceClient(), orphan, null)
  }
  return {
    ok: true,
    data: {
      cancelledCount:
        typeof data?.cancelled_count === "number" ? data.cancelled_count : 0,
    },
  }
}
