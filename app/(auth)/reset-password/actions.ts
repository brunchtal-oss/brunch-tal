"use server"

import { redirect } from "next/navigation"

import { toSessionRole } from "@/lib/auth/destination"
import { EMAIL_LINK_TOKEN, emailLinkToken } from "@/lib/auth/email-link-token"
import type { ErrorCode } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { completeRecovery } from "@/lib/server/privileged/email-auth"
import {
  clientIp,
  hitRateLimit,
  rateLimitCode,
} from "@/lib/server/privileged/rate-limit"
import { createClient } from "@/lib/supabase/server"

// Story 6.11: the link of the reset email (/reset-password). The rate limit
// first (token bucket, per IP and per token_hash), then the form's shape,
// so a short, too long or mismatched password never uses the link; then
// verifyOtp, the eligibility again, the new password and every session of
// hers ended (completeRecovery). The browser is then signed in as the
// link's user (she just chose the password), and she lands on /admin or
// /me by her role. Tal's manual reset (/reset/[token], story 2.8) stays as
// the backup.

const MIN_PASSWORD_LENGTH = 8
// Auth (bcrypt) takes at most 72 bytes; checked here, before the link is
// used, so Auth never refuses the length afterwards.
const MAX_PASSWORD_BYTES = 72

export type ResetPasswordState =
  | null
  // Saved, but the sign-in failed: she logs in herself.
  | { ok: true }
  | { ok: false; code: ErrorCode; field?: "password" | "confirm" }

export async function resetPasswordAction(
  _previous: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const tokenHash = emailLinkToken(formData.get("token_hash"))

  const limited = rateLimitCode(
    await hitRateLimit("token", {
      ip: await clientIp(),
      id: tokenHash || "-",
    })
  )
  if (limited) return { ok: false, code: limited }

  if (!EMAIL_LINK_TOKEN.test(tokenHash))
    return { ok: false, code: "LINK_INVALID" }

  const password = formData.get("password")
  const confirm = formData.get("confirm")
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, code: "PASSWORD_TOO_SHORT", field: "password" }
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return { ok: false, code: "PASSWORD_TOO_LONG", field: "password" }
  }
  if (typeof confirm !== "string" || confirm !== password) {
    return { ok: false, code: "PASSWORDS_DONT_MATCH", field: "confirm" }
  }

  const result = await completeRecovery(tokenHash, password)
  if (!result.ok) return { ok: false, code: result.code }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: result.email,
    password,
  })
  if (error) {
    console.error("reset_password.sign_in_failed", {
      authCode: error.code ?? "unknown",
    })
    return { ok: true }
  }
  // Every other session of hers (other devices, an old login, the link's
  // own) ends; access tokens already issued live until they expire.
  const { error: signOutError } = await supabase.auth.signOut({
    scope: "others",
  })
  if (signOutError) {
    console.error("reset_password.sign_out_others_failed", {
      authCode: signOutError.code ?? "unknown",
    })
  }

  const role = await callRpc(supabase, "get_my_session_role")
  redirect(role.ok && toSessionRole(role.data) === "admin" ? "/admin" : "/me")
}
