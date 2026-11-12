"use server"

import { EMAIL_LINK_TOKEN, emailLinkToken } from "@/lib/auth/email-link-token"
import type { ActionResult, ErrorCode } from "@/lib/errors"
import {
  markVerified,
  sendVerificationEmail,
} from "@/lib/server/privileged/email-auth"
import {
  clientIp,
  hitRateLimit,
  rateLimitCode,
} from "@/lib/server/privileged/rate-limit"
import { createClient } from "@/lib/supabase/server"

// Story 6.11: the verification email's link (/verify-email?token=) and the
// "send a verification email" button of the banner (customer home, admin
// home, the profile's email row).

// NOT_AUTHORIZED: nobody is signed in on this browser (the form then shows
// the login prompt).
export type VerifyFormState =
  null | { ok: true; isAdmin: boolean } | { ok: false; code: ErrorCode }

// The press of "אימות המייל": the rate limit first (token bucket, per IP
// and per token), then the shape, then the signed-in user (the account's
// own login is required, user decision 2026-11-11), then our token is used
// and the record written (markVerified) for that user only. Nobody's
// session changes.
export async function verifyEmailAction(
  _previous: VerifyFormState,
  formData: FormData
): Promise<VerifyFormState> {
  const token = emailLinkToken(formData.get("token"))

  const limited = rateLimitCode(
    await hitRateLimit("token", { ip: await clientIp(), id: token || "-" })
  )
  if (limited) return { ok: false, code: limited }

  if (!EMAIL_LINK_TOKEN.test(token)) return { ok: false, code: "LINK_INVALID" }

  // The session user from the browser's session, never from the form.
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (typeof userId !== "string" || !userId) {
    return { ok: false, code: "NOT_AUTHORIZED" }
  }

  const result = await markVerified(token, userId)
  if (!result.ok) return result
  return { ok: true, isAdmin: result.isAdmin }
}

// The banner's button: the rate limit first (email bucket, per IP and per
// "resend:<user id>"), then the verification email to the account's current
// address (read from Auth, not from the session's claims, which may be
// older). Already verified: ok with alreadyVerified, and nothing is sent.
export type ResendResult = ActionResult<{
  email: string
  alreadyVerified: boolean
}>

export async function resendVerificationAction(): Promise<ResendResult> {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (typeof userId !== "string" || !userId) {
    return { ok: false, code: "NOT_AUTHORIZED" }
  }

  const limited = rateLimitCode(
    await hitRateLimit("email", {
      ip: await clientIp(),
      id: `resend:${userId}`,
    })
  )
  if (limited) return { ok: false, code: limited }

  const { data, error } = await supabase.auth.getUser()
  const email = data.user?.email
  if (error || !email) return { ok: false, code: "SERVER_ERROR" }

  const sent = await sendVerificationEmail(userId)
  if (sent === "failed") return { ok: false, code: "SERVER_ERROR" }
  return { ok: true, data: { email, alreadyVerified: sent === "verified" } }
}
