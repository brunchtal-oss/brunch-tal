import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { ErrorCode } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createServiceClient } from "@/lib/server/privileged/service-client"
import { siteUrl } from "@/lib/site-url"
import type { Database } from "@/lib/supabase/database.types"

// Story 6.11: the emails and our own verification record.
//
// Every email leaves through the database (private.send_email: pg_net ->
// the Resend API, the key in Vault). Auth's own emails pass through the
// Send Email Hook (public.send_email_hook), which sends only a recovery
// email to a verified, eligible account.
//   - verification: request_email_verification issues our own one-time
//     token and sends <site>/verify-email?token=<raw>;
//     consume_email_verification uses it (no Auth token, nobody logs in);
//   - reset: resetPasswordForEmail on a stateless client (the publishable
//     key, no session kept, no cookies, implicit flow, so the email's
//     token_hash works on any device); the hook builds the link
//     /reset-password?token_hash=..., used with verifyOtp.
// The email links are used only on a button press (a Server Action), never
// on the GET, so mail scanners and previews never consume them.
// Logs carry only codes, never an address, a token or a password (AD-22).

export type StatelessClient = ReturnType<typeof createStatelessClient>

export function createStatelessClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error("Supabase is not configured")
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
    },
  })
}

export type SendResult = "sent" | "verified" | "failed"

// The verification email to the account's current address: our token, the
// link on the site's address (lib/site-url.ts). "verified": already
// verified, nothing sent. Never throws.
export async function sendVerificationEmail(
  userId: string
): Promise<SendResult> {
  try {
    const result = await callRpc(
      createServiceClient(),
      "request_email_verification",
      { p_user_id: userId, p_site_url: siteUrl() }
    )
    if (!result.ok) {
      console.error("email_auth.verification_failed", { code: result.code })
      return "failed"
    }
    const data = result.data as { sent?: unknown; reason?: unknown } | null
    if (data?.reason === "verified") return "verified"
    if (data?.sent !== true) {
      // No Resend key in Vault (the database logged a warning).
      console.error("email_auth.verification_failed", { code: "NOT_SENT" })
      return "failed"
    }
    return "sent"
  } catch {
    console.error("email_auth.verification_failed", { code: "exception" })
    return "failed"
  }
}

// Auth's recovery email (through the hook). Auth answers the same for any
// address; only its own errors are logged.
export async function sendResetEmail(email: string): Promise<void> {
  try {
    const { error } =
      await createStatelessClient().auth.resetPasswordForEmail(email)
    if (error) {
      console.error("email_auth.reset_failed", {
        authCode: error.code ?? "unknown",
      })
    }
  } catch {
    console.error("email_auth.reset_failed", { authCode: "exception" })
  }
}

export type Eligibility = { userId: string | null; eligible: boolean }

// get_email_reset_eligibility (service role): an activated, non-anonymized
// customer or an admin, whose current email is verified.
export async function resetEligibility(email: string): Promise<Eligibility> {
  const result = await callRpc(
    createServiceClient(),
    "get_email_reset_eligibility",
    { p_email: email }
  )
  if (!result.ok) throw new Error(`get_email_reset_eligibility ${result.code}`)
  const data = result.data as { user_id?: unknown; eligible?: unknown } | null
  return {
    userId: typeof data?.user_id === "string" ? data.user_id : null,
    eligible: data?.eligible === true,
  }
}

// Forgot password, run in after(): sends the recovery email only to an
// eligible address. Every failure is swallowed (the visitor's answer is the
// same in every case) and logged without the address.
export async function sendResetIfEligible(email: string): Promise<void> {
  try {
    const { eligible } = await resetEligibility(email)
    if (eligible) await sendResetEmail(email)
  } catch {
    console.error("email_auth.forgot_failed", { code: "ELIGIBILITY" })
  }
}

// Maps verifyOtp's refusal: a used, expired or unknown link is
// LINK_INVALID; Auth's rate limit TOO_MANY_ATTEMPTS; anything else
// (network, 5xx) SERVER_ERROR.
export function linkErrorCode(error: {
  code?: string
  status?: number
}): ErrorCode {
  if (error.status === 429) return "TOO_MANY_ATTEMPTS"
  if (error.status !== undefined && error.status >= 400 && error.status < 500) {
    return "LINK_INVALID"
  }
  return "SERVER_ERROR"
}

// Ends the session verifyOtp opened on a stateless client (only that one).
async function dropSession(client: StatelessClient): Promise<void> {
  try {
    await client.auth.signOut({ scope: "local" })
  } catch {
    // The session's tokens die with the client; its refresh token expires.
  }
}

