"use server"

import type { ActionResult } from "@/lib/errors"
import { isPlainObject } from "@/lib/form-values"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { MAX_SESSIONS } from "./booking-results"

// Several sessions for one customer (story 4.3, user decision 2026-10-13):
// the dates are booked one after another with the existing
// admin_book_customer, each with its own idempotency key (made by the
// screen when the sheet opens, kept on a retry). A refused date does not
// undo the others. This action only checks the shape; the RPC checks the
// customer, the session, the capacity and the funding again under its
// locks.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type BookItem = { eventId: string; idempotencyKey: string }

export type BookManyResult = {
  results: {
    event_id: string
    ok: boolean
    code: string | null
    booking_id: string | null
  }[]
}

function validItems(items: unknown): items is BookItem[] {
  if (!Array.isArray(items)) return false
  if (items.length === 0 || items.length > MAX_SESSIONS) return false
  const events = new Set<string>()
  const keys = new Set<string>()
  for (const item of items) {
    if (!isPlainObject(item)) return false
    const { eventId, idempotencyKey } = item as Record<string, unknown>
    if (typeof eventId !== "string" || !UUID.test(eventId)) return false
    if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) {
      return false
    }
    events.add(eventId.toLowerCase())
    keys.add(idempotencyKey.toLowerCase())
  }
  return events.size === items.length && keys.size === items.length
}

export async function adminBookSessionsAction(input: {
  customerId: string
  items: BookItem[]
}): Promise<ActionResult<BookManyResult>> {
  const raw: unknown = input
  if (
    !isPlainObject(raw) ||
    typeof raw.customerId !== "string" ||
    !UUID.test(raw.customerId) ||
    !validItems(raw.items)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const client = await createClient()
  const results: BookManyResult["results"] = []
  for (const item of input.items) {
    const result = await callRpc(client, "admin_book_customer", {
      p_customer_id: input.customerId,
      p_event_id: item.eventId,
      p_idempotency_key: item.idempotencyKey,
    })
    const bookingId = result.ok
      ? ((result.data as { booking_id?: unknown } | null)?.booking_id ?? null)
      : null
    results.push({
      event_id: item.eventId,
      ok: result.ok,
      code: result.ok ? null : result.code,
      booking_id: typeof bookingId === "string" ? bookingId : null,
    })
  }
  return { ok: true, data: { results } }
}
