"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/lib/supabase/database.types"

import { parseBookPreview, type BookPreview } from "./[id]/book/preview"

// Session management (story 3.1). Every RPC runs with the admin's own
// session (private.is_admin() inside, AD-4) and checks every value again;
// these actions only check the shape. The idempotency key comes from the
// screen (one per form load or per change, AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function isPlainObject(value: unknown): value is Record<string, Json> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  )
}

export async function createEventAction(input: {
  event: Record<string, unknown>
  idempotencyKey: string
}): Promise<ActionResult<{ eventId: string }>> {
  if (!isPlainObject(input.event) || !UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_create_event", {
    p_event: input.event,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const created = result.data as { event_id: string }
  return { ok: true, data: { eventId: created.event_id } }
}

// Any field of the session but its concept (the RPC refuses concept_id).
export async function updateEventAction(input: {
  eventId: string
  changes: Record<string, unknown>
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !UUID.test(input.eventId) ||
    !isPlainObject(input.changes) ||
    "concept_id" in input.changes ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_update_event", {
    p_event_id: input.eventId,
    p_changes: input.changes,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

export async function publishEventAction(input: {
  eventId: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (!UUID.test(input.eventId) || !UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_publish_event", {
    p_event_id: input.eventId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

// A new draft from a session on another date (local date and times).
export async function duplicateEventAction(input: {
  eventId: string
  date: string
  startTime: string
  endTime: string
  idempotencyKey: string
}): Promise<ActionResult<{ eventId: string }>> {
  if (
    !UUID.test(input.eventId) ||
    !DATE.test(input.date) ||
    !TIME.test(input.startTime) ||
    !TIME.test(input.endTime) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_duplicate_event", {
    p_event_id: input.eventId,
    p_date: input.date,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const created = result.data as { event_id: string }
  return { ok: true, data: { eventId: created.event_id } }
}

// Manual booking (story 3.4): Tal books a customer for a session, also after
// the registration close. admin_book_customer checks the customer, the
// session, its end, the capacity and the funding again under its locks.
export async function adminBookCustomerAction(input: {
  customerId: string
  eventId: string
  idempotencyKey: string
}): Promise<ActionResult<{ bookingId: string }>> {
  if (
    !UUID.test(input.customerId) ||
    !UUID.test(input.eventId) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_book_customer", {
    p_customer_id: input.customerId,
    p_event_id: input.eventId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const booked = result.data as { booking_id: string }
  return { ok: true, data: { bookingId: booked.booking_id } }
}

// The same checks without a lock or a write (what will be used, or why not).
export async function previewAdminBookAction(input: {
  customerId: string
  eventId: string
}): Promise<ActionResult<BookPreview>> {
  if (!UUID.test(input.customerId) || !UUID.test(input.eventId)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_book_customer",
    { p_customer_id: input.customerId, p_event_id: input.eventId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseBookPreview(result.data) }
}
