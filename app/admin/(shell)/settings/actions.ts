"use server"

import type { ActionResult } from "@/lib/errors"
import { validVersion } from "@/lib/form-values"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// The business settings (story 4.7). The RPC runs with the admin's own
// session (private.is_admin() inside, AD-4), checks every value again and
// compares the version the screen read (STALE_VERSION); this action only
// checks the shape. The idempotency key comes from the screen (one per
// change, AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The keys admin_update_business_settings accepts.
const SETTING_KEYS = new Set([
  "default_validity_days",
  "registration_close_days_before",
  "registration_close_local_time",
  "default_capacity_regular",
  "default_capacity_couple",
  "cancel_window_hours",
  "credit_options_count",
  "reminder_lead_hours",
  "admin_expiring_days",
  "customer_expiring_days",
  "last_places_threshold",
  "default_prep_days",
  "inactivity_months",
  "duplicate_payment_window_days",
  "default_session_start_time",
  "default_session_end_time",
])

function validChanges(changes: unknown): changes is Record<string, unknown> {
  if (typeof changes !== "object" || changes === null || Array.isArray(changes))
    return false
  const keys = Object.keys(changes)
  return keys.length > 0 && keys.every((key) => SETTING_KEYS.has(key))
}

export async function updateSettingsAction(input: {
  changes: Record<string, number | string | number[]>
  expectedVersion: number
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !validChanges(input.changes) ||
    !validVersion(input.expectedVersion) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "admin_update_business_settings",
    {
      p_changes: input.changes,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (!result.ok) return result
  return { ok: true, data: undefined }
}
