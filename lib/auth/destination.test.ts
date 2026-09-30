import { describe, expect, it } from "vitest"

import {
  destinationFor,
  loginPageOutcome,
  loginPathFor,
  toSessionRole,
} from "./destination"

describe("destinationFor", () => {
  it.each([
    [undefined, "/admin"],
    ["/admin", "/admin"],
    ["/admin/more", "/admin/more"],
    ["/admin/more?x=1#y", "/admin/more?x=1#y"],
    ["/admin/login", "/admin"],
    ["/admin/login?next=%2Fadmin", "/admin"],
    ["/admin/login/x", "/admin"],
    ["/administration", "/admin"],
    ["/me", "/admin"],
    ["/", "/admin"],
    ["//evil.com", "/admin"],
    ["https://evil.com/admin", "/admin"],
  ])("admin with next %j goes to %s", (next, expected) => {
    expect(destinationFor("admin", next)).toBe(expected)
  })

  it.each([
    [undefined, "/me"],
    ["/me", "/me"],
    ["/me/bookings?tab=credits", "/me/bookings?tab=credits"],
    ["/", "/"],
    ["/admin", "/me"],
    ["/admin/more", "/me"],
    ["/admin/login", "/me"],
    ["/admin?x=1", "/me"],
    ["/administration", "/administration"],
    ["//evil.com", "/me"],
    ["/..//evil.com", "/me"],
  ])("customer with next %j goes to %s", (next, expected) => {
    expect(destinationFor("customer", next)).toBe(expected)
  })

  it("has no destination for none", () => {
    expect(destinationFor("none", "/me")).toBeNull()
    expect(destinationFor("none", undefined)).toBeNull()
  })
})

describe("toSessionRole", () => {
  it.each([
    ["admin", "admin"],
    ["customer", "customer"],
    ["none", "none"],
    ["owner", "none"],
    [null, "none"],
  ])("%j -> %s", (input, expected) => {
    expect(toSessionRole(input)).toBe(expected)
  })
})

describe("loginPageOutcome", () => {
  it.each([
    ["customer", null, undefined, null, null],
    ["admin", null, undefined, null, null],
    ["customer", "customer", undefined, "/me", null],
    ["customer", "admin", "/me", "/admin", null],
    ["admin", "admin", "/admin/more", "/admin/more", null],
    ["admin", "customer", "/admin", null, "customer"],
    ["customer", "none", "/me", null, "none"],
    ["admin", "none", "/admin", null, "none"],
  ] as const)(
    "%s page, role %s, next %j -> redirect %j, notice %j",
    (area, role, next, redirect, notice) => {
      expect(loginPageOutcome(area, role, next)).toEqual({ redirect, notice })
    }
  )
})

describe("loginPathFor", () => {
  it.each([
    ["/me", "/login"],
    ["/me/x", "/login"],
    ["/admin", "/admin/login"],
    ["/admin/more", "/admin/login"],
    ["/administration", "/login"],
  ])("%s -> %s", (path, expected) => {
    expect(loginPathFor(path)).toBe(expected)
  })
})
