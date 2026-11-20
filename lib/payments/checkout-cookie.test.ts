import { describe, expect, it } from "vitest"

import {
  checkoutEntryFor,
  matchPaymentOutcome,
  newestCheckoutId,
  outcomeOfPath,
  serializePaymentOutcome,
  parseCheckoutCookie,
  serializeCheckoutCookie,
  withoutCheckoutEntry,
} from "./checkout-cookie"

const CHECKOUT = "11111111-1111-4111-8111-111111111111"
const OTHER = "55555555-5555-4555-8555-555555555555"
const EVENT = "33333333-3333-4333-8333-333333333333"
const BROWSER = "b".repeat(43)
const BROWSER_2 = "c".repeat(43)

describe("the checkout cookie", () => {
  it("entries newest first, at most 5, invalid ones skipped", () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      id: `${i}1111111-1111-4111-8111-111111111111`,
      secret: BROWSER,
    }))
    const value = serializeCheckoutCookie(entries)
    expect(value.split(",")).toHaveLength(5)
    expect(parseCheckoutCookie(`x.y,${value}`)).toEqual(entries.slice(0, 5))
  })

  it.each([
    null,
    "",
    CHECKOUT,
    `${CHECKOUT}.`,
    `x.${BROWSER}`,
    `${CHECKOUT}.a b`,
  ])("no entry in %j", (value) => {
    expect(parseCheckoutCookie(value)).toEqual([])
  })

  it("the entry of c only", () => {
    const cookie = `${OTHER}.${BROWSER_2},${CHECKOUT}.${BROWSER}`
    expect(checkoutEntryFor(cookie, CHECKOUT)).toEqual({
      id: CHECKOUT,
      secret: BROWSER,
    })
    expect(checkoutEntryFor(cookie, null)).toBeNull()
    expect(checkoutEntryFor(cookie, EVENT)).toBeNull()
  })

  it("removing an entry keeps the rest, and the last one empties it", () => {
    const cookie = `${OTHER}.${BROWSER_2},${CHECKOUT}.${BROWSER}`
    expect(withoutCheckoutEntry(cookie, CHECKOUT)).toBe(`${OTHER}.${BROWSER_2}`)
    expect(withoutCheckoutEntry(`${CHECKOUT}.${BROWSER}`, CHECKOUT)).toBeNull()
    expect(withoutCheckoutEntry(undefined, CHECKOUT)).toBeNull()
  })

  it("the newest entry is the banner's", () => {
    expect(
      newestCheckoutId(`${OTHER}.${BROWSER_2},${CHECKOUT}.${BROWSER}`)
    ).toBe(OTHER)
    expect(newestCheckoutId("garbage")).toBeNull()
    expect(newestCheckoutId(undefined)).toBeNull()
  })
})

describe("the outcome cookie (review pass 1)", () => {
  it("matches only the same payment as the parameter", () => {
    const cookie = serializePaymentOutcome({ payment: "failed", kind: "card" })
    expect(cookie).toBe("failed.card")
    expect(matchPaymentOutcome("failed", cookie)).toEqual({
      payment: "failed",
      kind: "card",
    })
    // A forged link: another value, or no cookie at all.
    expect(matchPaymentOutcome("paid", cookie)).toBeNull()
    expect(matchPaymentOutcome("failed", undefined)).toBeNull()
    expect(matchPaymentOutcome("failed", "failed.other")).toBeNull()
    expect(matchPaymentOutcome(null, cookie)).toBeNull()
  })

  it("a redirect's ?payment= is its outcome; other paths have none", () => {
    expect(outcomeOfPath("/me/bookings?payment=no_place", "session")).toEqual({
      payment: "no_place",
      kind: "session",
    })
    expect(outcomeOfPath("/?payment=not_found", "card")).toEqual({
      payment: "not_found",
      kind: "card",
    })
    expect(matchPaymentOutcome("review", "review.session")).toEqual({
      payment: "review",
      kind: "session",
    })
    expect(outcomeOfPath("/pay/pending?c=x", "card")).toBeNull()
    expect(outcomeOfPath("/join/tok", "card")).toBeNull()
    expect(outcomeOfPath("/?payment=other", "card")).toBeNull()
  })
})
