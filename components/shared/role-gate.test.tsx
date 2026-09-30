import { beforeEach, describe, expect, it, vi } from "vitest"

import { RoleGate } from "./role-gate"

const requireRole = vi.fn(async () => {})
let requestPath: string | null = null

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(requestPath ? { "x-request-path": requestPath } : {}),
}))
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: (...args: unknown[]) => requireRole(...(args as [])),
}))

beforeEach(() => {
  requireRole.mockClear()
})

describe("RoleGate", () => {
  it.each([
    ["admin", "/admin/more", "/admin/more"],
    ["admin", "/admin?x=1", "/admin?x=1"],
    ["admin", null, "/admin"],
    ["admin", "/me", "/admin"],
    ["admin", "//evil.com", "/admin"],
    ["customer", "/me/bookings", "/me/bookings"],
    ["customer", null, "/me"],
    ["customer", "/admin", "/me"],
    ["customer", "//evil.com", "/me"],
  ] as const)(
    "%s with request path %j checks next %s",
    async (role, path, expected) => {
      requestPath = path
      const children = "content"
      await expect(RoleGate({ role, children })).resolves.toBe(children)
      expect(requireRole).toHaveBeenCalledWith(role, expected)
    }
  )
})
