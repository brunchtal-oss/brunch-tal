import { describe, expect, it } from "vitest"

import { isEmailShape, MAX_EMAIL_LENGTH } from "./email"

describe("isEmailShape", () => {
  it.each(["a@example.com", "dev.customer+x@mail.example.co.il"])(
    "accepts %s",
    (value) => {
      expect(isEmailShape(value)).toBe(true)
    }
  )

  it.each([
    "",
    "no-at-sign",
    "a@b",
    "a@b.",
    "a@.b",
    "a@b..c",
    "a b@c.d",
    "a@b@c.d",
  ])("rejects %j", (value) => {
    expect(isEmailShape(value)).toBe(false)
  })

  it("accepts 254 characters and rejects 255", () => {
    const at = (length: number) =>
      `${"a".repeat(length - "@example.com".length)}@example.com`
    expect(isEmailShape(at(MAX_EMAIL_LENGTH))).toBe(true)
    expect(isEmailShape(at(MAX_EMAIL_LENGTH + 1))).toBe(false)
  })

  it("answers a crafted input at once", () => {
    const crafted = [
      `a@${".".repeat(100_000)}@`,
      `a@${"b.".repeat(50_000)}`,
      `a@${"b".repeat(100_000)}`,
    ]
    for (const value of crafted) {
      const started = performance.now()
      expect(isEmailShape(value)).toBe(false)
      // Below the cap too: the regex itself is linear.
      expect(isEmailShape(value.slice(0, MAX_EMAIL_LENGTH))).toBe(false)
      expect(performance.now() - started).toBeLessThan(1000)
    }
  })
})
