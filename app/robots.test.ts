import { describe, expect, it } from "vitest"

import robots from "./robots"

describe("robots", () => {
  it("disallows every crawler on the whole site until the launch (story 5.15)", () => {
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] })
  })
})
