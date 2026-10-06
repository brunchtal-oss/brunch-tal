import { describe, expect, it } from "vitest"

import { shellCopy } from "@/lib/copy/shell"

import {
  bellLabel,
  formatUnreadCount,
  notificationsHref,
  parseNotificationIds,
  safeNotificationTarget,
} from "./shared"

const copy = shellCopy.notifications
const ID = "8f2b2c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f"

describe("safeNotificationTarget", () => {
  it.each([
    ["customer", "/me", "/me"],
    ["customer", "/me/bookings", "/me/bookings"],
    ["customer", "/me/sessions/x?y=1", "/me/sessions/x?y=1"],
    ["customer", "/me?x=1", "/me?x=1"],
    ["customer", "/admin", "/me"],
    ["customer", "/media", "/me"],
    ["customer", "//evil.com/me", "/me"],
    ["customer", "/me//evil.com", "/me"],
    ["customer", "https://evil.com/me", "/me"],
    ["customer", "/me/a b", "/me"],
    ["customer", String.raw`/me\x`, "/me"],
    ["customer", null, "/me"],
    ["admin", "/admin/links", "/admin/links"],
    ["admin", "/me", "/admin"],
    ["admin", "/administration", "/admin"],
  ] as const)("%s %j -> %s", (surface, target, expected) => {
    expect(safeNotificationTarget(surface, target)).toBe(expected)
  })
})

describe("the bell", () => {
  it("shows 99+ above 99", () => {
    expect(formatUnreadCount(1)).toBe("1")
    expect(formatUnreadCount(99)).toBe("99")
    expect(formatUnreadCount(100)).toBe("99+")
  })

  it("names the unread count", () => {
    expect(bellLabel(0)).toBe(copy.bell)
    expect(bellLabel(3)).toBe(copy.bellUnread("3"))
    expect(bellLabel(250)).toBe(copy.bellUnread("99+"))
  })

  it("links to the surface's center", () => {
    expect(notificationsHref("customer")).toBe("/me/notifications")
    expect(notificationsHref("admin")).toBe("/admin/notifications")
  })
})

describe("parseNotificationIds", () => {
  it("accepts 1 to 200 uuids only", () => {
    expect(parseNotificationIds([ID])).toEqual([ID])
    expect(parseNotificationIds(Array(200).fill(ID))).toHaveLength(200)
    expect(parseNotificationIds(Array(201).fill(ID))).toBeNull()
    expect(parseNotificationIds([])).toBeNull()
    expect(parseNotificationIds(null)).toBeNull()
    expect(parseNotificationIds(["x"])).toBeNull()
    expect(parseNotificationIds(ID)).toBeNull()
  })
})
