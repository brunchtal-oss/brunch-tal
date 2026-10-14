import "server-only"

import { randomUUID } from "node:crypto"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createServiceClient } from "@/lib/server/privileged/service-client"
import { createClient } from "@/lib/supabase/server"

// Tal changes a customer's email (story 2.8, AD-21), in three steps:
//   1. admin_begin_email_change (Tal's session: is_admin, find_identity,
//      email_change_pending + the address's hash);
//   2. Auth Admin updateUserById(email, email_confirm) with the service
//      role; the auth.users trigger accepts it only for that hash;
//   3. admin_finish_email_change (clears the state, logs the change).
// A failure between the steps leaves email_change_pending ("to handle"
// after 15 minutes); saving the same address again resumes at step 2
// (begin answers pending again). Logs carry only ids and codes, never the
// address (AD-22).

type BeginResult = { result: "pending"; user_id: string } | { result: "taken" }
// Auth codes that refuse the address itself (a 4xx no retry can fix).
const INVALID_ADDRESS_CODES = new Set([
  "email_address_invalid",
  "validation_failed",
])

type FinishResult = { result: "changed" | "taken" | "not_pending" }

export async function changeEmail(
  customerId: string,
  email: string,
  idempotencyKey: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const address = email.trim().toLowerCase()

  const begin = await callRpc(supabase, "admin_begin_email_change", {
    p_customer_id: customerId,
    p_email: address,
    p_idempotency_key: idempotencyKey,
  })
  if (!begin.ok) return begin
  const started = begin.data as BeginResult
  if (started.result === "taken") return { ok: false, code: "EMAIL_TAKEN" }
  if (started.result !== "pending") return { ok: false, code: "SERVER_ERROR" }

  let authError: { code?: string; status?: number } | null
  try {
    const updated = await createServiceClient().auth.admin.updateUserById(
      started.user_id,
      { email: address, email_confirm: true }
    )
    authError = updated.error
  } catch {
    authError = { code: "unknown" }
  }

  if (authError) {
    const authCode = authError.code ?? "unknown"
    if (authCode === "email_exists") {
      // Auth knows the address on another user: close the intent, logged
      // as blocked.
      const closed = await finish(customerId, false)
      if (!closed.ok) return closed
      return { ok: false, code: "EMAIL_TAKEN" }
    }
    if (INVALID_ADDRESS_CODES.has(authCode)) {
      // Auth refuses the address itself: a retry would fail the same way,
      // so the intent is closed instead of left stuck.
      const closed = await finish(customerId, false)
      if (!closed.ok) return closed
      return { ok: false, code: "INVALID_INPUT" }
    }
    console.error("account.email_update_failed", { customerId, authCode })
    return { ok: false, code: "SERVER_ERROR" }
  }

  const done = await finish(customerId, true)
  if (!done.ok) return done
  return { ok: true, data: undefined }
}

// Each finish call has its own key (one key per RPC call, AD-5); the RPC
// is safe to repeat: without a pending change it answers not_pending.
async function finish(
  customerId: string,
  succeeded: boolean
): Promise<ActionResult> {
  const supabase = await createClient()
  const result = await callRpc(supabase, "admin_finish_email_change", {
    p_customer_id: customerId,
    p_succeeded: succeeded,
    p_idempotency_key: randomUUID(),
  })
  if (!result.ok) {
    console.error("account.email_finish_failed", {
      customerId,
      code: result.code,
    })
    return { ok: false, code: "SERVER_ERROR" }
  }
  const { result: outcome } = result.data as FinishResult
  if (
    outcome === "changed" ||
    outcome === "not_pending" ||
    (outcome === "taken" && !succeeded)
  ) {
    return { ok: true, data: undefined }
  }
  return { ok: false, code: "SERVER_ERROR" }
}
