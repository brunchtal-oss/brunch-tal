"use server"

import type { ErrorCode } from "@/lib/errors"
import { completeReset } from "@/lib/server/privileged/reset"
import { createClient } from "@/lib/supabase/server"

const MIN_PASSWORD_LENGTH = 8

export type ResetFormState =
  | null
  | { ok: true; data: { signedIn: boolean } }
  | { ok: false; code: ErrorCode; field?: "password" | "confirm" }

export async function completeResetAction(
  _previous: ResetFormState,
  formData: FormData
): Promise<ResetFormState> {
  const token = formData.get("token")
  const password = formData.get("password")
  if (typeof token !== "string") return { ok: false, code: "LINK_EXPIRED" }

  const confirm = formData.get("confirm")

  // Field validation happens before any call to Auth.
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, code: "PASSWORD_TOO_SHORT", field: "password" }
  }
  if (typeof confirm !== "string" || confirm !== password) {
    return { ok: false, code: "PASSWORDS_DONT_MATCH", field: "confirm" }
  }

  const result = await completeReset(token, password)
  if (!result.ok) {
    return result.code === "PASSWORD_TOO_SHORT"
      ? { ok: false, code: result.code, field: "password" }
      : { ok: false, code: result.code }
  }

  // Sign in with the new password so the customer lands in /me.
  let signedIn = false
  if (result.data.email) {
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: result.data.email,
      password,
    })
    signedIn = !error
    if (error) {
      console.error("reset.sign_in_failed", {
        authCode: error.code ?? "unknown",
      })
    }
  }

  return { ok: true, data: { signedIn } }
}
