"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import {
  parseCancelPlan,
  type CancelChoice,
  type CancelPlan,
} from "./cancel-plan"

// Tal cancels a booking from "מי מגיעה" (story 3.6, a sensitive action,
// AD-7). Both RPCs run with the admin's own session (private.is_admin()
// inside) and check everything again; these actions check only the shape.
// The idempotency key is made when the dialog opens (AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// What the cancel will do (the dialog's impact box), or why it cannot.
export async function previewAdminCancelAction(input: {
  bookingId: string
}): Promise<ActionResult<CancelPlan>> {
  if (typeof input?.bookingId !== "string" || !UUID.test(input.bookingId)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_cancel_booking",
    { p_booking_id: input.bookingId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseCancelPlan(result.data) }
}

// The cancel itself: confirmed (the dialog's checkbox), an optional
// reason, at most 500 characters on the screen (the RPC allows 2000), and
// the refund-or-credit choice when the plan required one (story 3.7; the
// RPC checks again whether it is required).
export async function adminCancelBookingAction(input: {
  bookingId: string
  reason: string
  confirmed: boolean
  idempotencyKey: string
  choice?: CancelChoice | null
}): Promise<ActionResult> {
  if (
    typeof input?.bookingId !== "string" ||
    !UUID.test(input.bookingId) ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.idempotencyKey) ||
    typeof input.reason !== "string" ||
    input.reason.length > 2000 ||
    typeof input.confirmed !== "boolean" ||
    (input.choice != null &&
      input.choice !== "credit" &&
      input.choice !== "refund")
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_cancel_booking", {
    p_booking_id: input.bookingId,
    p_confirmed: input.confirmed,
    p_idempotency_key: input.idempotencyKey,
    p_reason: input.reason.trim() === "" ? undefined : input.reason,
    ...(input.choice ? { p_choice: input.choice } : {}),
  })
  if (!result.ok) return result
  return { ok: true, data: undefined }
}
