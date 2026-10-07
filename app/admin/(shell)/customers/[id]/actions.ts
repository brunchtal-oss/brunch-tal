"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { NOTE_MAX } from "./card-items"

// The internal notes of the customer card (story 4.2): add and delete only
// (user decision 2026-10-07). Each RPC runs with the admin's own session
// (private.is_admin() inside) and checks everything again; these actions
// check only the shape. The idempotency key is made on the screen (AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INVALID: ActionResult<never> = { ok: false, code: "INVALID_INPUT" }

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

function isNote(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= NOTE_MAX
  )
}

function done(result: ActionResult<unknown>): ActionResult {
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

export async function addCustomerNoteAction(input: {
  customerId: string
  body: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.customerId) ||
    !isNote(input.body) ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_add_customer_note", {
      p_customer_id: input.customerId,
      // Trimmed here (all whitespace), as checked; the RPC's btrim trims
      // spaces only.
      p_body: input.body.trim(),
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function deleteCustomerNoteAction(input: {
  noteId: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (!isUuid(input?.noteId) || !isUuid(input.idempotencyKey)) return INVALID
  return done(
    await callRpc(await createClient(), "admin_delete_customer_note", {
      p_note_id: input.noteId,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}
