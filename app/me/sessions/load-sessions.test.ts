import { describe, expect, it } from "vitest"

import { SESSION_COLUMNS, toCustomerSession } from "./load-sessions"

const ROW = {
  id: "6f1c2a52-6b7e-4c0e-9a51-3c1e5d0b2a11",
  kind: "regular",
  status: "published",
  description: "session text",
  starts_at: "2026-12-15T08:00:00+00:00",
  display_price_agorot: null,
  concepts: { name: "concept", description: "concept text" },
}

// The customer's session page shows the session's description, else the
// concept's (user's decision 2026-10-05).
describe("toCustomerSession", () => {
  it("reads the concept's description too", () => {
    expect(SESSION_COLUMNS).toContain("concepts(name, description)")
  })

  it("keeps the session's description over the concept's", () => {
    expect(toCustomerSession(ROW).description).toBe("session text")
  })

  it("falls back to the concept's description", () => {
    expect(toCustomerSession({ ...ROW, description: null }).description).toBe(
      "concept text"
    )
    expect(toCustomerSession({ ...ROW, description: " " }).description).toBe(
      "concept text"
    )
  })

  it("has no description when neither has text", () => {
    expect(
      toCustomerSession({
        ...ROW,
        description: null,
        concepts: { name: "concept", description: null },
      }).description
    ).toBeNull()
  })
})
