import "server-only"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import {
  NOTIFICATION_LIST_LIMIT,
  parseNotificationIds,
  type NotificationSurface,
  type NotificationView,
} from "./shared"

// The notification centers (story 5.7). Reads go straight to notifications
// with the session's client: RLS keeps every recipient to her own rows
// (recipient_id = auth.uid()), and each surface also filters by its
// recipient_kind, so an admin who is also a customer sees each list in its
// own surface. Writes go only through mark_notifications_read /
// mark_notifications_unread.

function toView(row: {
  id: string
  payload: unknown
  target_path: string
  created_at: string
  read_at: string | null
}): NotificationView {
  const payload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {}
  return {
    id: row.id,
    title: typeof payload.title === "string" ? payload.title : "",
    body: typeof payload.body === "string" ? payload.body : "",
    targetPath: row.target_path,
    createdAt: row.created_at,
    read: row.read_at !== null,
  }
}

/** The latest notifications of the signed-in recipient, newest first. */
export async function loadNotifications(
  surface: NotificationSurface
): Promise<NotificationView[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("notifications")
    .select("id, payload, target_path, created_at, read_at")
    .eq("recipient_kind", surface)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(NOTIFICATION_LIST_LIMIT)
  if (error) throw new Error("notifications.load_failed")
  return (data ?? []).map(toView)
}

/**
 * How many of her notifications are unread; null when it cannot be read (the
 * bell then keeps what it shows instead of hiding its count).
 */
export async function loadUnreadCount(
  surface: NotificationSurface
): Promise<number | null> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_kind", surface)
    .is("read_at", null)
  if (error) {
    console.error("notifications.count_failed", { dbCode: error.code })
    return null
  }
  return count ?? 0
}

function markedOf(data: unknown): number {
  const marked =
    data && typeof data === "object"
      ? (data as Record<string, unknown>).marked
      : undefined
  return typeof marked === "number" ? marked : 0
}

/**
 * Marks her notifications as read: the given ids, or all of them (null).
 * Shape only here; mark_notifications_read checks who calls and skips rows
 * that are not hers.
 */
export async function markNotificationsRead(
  ids: unknown
): Promise<ActionResult<{ marked: number }>> {
  const parsed = ids === null ? null : parseNotificationIds(ids)
  if (ids !== null && parsed === null) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const supabase = await createClient()
  const result = await callRpc(
    supabase,
    "mark_notifications_read",
    parsed === null ? {} : { p_ids: parsed }
  )
  if (!result.ok) return result
  return { ok: true, data: { marked: markedOf(result.data) } }
}

/** Marks the given notifications of hers as unread again. */
export async function markNotificationsUnread(
  ids: unknown
): Promise<ActionResult<{ marked: number }>> {
  const parsed = parseNotificationIds(ids)
  if (parsed === null) return { ok: false, code: "INVALID_INPUT" }
  const supabase = await createClient()
  const result = await callRpc(supabase, "mark_notifications_unread", {
    p_ids: parsed,
  })
  if (!result.ok) return result
  return { ok: true, data: { marked: markedOf(result.data) } }
}
