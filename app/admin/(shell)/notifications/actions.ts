"use server"

import type { ActionResult } from "@/lib/errors"
import {
  loadUnreadCount,
  markNotificationsRead,
  markNotificationsUnread,
} from "@/lib/notifications/load"

// The admin notification center and bell (story 5.7). Shape only here;
// the RPCs check who calls and touch only her own rows.

export async function markRead(
  ids: string[] | null
): Promise<ActionResult<{ marked: number }>> {
  return markNotificationsRead(ids)
}

export async function markUnread(
  ids: string[]
): Promise<ActionResult<{ marked: number }>> {
  return markNotificationsUnread(ids)
}

// The bell's refresh (route change, back to the app). A failed read is an
// error, so the bell keeps its last count.
export async function getUnreadCount(): Promise<ActionResult<number>> {
  const count = await loadUnreadCount("admin")
  if (count === null) return { ok: false, code: "SERVER_ERROR" }
  return { ok: true, data: count }
}
