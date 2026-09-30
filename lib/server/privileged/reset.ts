import "server-only"

import type { ResetLinkState } from "@/lib/auth/reset-link-state"
import {
  codeFromPostgrestError,
  type ActionResult,
  type ErrorCode,
} from "@/lib/errors"
import { createServiceClient } from "@/lib/server/privileged/service-client"

// Manual password reset through a one-time link (AD-10, AD-21):
// reset_begin (check) -> Auth Admin updateUserById -> reset_complete.
// reset_begin's row lock ends with its own transaction, so it does not cover
// the Auth update; reset_complete locks and re-checks the token again.
// A retry after a failure in the middle continues from the stored state:
// the token stays `pending` until reset_complete, and updating the password
// again is idempotent. Logs carry only ids and error codes, never the token,
// password or email.

export type { ResetLinkState }

type TokenViewResult = {
  state_public: "active" | "used" | "expired" | "conflict" | "not_found"
  purpose: string | null
}

// Opening the link never changes its state. Expired, revoked, conflict and
// unknown links look the same to the visitor.
export async function getResetTokenView(
  token: string
): Promise<ResetLinkState> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc("token_view", { p_token: token })
  if (error) {
    console.error("reset.token_view_failed", {
      code: codeFromPostgrestError(error),
    })
    throw new Error("token_view failed")
  }

  const view = data as TokenViewResult
  if (view.purpose !== "reset") return "expired"
  if (view.state_public === "active") return "active"
  if (view.state_public === "used") return "used"
  return "expired"
}

type BeginResult = { token_id: string; user_id: string }

export async function completeReset(
  token: string,
  password: string
): Promise<ActionResult<{ email: string | null }>> {
  const supabase = createServiceClient()

  const begin = await supabase.rpc("reset_begin", { p_token: token })
  if (begin.error) {
    return { ok: false, code: codeFromPostgrestError(begin.error) }
  }
  const { token_id: tokenId, user_id: userId } = begin.data as BeginResult

  const updated = await supabase.auth.admin.updateUserById(userId, { password })
  if (updated.error) {
    const authCode = updated.error.code ?? "unknown"
    console.error("reset.update_user_failed", { tokenId, authCode })
    const code: ErrorCode =
      authCode === "weak_password" ? "PASSWORD_TOO_SHORT" : "SERVER_ERROR"
    return { ok: false, code }
  }

  const complete = await supabase.rpc("reset_complete", { p_token: token })
  if (complete.error) {
    // The password already changed in Auth; the link stays pending, so
    // submitting again completes it.
    console.error("reset.complete_failed", {
      tokenId,
      code: codeFromPostgrestError(complete.error),
    })
    return { ok: false, code: "SERVER_ERROR" }
  }

  // The email comes from the update response: no extra Admin API read (AD-4).
  return { ok: true, data: { email: updated.data.user?.email ?? null } }
}
