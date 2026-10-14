"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { resetLinkFor } from "@/lib/server/join-link"
import { changeEmail } from "@/lib/server/privileged/account"
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

// The account section (story 2.8). Email: the two-step change of
// lib/server/privileged/account.ts (Tal's session for the RPCs, the service
// role only for the Auth update). Phone: admin_change_phone; a blocked
// change answers { result: 'taken' } (its audit row is committed).
// Reset: admin_issue_link('reset'), the raw link shown once (AD-10).

export async function changeEmailAction(input: {
  customerId: string
  email: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.customerId) ||
    typeof input.email !== "string" ||
    !input.email.trim() ||
    input.email.trim().length > 254 ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return changeEmail(input.customerId, input.email, input.idempotencyKey)
}

export async function changePhoneAction(input: {
  customerId: string
  phone: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.customerId) ||
    typeof input.phone !== "string" ||
    !input.phone.trim() ||
    input.phone.length > 40 ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  const result = await callRpc(await createClient(), "admin_change_phone", {
    p_customer_id: input.customerId,
    p_phone: input.phone.trim(),
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const outcome = (result.data as { result?: string } | null)?.result
  if (outcome === "taken") return { ok: false, code: "PHONE_TAKEN" }
  if (outcome !== "changed") return { ok: false, code: "SERVER_ERROR" }
  return { ok: true, data: undefined }
}

// link is null only for a repeat with the same key (the raw token is
// returned once) or when the site's address cannot be read.
export async function issueResetLinkAction(input: {
  customerId: string
  idempotencyKey: string
}): Promise<ActionResult<{ link: string | null; linkExpiresAt: string }>> {
  if (!isUuid(input?.customerId) || !isUuid(input.idempotencyKey)) {
    return INVALID
  }
  const result = await callRpc(await createClient(), "admin_issue_link", {
    p_purpose: "reset",
    p_target_id: input.customerId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return result
  const issued = result.data as { token?: string; link_expires_at: string }
  return {
    ok: true,
    data: {
      link: issued.token ? await resetLinkFor(issued.token) : null,
      linkExpiresAt: issued.link_expires_at,
    },
  }
}
