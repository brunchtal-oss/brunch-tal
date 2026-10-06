import { shellCopy } from "@/lib/copy/shell"

// Pure helpers of the notification centers (story 5.7), shared by the server
// loader and the client components.

// The surface: a customer's /me or an admin's /admin (recipient_kind).
export type NotificationSurface = "customer" | "admin"

export type NotificationView = {
  id: string
  title: string
  body: string
  targetPath: string
  createdAt: string
  read: boolean
}

// The most a center shows, newest first.
export const NOTIFICATION_LIST_LIMIT = 100

// The RPCs refuse more ids than this in one call.
export const MARK_IDS_LIMIT = 200

export function surfaceHome(surface: NotificationSurface): "/me" | "/admin" {
  return surface === "admin" ? "/admin" : "/me"
}

export function notificationsHref(surface: NotificationSurface): string {
  return `${surfaceHome(surface)}/notifications`
}

/**
 * Where a notification leads: its target_path only when it is inside the
 * surface (the database check already demands it), else the surface's home.
 * Never another origin ("//x"), never a path with spaces or a backslash.
 */
export function safeNotificationTarget(
  surface: NotificationSurface,
  targetPath: unknown
): string {
  const home = surfaceHome(surface)
  if (typeof targetPath !== "string") return home
  const inside = new RegExp(`^${home}(/|\\?|$)`).test(targetPath)
  if (
    !inside ||
    targetPath.length > 500 ||
    targetPath.includes("//") ||
    /[\s\\]/.test(targetPath)
  ) {
    return home
  }
  return targetPath
}

/** The count on the bell: "1".."99", or "99+" above. */
export function formatUnreadCount(count: number): string {
  return count > 99 ? shellCopy.notifications.overflow : String(count)
}

/** The bell's accessible name, with the unread count when there is one. */
export function bellLabel(count: number): string {
  return count > 0
    ? shellCopy.notifications.bellUnread(formatUnreadCount(count))
    : shellCopy.notifications.bell
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A list of 1..MARK_IDS_LIMIT uuids, or null when the shape is wrong. */
export function parseNotificationIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MARK_IDS_LIMIT ||
    !value.every((id) => typeof id === "string" && UUID.test(id))
  ) {
    return null
  }
  return value as string[]
}
