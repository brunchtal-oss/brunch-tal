import { describe, expect, it } from "vitest"

import { resetView } from "./reset-view"

describe("resetView", () => {
  it.each([
    ["active", "form"],
    ["used", "used"],
    ["expired", "expired"],
  ] as const)(
    "shows %s link as %s before any submit",
    (linkState, expected) => {
      expect(resetView(null, linkState)).toBe(expected)
    }
  )

  it("keeps the saved screen after the refresh reports the link as used", () => {
    expect(resetView({ ok: true, data: { signedIn: true } }, "used")).toBe(
      "saved-signed-in"
    )
  })

  it("shows the login variant when the sign-in after saving failed", () => {
    expect(resetView({ ok: true, data: { signedIn: false } }, "active")).toBe(
      "saved-login"
    )
    expect(resetView({ ok: true, data: { signedIn: false } }, "used")).toBe(
      "saved-login"
    )
  })

  it("maps LINK_USED and LINK_EXPIRED results to their notices", () => {
    expect(resetView({ ok: false, code: "LINK_USED" }, "active")).toBe("used")
    expect(resetView({ ok: false, code: "LINK_EXPIRED" }, "active")).toBe(
      "expired"
    )
  })

  it("keeps the form for field and server errors", () => {
    expect(
      resetView(
        { ok: false, code: "PASSWORD_TOO_SHORT", field: "password" },
        "active"
      )
    ).toBe("form")
    expect(resetView({ ok: false, code: "SERVER_ERROR" }, "active")).toBe(
      "form"
    )
  })
})
