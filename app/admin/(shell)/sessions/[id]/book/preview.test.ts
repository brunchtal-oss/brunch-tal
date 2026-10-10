import { describe, expect, it } from "vitest"

import { errorMessage } from "@/lib/errors"

import { parseBookPreview, refusalAction, refusalMessage } from "./preview"

describe("parseBookPreview", () => {
  it("reads an ok preview", () => {
    expect(
      parseBookPreview({
        ok: true,
        product_name: "Card",
        expires_on: "2026-11-19",
        occupied: 3,
        capacity: 12,
      })
    ).toEqual({
      ok: true,
      source: "entitlement",
      productName: "Card",
      expiresOn: "2026-11-19",
      occupied: 3,
      capacity: 12,
    })
  })

  it("story 3.7: reads a preview funded by a credit (no expires_on)", () => {
    expect(
      parseBookPreview({
        ok: true,
        source: "credit",
        product_name: "Single",
        occupied: 3,
        capacity: 12,
      })
    ).toEqual({
      ok: true,
      source: "credit",
      productName: "Single",
      expiresOn: null,
      occupied: 3,
      capacity: 12,
    })
    // An entitlement without its date is still malformed.
    expect(
      parseBookPreview({
        ok: true,
        source: "entitlement",
        product_name: "Card",
        occupied: 3,
        capacity: 12,
      })
    ).toMatchObject({ ok: false, code: "SERVER_ERROR" })
  })

  it("reads a refusal, with or without the session's numbers", () => {
    expect(
      parseBookPreview({
        ok: false,
        code: "EVENT_FULL",
        occupied: 12,
        capacity: 12,
      })
    ).toEqual({ ok: false, code: "EVENT_FULL", occupied: 12, capacity: 12 })
    expect(parseBookPreview({ ok: false, code: "EVENT_NOT_BOOKABLE" })).toEqual(
      {
        ok: false,
        code: "EVENT_NOT_BOOKABLE",
        occupied: null,
        capacity: null,
      }
    )
  })

  it("an unknown code or a broken answer is a server error", () => {
    expect(parseBookPreview({ ok: false, code: "NOPE" })).toMatchObject({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(parseBookPreview(null)).toMatchObject({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(parseBookPreview({ ok: true, occupied: 1 })).toMatchObject({
      ok: false,
      code: "SERVER_ERROR",
    })
  })
})

describe("refusalAction", () => {
  it.each([
    ["NO_MATCHING_ENTITLEMENT", "payment"],
    ["ENTITLEMENT_EXPIRED_ON_DATE", "payment"],
    ["EVENT_FULL", "capacity"],
    ["CUSTOMER_ALREADY_BOOKED", null],
    ["EVENT_ENDED", null],
  ] as const)("%s -> %s", (code, expected) => {
    expect(refusalAction(code)).toBe(expected)
  })
})

describe("refusalMessage", () => {
  it("words a missing entitlement for Tal, not for the customer", () => {
    expect(refusalMessage("NO_MATCHING_ENTITLEMENT")).toBe(
      "ללקוחה אין זכות שמתאימה למפגש הזה"
    )
    expect(refusalMessage("EVENT_FULL")).not.toBe(errorMessage("EVENT_FULL"))
  })

  it("keeps errorMessage for a code already worded for Tal", () => {
    expect(refusalMessage("CUSTOMER_ALREADY_BOOKED")).toBe(
      errorMessage("CUSTOMER_ALREADY_BOOKED")
    )
  })
})
