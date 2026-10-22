import "server-only"

import { randomUUID } from "node:crypto"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { deleteOrphanUser } from "@/lib/server/privileged/join"
import { createServiceClient } from "@/lib/server/privileged/service-client"
import { createClient } from "@/lib/supabase/server"

// Tal removes a customer's personal details on her request (story 4.6,
// CAP-30, AD-21), in three steps:
//   1. admin_anonymize_customer (Tal's session: is_admin, the blockers again,
//      cleans every identifying value, anonymization_pending);
//   2. Auth Admin deleteUser with the service role (404 / user_not_found:
//      deleted already);
//   3. admin_finish_anonymize_customer (closes the state).
// A failure between the steps leaves anonymization_pending ("to handle"
// after 15 minutes); the card's "complete the removal" runs this again:
// step 1 answers pending without cleaning again. Logs carry only ids and
// codes (AD-22).
//
// Story 5.20: step 1 also revokes her claiming join links and returns their
// pending Auth users (orphan_user_ids, never with a profile); they are
// deleted here as for a revoked link (deleteOrphanUser). A failed deletion
// is only logged: the removal goes on.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type BeginResult = {
  result: "pending" | "done"
  user_id?: string
  orphan_user_ids?: unknown
}

function orphanIds(value: unknown, customerId: string): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (id): id is string =>
      typeof id === "string" && UUID.test(id) && id !== customerId
  )
}
type FinishResult = { result: "done" | "not_pending" }

export async function anonymizeCustomer(
  customerId: string,
  idempotencyKey: string
): Promise<ActionResult> {
  const supabase = await createClient()

  const begin = await callRpc(supabase, "admin_anonymize_customer", {
    p_customer_id: customerId,
    p_confirmed: true,
    p_idempotency_key: idempotencyKey,
  })
  if (!begin.ok) return begin
  const started = begin.data as BeginResult
  if (started.result === "done") return { ok: true, data: undefined }
  if (started.result !== "pending") return { ok: false, code: "SERVER_ERROR" }

  // Step 1 has committed: a failure here is only logged.
  const orphans = orphanIds(started.orphan_user_ids, customerId)
  if (orphans.length > 0) {
    try {
      const service = createServiceClient()
      for (const userId of orphans) {
        await deleteOrphanUser(service, userId, null)
      }
    } catch {
      console.error("anonymize.delete_orphan_failed", { customerId })
    }
  }

  let authCode: string | null = null
  try {
    const { error } =
      await createServiceClient().auth.admin.deleteUser(customerId)
    if (error && error.status !== 404 && error.code !== "user_not_found") {
      authCode = error.code ?? "unknown"
    }
  } catch {
    authCode = "exception"
  }
  if (authCode) {
    console.error("anonymize.delete_user_failed", { customerId, authCode })
    return { ok: false, code: "SERVER_ERROR" }
  }

  // Its own key (one key per RPC call, AD-5); safe to repeat.
  const finish = await callRpc(supabase, "admin_finish_anonymize_customer", {
    p_customer_id: customerId,
    p_idempotency_key: randomUUID(),
  })
  if (!finish.ok) {
    console.error("anonymize.finish_failed", { customerId, code: finish.code })
    return { ok: false, code: "SERVER_ERROR" }
  }
  const { result } = finish.data as FinishResult
  if (result !== "done" && result !== "not_pending") {
    return { ok: false, code: "SERVER_ERROR" }
  }
  return { ok: true, data: undefined }
}
