"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { parseCancelResult, type CancelResult } from "./cancel-result"

// Self-cancel (story 3.6). cancel_booking runs with the customer's own
// session and checks everything again (hers, confirmed, the self-cancel
// boundary from the booking's snapshot); this action checks only the shape.
// The idempotency key is made when the cancel sheet opens and sent with
// every try (AD-5). No choice is sent until 3.7.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function cancelBookingAction(input: {
  bookingId: string
  idempotencyKey: string
}): Promise<ActionResult<CancelResult>> {
  if (
    typeof input?.bookingId !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.bookingId) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "cancel_booking", {
    p_booking_id: input.bookingId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  return { ok: true, data: parseCancelResult(result.data) }
}
