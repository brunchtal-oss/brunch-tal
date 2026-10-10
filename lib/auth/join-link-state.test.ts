import { describe, expect, it } from "vitest"

import { CONFLICT_REASONS, toConflictReason } from "./join-link-state"

describe("toConflictReason", () => {
  it.each(CONFLICT_REASONS)("keeps %s", (reason) => {
    expect(toConflictReason(reason)).toBe(reason)
  })

  it("is null for an unknown value", () => {
    for (const value of [
      "email_exists",
      "TWO_ACCOUNTS",
      "",
      null,
      undefined,
      1,
      {},
    ]) {
      expect(toConflictReason(value)).toBeNull()
    }
  })
})
