"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import {
  parseCancelResult,
  type CancelChoice,
  type CancelResult,
} from "./cancel-result"
import {
  parseMovePlan,
  parseMoveResult,
  type MovePlan,
  type MoveResult,
} from "./move-result"

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

// Moving her booking (story 3.10). preview_move_booking and move_booking
// run with her own session and check everything again (hers, confirmed,
// the self-cancel boundary, the target's place and the original's funding
// source); these actions check only the shape. The key is made when the
// move sheet opens and again on a change of target (AD-5).
export async function previewMoveBookingAction(input: {
  bookingId: string
}): Promise<ActionResult<MovePlan>> {
  if (typeof input?.bookingId !== "string" || !UUID.test(input.bookingId)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "preview_move_booking", {
    p_booking_id: input.bookingId,
  })
  if (!result.ok) return result
  return { ok: true, data: parseMovePlan(result.data) }
}

export async function moveBookingAction(input: {
  bookingId: string
  targetEventId: string
  idempotencyKey: string
}): Promise<ActionResult<MoveResult>> {
  if (
    typeof input?.bookingId !== "string" ||
    typeof input.targetEventId !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.bookingId) ||
    !UUID.test(input.targetEventId) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "move_booking", {
    p_booking_id: input.bookingId,
    p_target_event_id: input.targetEventId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const moved = parseMoveResult(result.data)
  if (!moved) return { ok: false, code: "SERVER_ERROR" }
  return { ok: true, data: moved }
}

// The companion's dietary note on her couple booking (story 3.5).
// set_booking_guest_details checks everything again (hers, confirmed,
// couple, before the registration close, trimmed, at most 1000); this
// action checks only the shape (a string of at most 1000 after trimming,
// so a longer text is refused here with the same detail as the RPC). The
// key is made when the sheet opens (AD-5).
export async function setGuestDetailsAction(input: {
  bookingId: string
  guestDetails: string
  idempotencyKey: string
}): Promise<ActionResult<{ guestDetails: string | null }>> {
  if (
    typeof input?.bookingId !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    typeof input.guestDetails !== "string" ||
    !UUID.test(input.bookingId) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  if (input.guestDetails.trim().length > 1000) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "guest_details" },
    }
  }
  const result = await callRpc(
    await createClient(),
    "set_booking_guest_details",
    {
      p_booking_id: input.bookingId,
      p_guest_details: input.guestDetails,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (!result.ok) return result
  const row = result.data as Record<string, unknown> | null
  return {
    ok: true,
    data: {
      guestDetails:
        row && typeof row.guest_details === "string" ? row.guest_details : null,
    },
  }
}
