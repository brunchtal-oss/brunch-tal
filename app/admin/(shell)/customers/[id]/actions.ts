"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { resetLinkFor } from "@/lib/server/join-link"
import { changeEmail } from "@/lib/server/privileged/account"
import { anonymizeCustomer } from "@/lib/server/privileged/anonymize"
import { createClient } from "@/lib/supabase/server"

import { NOTE_MAX } from "./card-items"
import { parseRemovalPlan, type RemovalPlan } from "./remove-details-items"
import {
  MAX_CREDIT_OPTIONS,
  parseCreditCandidates,
  parseCreditChangePlan,
  parseCreditRefundPlan,
  type CreditCandidate,
  type CreditChangePlan,
  type CreditRefundPlan,
} from "./credit-items"

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

// ---------------------------------------------------------------------------
// Story 4.6: removing her personal details (a sensitive action, AD-7, and
// a two-step one, AD-21). The preview words the blockers and what she
// loses; the removal runs lib/server/privileged/anonymize.ts (Tal's session
// for the RPCs, the service role only for the Auth delete). The same action
// is the retry of a removal left pending ("השלמת ההסרה").
// ---------------------------------------------------------------------------

export async function previewRemoveDetailsAction(input: {
  customerId: string
}): Promise<ActionResult<RemovalPlan>> {
  if (!isUuid(input?.customerId)) return INVALID
  const result = await callRpc(
    await createClient(),
    "preview_admin_anonymize_customer",
    { p_customer_id: input.customerId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseRemovalPlan(result.data) }
}

export async function removeDetailsAction(input: {
  customerId: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (!isUuid(input?.customerId) || !isUuid(input.idempotencyKey)) {
    return INVALID
  }
  return anonymizeCustomer(input.customerId, input.idempotencyKey)
}

// ---------------------------------------------------------------------------
// Story 3.16: a credit's alternatives, or a refund instead of it (two
// sensitive actions, AD-7). The RPCs check the admin, the credit and every
// session again; these check only the shape.
// ---------------------------------------------------------------------------

const REASON_MAX = 2000
// The generated Args type marks every parameter as non-null; an empty
// reason is sent as null.
const NO_REASON = null as unknown as string

function isEventIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_CREDIT_OPTIONS &&
    value.every(isUuid) &&
    new Set(value).size === value.length
  )
}

function isReason(value: unknown): value is string {
  return typeof value === "string" && value.length <= REASON_MAX
}

export async function listCreditCandidatesAction(input: {
  creditId: string
}): Promise<ActionResult<CreditCandidate[]>> {
  if (!isUuid(input?.creditId)) return INVALID
  const result = await callRpc(
    await createClient(),
    "admin_list_credit_candidates",
    { p_credit_id: input.creditId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseCreditCandidates(result.data) }
}

export async function previewChangeCreditOptionsAction(input: {
  creditId: string
  eventIds: string[]
}): Promise<ActionResult<CreditChangePlan>> {
  if (!isUuid(input?.creditId) || !isEventIds(input.eventIds)) return INVALID
  const result = await callRpc(
    await createClient(),
    "preview_admin_change_credit_options",
    { p_credit_id: input.creditId, p_event_ids: input.eventIds }
  )
  if (!result.ok) return result
  return { ok: true, data: parseCreditChangePlan(result.data) }
}

export async function changeCreditOptionsAction(input: {
  creditId: string
  eventIds: string[]
  reason: string
  confirmed: boolean
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.creditId) ||
    !isEventIds(input.eventIds) ||
    !isReason(input.reason) ||
    typeof input.confirmed !== "boolean" ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_change_credit_options", {
      p_credit_id: input.creditId,
      p_event_ids: input.eventIds,
      p_reason: input.reason.trim() || NO_REASON,
      p_confirmed: input.confirmed,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}

export async function previewRefundCreditAction(input: {
  creditId: string
}): Promise<ActionResult<CreditRefundPlan>> {
  if (!isUuid(input?.creditId)) return INVALID
  const result = await callRpc(
    await createClient(),
    "preview_admin_refund_credit",
    { p_credit_id: input.creditId }
  )
  if (!result.ok) return result
  return { ok: true, data: parseCreditRefundPlan(result.data) }
}

export async function refundCreditAction(input: {
  creditId: string
  reason: string
  confirmed: boolean
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !isUuid(input?.creditId) ||
    !isReason(input.reason) ||
    typeof input.confirmed !== "boolean" ||
    !isUuid(input.idempotencyKey)
  ) {
    return INVALID
  }
  return done(
    await callRpc(await createClient(), "admin_refund_credit", {
      p_credit_id: input.creditId,
      p_reason: input.reason.trim() || NO_REASON,
      p_confirmed: input.confirmed,
      p_idempotency_key: input.idempotencyKey,
    })
  )
}
