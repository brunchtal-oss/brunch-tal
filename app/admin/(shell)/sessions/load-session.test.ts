import { describe, expect, it } from "vitest"

import { isReadOnlySession, sessionsListFilter } from "./load-session"

describe("sessionsListFilter", () => {
  it("lists every draft and the published sessions that have not ended", () => {
    expect(sessionsListFilter("2026-10-05T07:00:00.000Z")).toBe(
      "status.eq.draft,and(status.eq.published,ends_at.gt.2026-10-05T07:00:00.000Z)"
    )
  })
})

describe("isReadOnlySession", () => {
  const now = new Date("2026-10-05T10:00:00Z")

  it.each([
    ["draft", "2026-10-06T10:00:00Z", false],
    ["published", "2026-10-06T10:00:00Z", false],
    // Started and not ended yet: Tal still books a walk-in.
    ["published", "2026-10-05T10:00:01Z", false],
    ["published", "2026-10-05T10:00:00Z", true],
    ["published", "2026-10-04T10:00:00Z", true],
    ["draft", "2026-10-04T10:00:00Z", true],
    ["cancelled", "2026-10-06T10:00:00Z", true],
    ["completed", "2026-10-06T10:00:00Z", true],
  ] as const)("%s ending %s -> %s", (status, ends_at, expected) => {
    expect(isReadOnlySession({ status, ends_at }, now)).toBe(expected)
  })
})
