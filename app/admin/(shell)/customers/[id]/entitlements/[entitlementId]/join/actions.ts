"use server"

import { randomUUID } from "node:crypto"

import { cleanToken } from "@/lib/auth/clean-token"
import { toSessionRole } from "@/lib/auth/destination"
import { callRpc } from "@/lib/rpc"
import { submitJoinFill } from "@/lib/server/privileged/join"
import { createClient } from "@/lib/supabase/server"

import {
  rpcFieldError,
  validateJoin,
} from "@/app/(auth)/join/[token]/join-input"
import type { SharedFormState } from "@/app/(auth)/join/[token]/join-view"

// Tal fills the join form for a customer who paid (story 2.15, user decision
// 2026-11-09). The admin role first (the session client), then the shape,
// then the fill: admin_begin_join_fill with Tal's session, and the join core
// with the service role. No rate limit and no sign-in: Tal's session is never
// touched. The result never carries the password (the done screen takes it
// from the form). Every result carries the link of the next attempt (token),
// so a retry continues the same claiming link.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FillFormState = SharedFormState

export async function submitJoinFillAction(
  _previous: SharedFormState,
  formData: FormData
): Promise<SharedFormState> {
  const supabase = await createClient()
  const role = await callRpc(supabase, "get_my_session_role")
  if (!role.ok) return { status: "error", code: "SERVER_ERROR", errors: [] }
  if (toSessionRole(role.data) !== "admin") {
    return { status: "error", code: "NOT_AUTHORIZED", errors: [] }
  }

  const paymentId = formData.get("paymentId")
  const idempotencyKey = formData.get("idempotencyKey")
  const rawToken = formData.get("token")
  const token =
    typeof rawToken === "string" && rawToken ? cleanToken(rawToken) : null
  if (
    typeof paymentId !== "string" ||
    !UUID.test(paymentId) ||
    typeof idempotencyKey !== "string" ||
    !UUID.test(idempotencyKey)
  ) {
    return { status: "error", code: "INVALID_INPUT", errors: [] }
  }

  const validated = validateJoin(formData)
  if (!validated.ok) {
    return { status: "error", code: "INVALID_INPUT", errors: validated.errors }
  }

  const fill = await submitJoinFill(
    supabase,
    paymentId,
    validated.input,
    idempotencyKey,
    token
  )
  const next = fill.token
  const result = fill.result

  if (!result.ok) {
    if (result.code === "LINK_USED") return { status: "used", token: null }
    if (result.code === "PURCHASE_VOIDED") {
      return { status: "voided", token: null }
    }
    if (result.code === "LINK_IN_PROGRESS") {
      return { status: "in_progress", token: null }
    }
    // The internal link ended (its hour passed, or it was replaced): the
    // next attempt begins again, with a new key.
    // CONCURRENT_CHANGE: the same key after a lost response (the raw token
    // is gone; the stored result would repeat): also a new key.
    if (result.code === "LINK_EXPIRED" || result.code === "CONCURRENT_CHANGE") {
      return {
        status: "error",
        code: "CONCURRENT_CHANGE",
        errors: [],
        token: null,
        idempotencyKey: randomUUID(),
      }
    }
    const fieldError = rpcFieldError(result.code, result.detail)
    return {
      status: "error",
      code: result.code,
      errors: fieldError ? [fieldError] : [],
      token: next,
    }
  }

  const data = result.data
  switch (data.outcome) {
    case "joined":
      return {
        status: "fill_joined",
        fullName: validated.input.fullName,
        email: data.email,
        customerId: data.customerId,
        token: null,
      }
    case "conflict":
      return { status: "conflict", reason: data.reason, token: null }
    // The details belong to another account: an error on the email field,
    // the form stays (a new key where the customer's path gives one).
    case "details_taken":
    case "existing_account":
    case "identity_retry":
    case "email_exists":
      return {
        status: "error",
        code: "INVALID_INPUT",
        errors: [{ field: "email", message: "detailsTaken" }],
        token: next,
        ...(data.outcome === "identity_retry" || data.outcome === "email_exists"
          ? { idempotencyKey: randomUUID() }
          : {}),
      }
  }
}
