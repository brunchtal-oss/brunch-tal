"use server"

import { cleanToken } from "@/lib/auth/clean-token"
import type { ErrorCode } from "@/lib/errors"
import { completeReset } from "@/lib/server/privileged/reset"
import { createClient } from "@/lib/supabase/server"

const MIN_PASSWORD_LENGTH = 8
// The idempotency key comes from the page (randomUUID on the server, AD-5).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ResetFormState =
  | null
  | { ok: true; data: { signedIn: boolean } }
  | { ok: false; code: ErrorCode; field?: "password" | "confirm" }

export async function completeResetAction(
  _previous: ResetFormState,
  formData: FormData
): Promise<ResetFormState> {
  const rawToken = formData.get("token")
  const token = typeof rawToken === "string" ? cleanToken(rawToken) : null
  const password = formData.get("password")
  const idempotencyKey = formData.get("idempotencyKey")
  if (typeof token !== "string") return { ok: false, code: "LINK_EXPIRED" }
  // A missing or malformed key means the form did not come from our page.
  if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) {
    return { ok: false, code: "LINK_EXPIRED" }
  }

  const confirm = formData.get("confirm")

  // Field validation happens before any call to Auth.
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, code: "PASSWORD_TOO_SHORT", field: "password" }
  }
  if (typeof confirm !== "string" || confirm !== password) {
    return { ok: false, code: "PASSWORDS_DONT_MATCH", field: "confirm" }
  }

  const result = await completeReset(token, password, idempotencyKey)
  if (!result.ok) {
    return result.code === "PASSWORD_TOO_SHORT"
      ? { ok: false, code: result.code, field: "password" }
      : { ok: false, code: result.code }
  }

  // Sign in with the new password so the customer lands in /me, then end
  // every other session of this user (other devices, old logins). Access
  // tokens already issued elsewhere stay valid until they expire (JWT expiry).
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
    } else {
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "others",
      })
      if (signOutError) {
        console.error("reset.sign_out_others_failed", {
          authCode: signOutError.code ?? "unknown",
        })
      }
    }
  }

  return { ok: true, data: { signedIn } }
}
