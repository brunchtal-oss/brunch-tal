"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import {
  parseCancelResult,
  type CancelChoice,
  type CancelResult,
} from "./cancel-result"

// Self-cancel (stories 3.6, 3.7). cancel_booking runs with the customer's
// own session and checks everything again (hers, confirmed, the
// self-cancel boundary from the booking's snapshot, and whether this
// booking needs a choice); this action checks only the shape. The choice
// is sent only for a pinned booking (refund or credit), otherwise it is
// left out. The idempotency key is made when the cancel sheet opens and
// sent with every try (AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Story 3.8: her refund-or-credit choice after the business cancelled the
// session. choose_credit_outcome checks again that the credit is hers and
// still waiting; this action checks only the shape. One key per opening of
// the sheet and per change of choice (AD-5).
export async function chooseCreditOutcomeAction(input: {
  creditId: string
  choice: CancelChoice
  idempotencyKey: string
}): Promise<ActionResult<{ outcome: CancelChoice }>> {
  if (
    typeof input?.creditId !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.creditId) ||
    !UUID.test(input.idempotencyKey) ||
    (input.choice !== "credit" && input.choice !== "refund")
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "choose_credit_outcome", {
    p_credit_id: input.creditId,
    p_choice: input.choice,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  return { ok: true, data: { outcome: input.choice } }
}

export async function cancelBookingAction(input: {
  bookingId: string
  idempotencyKey: string
  choice?: CancelChoice | null
}): Promise<ActionResult<CancelResult>> {
  if (
    typeof input?.bookingId !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.bookingId) ||
    !UUID.test(input.idempotencyKey) ||
    (input.choice != null &&
      input.choice !== "credit" &&
      input.choice !== "refund")
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "cancel_booking", {
    p_booking_id: input.bookingId,
    p_idempotency_key: input.idempotencyKey,
    ...(input.choice ? { p_choice: input.choice } : {}),
  })
  if (!result.ok) return result
  return { ok: true, data: parseCancelResult(result.data) }
}
