"use server"

import type { ActionResult } from "@/lib/errors"
import { validVersion } from "@/lib/form-values"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// The notification templates (story 4.7). The RPC runs with the admin's own
// session (private.is_admin() inside, AD-4), renders the title and body with
// the type's allowed fields (TEMPLATE_INVALID) and compares the version the
// screen read (STALE_VERSION); this action only checks the shape. The
// idempotency key comes from the screen (one per change, AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TYPE = /^[a-z_]{1,40}$/
// A generous cap on text sent to the RPC (it allows 200 / 1000).
const MAX_TEXT = 2000

// The generated Args type marks every parameter as non-null; the body of an
// override type is sent as null.
const NONE = null as unknown as string

export async function updateTemplateAction(input: {
  type: string
  title: string
  body: string | null
  expectedVersion: number
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    typeof input.type !== "string" ||
    !TYPE.test(input.type) ||
    typeof input.title !== "string" ||
    input.title.length > MAX_TEXT ||
    (input.body !== null &&
      (typeof input.body !== "string" || input.body.length > MAX_TEXT)) ||
    !validVersion(input.expectedVersion) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "admin_update_notification_template",
    {
      p_type: input.type,
      p_title: input.title,
      p_body: input.body ?? NONE,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (!result.ok) return result
  return { ok: true, data: undefined }
}
