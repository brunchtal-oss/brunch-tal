import "server-only"

import type { ResetLinkState } from "@/lib/auth/reset-link-state"
import type { ActionResult, ErrorCode } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createServiceClient } from "@/lib/server/privileged/service-client"

// Manual password reset through a one-time link (AD-10, AD-21):
// reset_begin (check) -> Auth Admin updateUserById -> reset_complete.
// reset_begin's row lock ends with its own transaction, so it does not cover
// the Auth update; reset_complete locks and re-checks the token again.
// A retry after a failure in the middle continues from the stored state:
// the token stays `pending` until reset_complete, and updating the password
// again is idempotent. The idempotency key (one per page load, AD-5) makes a
// retry after a lost reset_complete response succeed: reset_begin answers
// already_completed and reset_complete returns its stored result. Logs carry
// only ids and error codes, never the token, password or email.

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
  const result = await callRpc(createServiceClient(), "token_view", {
    p_token: token,
  })
  if (!result.ok) throw new Error("token_view failed")

  const view = result.data as TokenViewResult
  if (view.purpose !== "reset") return "expired"
  if (view.state_public === "active") return "active"
  if (view.state_public === "used") return "used"
  return "expired"
}

type BeginResult = {
  token_id: string
  user_id: string
  already_completed: boolean
}

export async function completeReset(
  token: string,
  password: string,
  idempotencyKey: string
): Promise<ActionResult<{ email: string | null }>> {
  const supabase = createServiceClient()
  const args = { p_token: token, p_idempotency_key: idempotencyKey }

  const begin = await callRpc(supabase, "reset_begin", args)
  if (!begin.ok) return begin
  // already_completed: this key already consumed the link and only the
  // response was lost. The password update below is repeated (idempotent)
  // and reset_complete returns its stored result.
  const { token_id: tokenId, user_id: userId } = begin.data as BeginResult

  const updated = await supabase.auth.admin.updateUserById(userId, { password })
  if (updated.error) {
    const authCode = updated.error.code ?? "unknown"
    console.error("reset.update_user_failed", { tokenId, authCode })
    const code: ErrorCode =
      authCode === "weak_password" ? "PASSWORD_TOO_SHORT" : "SERVER_ERROR"
    return { ok: false, code }
  }

  const complete = await callRpc(supabase, "reset_complete", args)
  if (!complete.ok) {
    // The password already changed in Auth; the link stays pending (or was
    // consumed with this key), so submitting again completes it.
    console.error("reset.complete_failed", { tokenId, code: complete.code })
    return { ok: false, code: "SERVER_ERROR" }
  }

  // The email comes from the update response: no extra Admin API read (AD-4).
  return { ok: true, data: { email: updated.data.user?.email ?? null } }
}
