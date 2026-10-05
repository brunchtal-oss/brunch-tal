"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { deletePublicMedia, publishMedia } from "@/lib/server/privileged/media"
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

// A new image row for a session's image (story 5.4); the browser then
// uploads the file to media-drafts/<mediaId>.
export async function createSessionMediaAction(input: {
  idempotencyKey: string
}): Promise<ActionResult<{ mediaId: string }>> {
  if (!UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_create_media", {
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const created = result.data as { media_id: string }
  return { ok: true, data: { mediaId: created.media_id } }
}

function isFocus(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 100
  )
}

// A session's image (story 5.4): saving publishes the image (AD-21: begin,
// copy, finish) and then sets it with admin_set_event_image; null removes
// it. An image the session no longer uses (and nothing else does) is hidden
// by the RPC, and its public file is deleted here, after it.
export async function setSessionImageAction(input: {
  eventId: string
  image: {
    media_id: string
    alt: string
    focus_x: number
    focus_y: number
  } | null
}): Promise<ActionResult> {
  const image = input.image
  if (
    !UUID.test(input.eventId) ||
    (image !== null &&
      (typeof image !== "object" ||
        !UUID.test(image.media_id) ||
        typeof image.alt !== "string" ||
        image.alt.length > 300 ||
        !isFocus(image.focus_x) ||
        !isFocus(image.focus_y)))
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }

  const client = await createClient()
  if (image) {
    const published = await publishMedia(client, image)
    if (!published.ok) return published
  }
  const result = await callRpc(client, "admin_set_event_image", {
    p_event_id: input.eventId,
    // null removes the image (the generated type has no null for uuid).
    p_media_id: image ? image.media_id : (null as unknown as string),
  })
  if (!result.ok) return result
  const saved = result.data as { hidden_paths?: string[] }
  await deletePublicMedia(client, saved.hidden_paths ?? [])
  return { ok: true, data: undefined }
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
