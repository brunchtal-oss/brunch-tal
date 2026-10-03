"use server"

import { randomUUID } from "node:crypto"
import { redirect } from "next/navigation"

import { cleanToken } from "@/lib/auth/clean-token"
import type { ConflictReason } from "@/lib/auth/join-link-state"
import type { ErrorCode, ErrorDetail } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { getJoinTokenView, submitJoin } from "@/lib/server/privileged/join"
import { createClient } from "@/lib/supabase/server"

import { validateJoin, type JoinFieldError } from "./join-input"
import { claimLoginHref } from "./join-view"

// The idempotency key comes from the page (randomUUID on the server, AD-5).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type JoinFormState =
  | null
  | { status: "conflict"; reason: ConflictReason | null }
  // The details matched two accounts (attempts 1 and 2): the form stays and
  // the next attempt is sent with this new key (the previous one is stored
  // with the previous input).
  | { status: "identity_retry"; idempotencyKey: string }
  // Auth refused the email (story 2.4): the form stays for a corrected email,
  // sent with this new key.
  | { status: "email_exists"; idempotencyKey: string }
  // Joined, but the sign-in failed: the customer logs in herself.
  | { status: "joined" }
  | { status: "used" }
  | { status: "expired" }
  | { status: "error"; code: ErrorCode; errors: JoinFieldError[] }

// INVALID_INPUT and CONSENT_REQUIRED from the RPCs, mapped to the field the
// SQL named (detail.field, detail.index).
function rpcFieldError(
  code: ErrorCode,
  detail: ErrorDetail | undefined
): JoinFieldError | null {
  if (code === "CONSENT_REQUIRED") return { field: "privacy", message: code }
  if (code === "PASSWORD_TOO_SHORT") return { field: "password", message: code }
  if (code !== "INVALID_INPUT" || !detail?.field) return null
  const index = detail.index
  switch (detail.field) {
    case "email":
      return { field: "email", message: "email" }
    case "phone":
      return { field: "phone", message: "phone" }
    case "full_name":
      return { field: "fullName", message: code }
    case "dietary_notes":
      return { field: "dietaryNotes", message: code }
    case "photo_consent":
      return { field: "photoConsent", message: "photoConsent" }
    case "baby_name":
      return { field: "babyName", index: index ?? 0, message: "FIELD_REQUIRED" }
    case "birth_date":
      return { field: "birthDate", index: index ?? 0, message: "birthDate" }
    case "babies":
      return { field: "babyName", index: 0, message: code }
    default:
      return null
  }
}

export async function submitJoinAction(
  _previous: JoinFormState,
  formData: FormData
): Promise<JoinFormState> {
  const rawToken = formData.get("token")
  const token = typeof rawToken === "string" ? cleanToken(rawToken) : null
  const idempotencyKey = formData.get("idempotencyKey")
  // A missing token or key means the form did not come from our page.
  if (
    !token ||
    typeof idempotencyKey !== "string" ||
    !UUID.test(idempotencyKey)
  ) {
    return { status: "expired" }
  }

  const validated = validateJoin(formData)
  if (!validated.ok) {
    return { status: "error", code: "INVALID_INPUT", errors: validated.errors }
  }

  const result = await submitJoin(token, validated.input, idempotencyKey)
  if (!result.ok) {
    if (result.code === "LINK_USED") return { status: "used" }
    if (result.code === "LINK_EXPIRED") return { status: "expired" }
    const fieldError = rpcFieldError(result.code, result.detail)
    return {
      status: "error",
      code: result.code,
      errors: fieldError ? [fieldError] : [],
    }
  }
  if (result.data.outcome === "conflict") {
    return { status: "conflict", reason: result.data.reason }
  }
  if (result.data.outcome === "identity_retry") {
    return { status: "identity_retry", idempotencyKey: randomUUID() }
  }
  if (result.data.outcome === "email_exists") {
    return { status: "email_exists", idempotencyKey: randomUUID() }
  }
  // The details belong to an existing account: the page reads the link
  // again (awaiting_login) and offers the login.
  if (result.data.outcome === "existing_account") redirect(`/join/${token}`)

  // Sign in on the server so the customer lands in /me (AD-10 step 4).
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: result.data.email,
    password: validated.input.password,
  })
  if (error) {
    console.error("join.sign_in_failed", { authCode: error.code ?? "unknown" })
    return { status: "joined" }
  }
  redirect("/me")
}

export type ClaimFormState =
  | null
  | { status: "conflict"; reason: ConflictReason | null }
  | { status: "used" }
  | { status: "expired" }
  // Signed in to an account this link is not bound to.
  | { status: "other_account" }
  | { status: "error"; code: ErrorCode }

// The signed-in customer adds the purchase of an awaiting_login link to her
// account (claim_join, story 2.3). Only this click binds; opening the page or
// logging in never does. The session client (RLS, auth.uid()) calls the RPC;
// NOT_AUTHORIZED carries no detail, so the link is read again: used or
// expired show their usual screen, an active (unbound) link goes back to the
// page, a session that ended since the page opened goes to the login, and
// anything else means another account is signed in.
export async function claimJoinAction(
  _previous: ClaimFormState,
  formData: FormData
): Promise<ClaimFormState> {
  const rawToken = formData.get("token")
  const token = typeof rawToken === "string" ? cleanToken(rawToken) : null
  const idempotencyKey = formData.get("idempotencyKey")
  if (
    !token ||
    typeof idempotencyKey !== "string" ||
    !UUID.test(idempotencyKey)
  ) {
    return { status: "expired" }
  }

  const supabase = await createClient()
  const result = await callRpc(supabase, "claim_join", {
    p_token: token,
    p_idempotency_key: idempotencyKey,
  })

  if (!result.ok) {
    if (result.code !== "NOT_AUTHORIZED") {
      return { status: "error", code: result.code }
    }
    let view: Awaited<ReturnType<typeof getJoinTokenView>>
    try {
      view = await getJoinTokenView(token)
    } catch {
      return { status: "error", code: "SERVER_ERROR" }
    }
    const state = view.state
    if (state === "used") return { status: "used" }
    if (state === "expired") return { status: "expired" }
    if (state === "conflict") {
      return { status: "conflict", reason: view.conflictReason }
    }
    if (state === "active") redirect(`/join/${token}`)
    if (state === "awaiting_login") {
      const { data: claims } = await supabase.auth.getClaims()
      if (!claims?.claims) redirect(claimLoginHref(token))
    }
    return { status: "other_account" }
  }

  const claimed = result.data as { outcome?: string }
  // claim_join's only conflict is a bind conflict.
  if (claimed.outcome === "conflict") {
    return { status: "conflict", reason: "bind_conflict" }
  }
  if (claimed.outcome !== "claimed") {
    return { status: "error", code: "SERVER_ERROR" }
  }
  redirect("/me")
}
