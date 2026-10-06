import { describe, expect, it } from "vitest"

import { blockedAction, parsePreview } from "./booking-preview"

describe("parsePreview", () => {
  it("a bookable session", () => {
    expect(
      parsePreview({
        ok: true,
        booked: false,
        product_name: "כרטיסייה אישית",
        units: 1,
        available_after: 3,
        expires_on: "2026-11-22",
        cancel_deadline: "2026-10-10T07:00:00+00:00",
      })
    ).toEqual({
      kind: "bookable",
      productName: "כרטיסייה אישית",
      availableAfter: 3,
      expiresOn: "2026-11-22",
      cancelDeadline: "2026-10-10T07:00:00+00:00",
    })
  })

  it("her own booking wins over the code", () => {
    expect(
      parsePreview({
        ok: false,
        code: "REGISTRATION_CLOSED",
        booked: true,
        booking_id: "b1",
        funding: "pinned",
        product_name: "Single",
        options_count: 2,
        cancel_deadline: "2026-10-10T07:00:00+00:00",
        can_self_cancel: false,
      })
    ).toEqual({
      kind: "booked",
      bookingId: "b1",
      funding: "pinned",
      productName: "Single",
      optionsCount: 2,
      cancelDeadline: "2026-10-10T07:00:00+00:00",
      canSelfCancel: false,
    })
  })

  it("story 3.6: a booked state without funding details falls back to a card", () => {
    expect(parsePreview({ booked: true, can_self_cancel: true })).toEqual({
      kind: "booked",
      bookingId: null,
      funding: "card",
      productName: "",
      optionsCount: 1,
      cancelDeadline: null,
      canSelfCancel: true,
    })
  })

  it("a known code is kept; anything else is a server error", () => {
    expect(parsePreview({ ok: false, code: "EVENT_FULL" })).toEqual({
      kind: "blocked",
      code: "EVENT_FULL",
    })
    expect(parsePreview({ ok: false, code: "NOPE" })).toEqual({
      kind: "blocked",
      code: "SERVER_ERROR",
    })
    expect(parsePreview({ ok: true })).toEqual({
      kind: "blocked",
      code: "SERVER_ERROR",
    })
    expect(parsePreview(null)).toEqual({
      kind: "blocked",
      code: "SERVER_ERROR",
    })
  })
})

describe("blockedAction", () => {
  it("contact only where Tal can still help", () => {
    expect(blockedAction("REGISTRATION_CLOSED")).toBe("contact")
    expect(blockedAction("NO_MATCHING_ENTITLEMENT")).toBe("contact")
    expect(blockedAction("EVENT_FULL")).toBe("all-sessions")
    expect(blockedAction("ENTITLEMENT_EXPIRED_ON_DATE")).toBe("all-sessions")
    expect(blockedAction("EVENT_NOT_BOOKABLE")).toBe("all-sessions")
  })
})