export type VerifiedResult =
  { ok: true; isAdmin: boolean } | { ok: false; code: ErrorCode }

// /verify-email, on the button press: consume_email_verification uses our
// token and writes the record in one transaction, only while the address
// it was sent to is still the account's email, and only for the account
// signed in on this browser (sessionUserId, read by the caller from the
// browser's session, never from the form; another account: LINK_INVALID and
// the token stays unused). Nobody's session changes.
export async function markVerified(
  token: string,
  sessionUserId: string
): Promise<VerifiedResult> {
  const result = await callRpc(
    createServiceClient(),
    "consume_email_verification",
    { p_token: token, p_session_user_id: sessionUserId }
  )
  if (!result.ok) {
    if (result.code === "LINK_INVALID") return result
    console.error("email_auth.mark_verified_failed", { code: result.code })
    return { ok: false, code: "SERVER_ERROR" }
  }
  const isAdmin = (result.data as { is_admin?: unknown } | null)?.is_admin
  return { ok: true, isAdmin: isAdmin === true }
}

export type RecoveryResult =
  { ok: true; email: string } | { ok: false; code: ErrorCode }

// /reset-password, on the button press, after the form's shape was
// checked (8 to 72 bytes, so Auth never refuses the length after the link
// was used): verifyOtp (type recovery) consumes the link; the account must
// still be eligible (the same rule as the forgot page); then the new
// password through the Auth Admin API, and at once every session of hers
// ends (signOut global on the link's own session), whatever happens next.
// same_password counts as saved. Any other refusal of the password after
// the link was used: LINK_INVALID, whose screen leads to a new link.
export async function completeRecovery(
  tokenHash: string,
  password: string
): Promise<RecoveryResult> {
  const client = createStatelessClient()
  let user: { id: string; email: string | null }
  try {
    const { data, error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    })
    if (error) return { ok: false, code: linkErrorCode(error) }
    if (!data.user) return { ok: false, code: "LINK_INVALID" }
    user = { id: data.user.id, email: data.user.email ?? null }
  } catch {
    return { ok: false, code: "SERVER_ERROR" }
  }

  let signedOutEverywhere = false
  try {
    if (!user.email) return { ok: false, code: "LINK_INVALID" }
    // The link is used already: a failed read leads to a new link, not to
    // "try again".
    let eligibility: Eligibility
    try {
      eligibility = await resetEligibility(user.email)
    } catch {
      console.error("email_auth.reset_eligibility_failed", {
        code: "exception",
      })
      return { ok: false, code: "LINK_INVALID" }
    }
    if (!eligibility.eligible || eligibility.userId !== user.id) {
      return { ok: false, code: "LINK_INVALID" }
    }
    const updated = await createServiceClient().auth.admin.updateUserById(
      user.id,
      { password }
    )
    const authCode = updated.error?.code
    if (updated.error && authCode !== "same_password") {
      console.error("email_auth.reset_update_failed", {
        authCode: authCode ?? "unknown",
      })
      const status = updated.error.status
      return {
        ok: false,
        code:
          status !== undefined && status >= 400 && status < 500
            ? "LINK_INVALID"
            : "SERVER_ERROR",
      }
    }
    // Every session of hers ends (other devices, an old login, this one).
    const { error: signOutError } = await client.auth.signOut({
      scope: "global",
    })
    if (signOutError) {
      console.error("email_auth.reset_sign_out_failed", {
        authCode: signOutError.code ?? "unknown",
      })
    } else {
      signedOutEverywhere = true
    }
    return { ok: true, email: user.email }
  } catch {
    console.error("email_auth.reset_update_failed", { authCode: "exception" })
    return { ok: false, code: "SERVER_ERROR" }
  } finally {
    if (!signedOutEverywhere) await dropSession(client)
  }
}

export type PasswordCheck = "ok" | "wrong" | "limited" | "failed"

// The current password of a self email change, on a stateless client: the
// browser's session stays as it is, and the session this sign-in opened is
// ended at once.
export async function checkPassword(
  email: string,
  password: string
): Promise<PasswordCheck> {
  const client = createStatelessClient()
  try {
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (!error) {
      await dropSession(client)
      return "ok"
    }
    if (error.code === "invalid_credentials") return "wrong"
    if (error.status === 429) return "limited"
    console.error("email_auth.password_check_failed", {
      authCode: error.code ?? "unknown",
    })
    return "failed"
  } catch {
    return "failed"
  }
}
