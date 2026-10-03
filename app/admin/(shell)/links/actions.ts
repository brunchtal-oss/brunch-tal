"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { joinLinkFor } from "@/lib/server/join-link"
import { deleteOrphanUser } from "@/lib/server/privileged/join"
import { createServiceClient } from "@/lib/server/privileged/service-client"
import { createClient } from "@/lib/supabase/server"

// Revoke and replace a join link (story 2.4). The RPCs run with the admin's
// own session (private.is_admin() inside, AD-4); the service role is used
// only afterwards, to delete the pending Auth user of a revoked claiming link
// that the RPC returned (it never has a profile). A failed deletion is only
// logged: the link is revoked either way. The idempotency key comes from the
// page (randomUUID on the server, AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RevokeResult = { revoked_pending_user_id?: string | null }
type IssueResult = {
  token?: string
  token_id: string
  link_expires_at: string
  revoked_pending_user_id?: string | null
}

async function deletePendingUser(
  userId: string | null | undefined,
  tokenId: string
): Promise<void> {
  if (!userId || !UUID.test(userId)) return
  await deleteOrphanUser(createServiceClient(), userId, tokenId)
}

export async function revokeLinkAction(input: {
  tokenId: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (!UUID.test(input.tokenId) || !UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_revoke_link", {
    p_token_id: input.tokenId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return { ok: false, code: result.code }
  const revoked = result.data as RevokeResult
  await deletePendingUser(revoked.revoked_pending_user_id, input.tokenId)
  return { ok: true, data: undefined }
}

// link is null only for a repeat with the same key (the raw token is
// returned once, AD-10) or when the site's address cannot be read.
export async function replaceLinkAction(input: {
  paymentId: string
  idempotencyKey: string
}): Promise<ActionResult<{ link: string | null; linkExpiresAt: string }>> {
  if (!UUID.test(input.paymentId) || !UUID.test(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_issue_link", {
    p_purpose: "join",
    p_target_id: input.paymentId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (!result.ok) return { ok: false, code: result.code }
  const issued = result.data as IssueResult
  await deletePendingUser(issued.revoked_pending_user_id, issued.token_id)
  return {
    ok: true,
    data: {
      link: issued.token ? await joinLinkFor(issued.token) : null,
      linkExpiresAt: issued.link_expires_at,
    },
  }
}
