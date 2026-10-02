import { describe, expect, it } from "vitest"

import { joinCopy } from "@/lib/copy/join"

import type { JoinFormState } from "./actions"

import {
  claimLoginHref,
  conflictMessage,
  existingAccountScreen,
  joinView,
  nextIdempotencyKey,
  splitContact,
} from "./join-view"

describe("joinView", () => {
  it.each([
    ["active", "form"],
    ["used", "used"],
    ["expired", "expired"],
    ["conflict", "conflict"],
  ] as const)("shows a %s link as %s before any submit", (link, expected) => {
    expect(joinView(null, link)).toBe(expected)
  })

  it.each([
    [{ status: "joined" }, "joined"],
    [{ status: "used" }, "used"],
    [{ status: "expired" }, "expired"],
    [{ status: "conflict", reason: null }, "conflict"],
  ] as const)("lets the result %j win over an active link", (state, view) => {
    expect(joinView(state, "active")).toBe(view)
  })

  it("keeps the form for field and server errors", () => {
    expect(
      joinView({ status: "error", code: "INVALID_INPUT", errors: [] }, "active")
    ).toBe("form")
  })
})

describe("existingAccountScreen", () => {
  it.each([
    [null, false, "login"],
    [null, true, "login"],
    ["customer", true, "claim"],
    ["customer", false, "other_account"],
    ["admin", true, "other_account"],
    ["admin", false, "other_account"],
    ["none", true, "other_account"],
    ["none", false, "other_account"],
  ] as const)(
    "shows role %s (bound account: %s) the %s screen",
    (role, bound, screen) => {
      expect(existingAccountScreen(role, bound)).toBe(screen)
    }
  )

  it("builds the login link with the encoded join path", () => {
    expect(claimLoginHref("abc")).toBe("/login?next=%2Fjoin%2Fabc")
  })
})

describe("conflictMessage", () => {
  it.each([
    ["two_accounts", joinCopy.conflicts.two_accounts],
    ["not_activated", joinCopy.conflicts.not_activated],
    ["phone_taken", joinCopy.conflicts.phone_taken],
    ["email_exists", joinCopy.conflicts.phone_taken],
    ["bind_conflict", joinCopy.conflicts.bind_conflict],
    [null, joinCopy.conflicts.bind_conflict],
  ] as const)("words %s", (reason, text) => {
    expect(conflictMessage(reason)).toBe(text)
  })

  it("ends every reason's wording with the contact phrase", () => {
    for (const text of [
      ...Object.values(joinCopy.conflicts),
      joinCopy.identityRetry,
    ]) {
      expect(splitContact(text)).not.toBeNull()
    }
  })
})

describe("splitContact", () => {
  it("cuts a message around the contact phrase, keeping a trailing period", () => {
    expect(splitContact(joinCopy.conflicts.not_activated)).toEqual({
      before: joinCopy.conflicts.not_activated.slice(
        0,
        joinCopy.conflicts.not_activated.indexOf(joinCopy.contactPhrase)
      ),
      phrase: joinCopy.contactPhrase,
      after: ".",
    })
  })

  it("is null without the phrase", () => {
    expect(splitContact(joinCopy.used)).toBeNull()
  })
})

describe("nextIdempotencyKey", () => {
  const KEY = "22222222-2222-4222-8222-222222222222"
  const NEW = "33333333-3333-4333-8333-333333333333"

  it("takes the new key of identity_retry", () => {
    expect(
      nextIdempotencyKey({ status: "identity_retry", idempotencyKey: NEW }, KEY)
    ).toBe(NEW)
  })

  it.each<JoinFormState>([
    null,
    { status: "error", code: "INVALID_INPUT", errors: [] },
    { status: "conflict", reason: "two_accounts" },
  ])("keeps the current key for %j", (state) => {
    expect(nextIdempotencyKey(state, KEY)).toBe(KEY)
  })
})
