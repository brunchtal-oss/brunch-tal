import "server-only"

import { randomUUID } from "node:crypto"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { checkPassword } from "@/lib/server/privileged/email-auth"
import { createServiceClient } from "@/lib/server/privileged/service-client"
import { createClient } from "@/lib/supabase/server"

// An email change (story 2.8, AD-21), in three steps:
//   1. a begin RPC (Tal's: with her own session, is_admin inside; the
//      customer's own, story 6.11: service role with her user id, called
//      only after the server checked her password), find_identity,
//      email_change_pending + the address's hash;
//   2. Auth Admin updateUserById(email, email_confirm) with the service
//      role; the auth.users trigger accepts it only for that hash;
//   3. a finish RPC (clears the state, logs the change).
// A failure between the steps leaves email_change_pending ("to handle"
// after 15 minutes); saving the same address again resumes at step 2
// (begin answers pending again). Logs carry only ids and codes, never the
// address (AD-22). The changed address is un-verified by itself (story
// 6.11: the verification record holds the old address's hash); the caller
// sends the new verification email.

type BeginResult = { result: "pending"; user_id: string } | { result: "taken" }
// Auth codes that refuse the address itself (a 4xx no retry can fix).
const INVALID_ADDRESS_CODES = new Set([
  "email_address_invalid",
  "validation_failed",
])

type FinishResult = { result: "changed" | "taken" | "not_pending" }

// The two RPCs of one side (Tal's or the customer's own), each with its
// own client.
type Steps = {
  begin: (address: string) => Promise<ActionResult<unknown>>
  finish: (succeeded: boolean) => Promise<ActionResult<unknown>>
  // The id in the logs.
  logId: string
}

export async function changeEmail(
  customerId: string,
  email: string,
  idempotencyKey: string
): Promise<ActionResult> {
  return runEmailChange(email, {
    begin: async (address) =>
      callRpc(await createClient(), "admin_begin_email_change", {
        p_customer_id: customerId,
        p_email: address,
        p_idempotency_key: idempotencyKey,
      }),
    finish: async (succeeded) =>
      callRpc(await createClient(), "admin_finish_email_change", {
        p_customer_id: customerId,
        p_succeeded: succeeded,
        p_idempotency_key: randomUUID(),
      }),
    logId: customerId,
  })
}

// The customer changes her own email (story 6.11, user decision
// 2026-11-11). Her current password is checked first on a stateless client
// (her session stays as it is), against her current address as Auth holds
// it; only then the same pipeline with begin_my_email_change /
// finish_my_email_change, which are service_role and take her user id (a
// held session alone can never begin a change). The caller refreshes her
// session afterwards so the new address reaches its claims.
// afterPasswordCheck (the profile form's details, user decision
// 2026-11-12): runs only after the password passed and before the change
// begins; its failure stops here, its result passed back marked
// { stage: "details" }.
export async function changeOwnEmail(
  input: {
    userId: string
    currentEmail: string
    email: string
    password: string
  },
  idempotencyKey: string,
  afterPasswordCheck?: () => Promise<ActionResult>
): Promise<ActionResult & { stage?: "details" }> {
  const check = await checkPassword(input.currentEmail, input.password)
  if (check === "wrong") return { ok: false, code: "WRONG_PASSWORD" }
  if (check === "limited") return { ok: false, code: "TOO_MANY_ATTEMPTS" }
  if (check !== "ok") return { ok: false, code: "SERVER_ERROR" }

  if (afterPasswordCheck) {
    const before = await afterPasswordCheck()
    if (!before.ok) return { ...before, stage: "details" }
  }

  return runEmailChange(input.email, {
    begin: (address) =>
      callRpc(createServiceClient(), "begin_my_email_change", {
        p_user_id: input.userId,
        p_email: address,
        p_idempotency_key: idempotencyKey,
      }),
    finish: (succeeded) =>
      callRpc(createServiceClient(), "finish_my_email_change", {
        p_user_id: input.userId,
        p_succeeded: succeeded,
        p_idempotency_key: randomUUID(),
      }),
    logId: input.userId,
  })
}

async function runEmailChange(
  email: string,
  steps: Steps
): Promise<ActionResult> {
  const address = email.trim().toLowerCase()

  const begin = await steps.begin(address)
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
      const closed = await finish(steps, false)
      if (!closed.ok) return closed
      return { ok: false, code: "EMAIL_TAKEN" }
    }
    if (INVALID_ADDRESS_CODES.has(authCode)) {
      // Auth refuses the address itself: a retry would fail the same way,
      // so the intent is closed instead of left stuck.
      const closed = await finish(steps, false)
      if (!closed.ok) return closed
      return { ok: false, code: "INVALID_INPUT" }
    }
    console.error("account.email_update_failed", {
      customerId: steps.logId,
      authCode,
    })
    return { ok: false, code: "SERVER_ERROR" }
  }

  const done = await finish(steps, true)
  if (!done.ok) return done
  return { ok: true, data: undefined }
}

// Each finish call has its own key (one key per RPC call, AD-5); the RPC
// is safe to repeat: without a pending change it answers not_pending.
async function finish(steps: Steps, succeeded: boolean): Promise<ActionResult> {
  const result = await steps.finish(succeeded)
  if (!result.ok) {
    console.error("account.email_finish_failed", {
      customerId: steps.logId,
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
