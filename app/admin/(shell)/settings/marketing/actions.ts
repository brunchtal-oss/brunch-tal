"use server"

import type { ActionResult } from "@/lib/errors"
import { validVersion } from "@/lib/form-values"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// The marketing reminders screen (story 5.11). The RPCs run with the
// admin's own session (private.is_admin() inside, AD-4) and check every
// value again (the schedule's days and times, the text's length, the
// version the screen read: STALE_VERSION); these actions only check the
// shape. The idempotency key comes from the screen (AD-5).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A generous cap on text sent to the RPC (it allows 500 after trimming).
const MAX_RAW_INPUT = 2000

function validSchedule(
  schedule: unknown
): schedule is { weekday: number; time: string }[] {
  return (
    Array.isArray(schedule) &&
    schedule.length <= 7 &&
    schedule.every(
      (slot) =>
        typeof slot === "object" &&
        slot !== null &&
        Object.keys(slot).length === 2 &&
        Number.isInteger(slot.weekday) &&
        typeof slot.time === "string" &&
        slot.time.length <= 5
    )
  )
}

export async function updateScheduleAction(input: {
  schedule: { weekday: number; time: string }[]
  expectedVersion: number
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    !validSchedule(input.schedule) ||
    !validVersion(input.expectedVersion) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "admin_update_business_settings",
    {
      p_changes: {
        marketing_reminder_schedule: input.schedule.map((slot) => ({
          weekday: slot.weekday,
          time: slot.time,
        })),
      },
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

export async function addTextAction(input: {
  body: string
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    typeof input.body !== "string" ||
    input.body.length > MAX_RAW_INPUT ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "admin_add_marketing_reminder_text",
    { p_body: input.body, p_idempotency_key: input.idempotencyKey }
  )
  if (!result.ok) return result
  return { ok: true, data: undefined }
}

export async function updateTextAction(input: {
  textId: string
  body: string
  active: boolean
  expectedVersion: number
  idempotencyKey: string
}): Promise<ActionResult> {
  if (
    typeof input.textId !== "string" ||
    !UUID.test(input.textId) ||
    typeof input.body !== "string" ||
    input.body.length > MAX_RAW_INPUT ||
    typeof input.active !== "boolean" ||
    !validVersion(input.expectedVersion) ||
    !UUID.test(input.idempotencyKey)
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(
    await createClient(),
    "admin_update_marketing_reminder_text",
    {
      p_text_id: input.textId,
      p_body: input.body,
      p_active: input.active,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
    }
  )
  if (!result.ok) return result
  return { ok: true, data: undefined }
}
