"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// Self-booking (story 3.2). book_session runs with the customer's own
// session and checks everything again (customer, session, places, funding);
// this action checks only the shape. The idempotency key is made when the
// booking sheet opens and sent with every try (AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function bookSessionAction(input: {
  eventId: string
  idempotencyKey: string
}): Promise<ActionResult<{ bookingId: string }>> {
  if (
    typeof input?.eventId !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.eventId) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "book_session", {
    p_event_id: input.eventId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const booked = result.data as { booking_id: string }
  return { ok: true, data: { bookingId: booked.booking_id } }
}
