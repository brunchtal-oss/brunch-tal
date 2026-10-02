"use server"

import { redirect } from "next/navigation"

import { cleanToken } from "@/lib/auth/clean-token"
import type { ErrorCode, ErrorDetail } from "@/lib/errors"
import { submitJoin } from "@/lib/server/privileged/join"
import { createClient } from "@/lib/supabase/server"

import { validateJoin, type JoinFieldError } from "./join-input"

// The idempotency key comes from the page (randomUUID on the server, AD-5).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type JoinFormState =
  | null
  | { status: "conflict" }
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
  if (result.data.outcome === "conflict") return { status: "conflict" }

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
