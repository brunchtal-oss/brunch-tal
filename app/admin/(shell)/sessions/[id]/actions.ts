"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { deletePublicMedia } from "@/lib/server/privileged/media"
import { createClient } from "@/lib/supabase/server"

import {
  parseCancelPlan,
  type CancelChoice,
  type CancelPlan,
} from "./cancel-plan"
import {
  parseCancelEventPlan,
  parseDeleteEventPlan,
  parseHiddenPaths,
  parseNotified,
  parseRescheduleEventPlan,
  type CancelEventPlan,
  type DeleteEventPlan,
  type RescheduleEventPlan,
} from "./event-plan"

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

// Story 3.8: Tal cancels or moves the whole session (sensitive, AD-7). The
// message is the notice's body Tal edited (1-1000 characters after
// trimming; the RPC checks again).
const MESSAGE_MAX = 1000
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function validMessage(message: unknown): message is string {
  return (
    typeof message === "string" &&
    message.trim().length >= 1 &&
    message.trim().length <= MESSAGE_MAX
  )
}

// The new local date and times as instants for the RPC. Postgres reads the
// zone name (AD-8: the conversion, daylight saving included, is the
// database's, never the browser's).
type When = { date: string; startTime: string; endTime: string }

function validWhen(when: unknown): when is When {
  const w = when as When | null
  return (
    typeof w === "object" &&
    w !== null &&
    typeof w.date === "string" &&
    DATE.test(w.date) &&
    typeof w.startTime === "string" &&
    TIME.test(w.startTime) &&
    typeof w.endTime === "string" &&
    TIME.test(w.endTime)
  )
}

function jerusalem(date: string, time: string): string {
  return `${date} ${time}:00 Asia/Jerusalem`
}

export async function previewCancelEventAction(input: {
  eventId: string
}): Promise<ActionResult<CancelEventPlan>> {
  if (typeof input?.eventId !== "string" || !UUID.test(input.eventId)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_cancel_event",
    { p_event_id: input.eventId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseCancelEventPlan(result.data) }
}

export async function adminCancelEventAction(input: {
  eventId: string
  message: string
  confirmed: boolean
  // The second checkbox: purchases paid without a place (3.8).
  parkedAcknowledged?: boolean
  idempotencyKey: string
}): Promise<ActionResult<{ notified: number }>> {
  if (
    typeof input?.eventId !== "string" ||
    !UUID.test(input.eventId) ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.idempotencyKey) ||
    !validMessage(input.message) ||
    typeof input.confirmed !== "boolean" ||
    (input.parkedAcknowledged !== undefined &&
      typeof input.parkedAcknowledged !== "boolean")
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_cancel_event", {
    p_event_id: input.eventId,
    p_confirmed: input.confirmed,
    p_message: input.message,
    p_idempotency_key: input.idempotencyKey,
    p_parked_acknowledged: input.parkedAcknowledged === true,
  })
  if (!result.ok) return result
  return { ok: true, data: { notified: parseNotified(result.data) } }
}

export async function previewRescheduleEventAction(
  input: { eventId: string } & When
): Promise<ActionResult<RescheduleEventPlan>> {
  if (
    typeof input?.eventId !== "string" ||
    !UUID.test(input.eventId) ||
    !validWhen(input)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_reschedule_event",
    {
      p_event_id: input.eventId,
      p_starts_at: jerusalem(input.date, input.startTime),
      p_ends_at: jerusalem(input.date, input.endTime),
    }
  )
  if (!result.ok) return result
  return { ok: true, data: parseRescheduleEventPlan(result.data) }
}

export async function adminRescheduleEventAction(
  input: {
    eventId: string
    message: string
    confirmed: boolean
    idempotencyKey: string
  } & When
): Promise<ActionResult<{ notified: number }>> {
  if (
    typeof input?.eventId !== "string" ||
    !UUID.test(input.eventId) ||
    !validWhen(input) ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.idempotencyKey) ||
    !validMessage(input.message) ||
    typeof input.confirmed !== "boolean"
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_reschedule_event", {
    p_event_id: input.eventId,
    p_starts_at: jerusalem(input.date, input.startTime),
    p_ends_at: jerusalem(input.date, input.endTime),
    p_confirmed: input.confirmed,
    p_message: input.message,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  return { ok: true, data: { notified: parseNotified(result.data) } }
}

// Story 3.17: Tal deletes a draft or published session nobody booked
// (sensitive, AD-7). The RPC checks everything again (no bookings row, no
// pinned purchase, the status) and may hide images no longer used; their
// public files are deleted here, after it.
export async function previewDeleteEventAction(input: {
  eventId: string
}): Promise<ActionResult<DeleteEventPlan>> {
  if (typeof input?.eventId !== "string" || !UUID.test(input.eventId)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "preview_admin_delete_event",
    { p_event_id: input.eventId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseDeleteEventPlan(result.data) }
}

export async function adminDeleteEventAction(input: {
  eventId: string
  confirmed: boolean
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    typeof input?.eventId !== "string" ||
    !UUID.test(input.eventId) ||
    typeof input.idempotencyKey !== "string" ||
    !UUID.test(input.idempotencyKey) ||
    typeof input.confirmed !== "boolean"
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const client = await createClient()
  const result = await callRpc(client, "admin_delete_event", {
    p_event_id: input.eventId,
    p_confirmed: input.confirmed,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  await deletePublicMedia(client, parseHiddenPaths(result.data))
  return { ok: true, data: undefined }
}
