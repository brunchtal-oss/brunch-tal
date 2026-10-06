import "server-only"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { parseWorkSheet, type WorkSheet } from "./work-sheet-data"

// The work sheet of a session (story 4.9): one call to admin_get_work_sheet
// (admin only, a definer read that also makes the sheet on its first read).
// Never 'use cache': the sheet is personal data (AD-16).

// null: no such session (NOT_FOUND).
export async function loadWorkSheet(
  eventId: string
): Promise<WorkSheet | null> {
  const result = await callRpc(await createClient(), "admin_get_work_sheet", {
    p_event_id: eventId,
  })
  if (!result.ok) {
    if (result.code === "NOT_FOUND") return null
    throw new Error("work sheet failed")
  }
  return parseWorkSheet(result.data)
}
