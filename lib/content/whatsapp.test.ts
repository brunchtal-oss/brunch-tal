import { describe, expect, it } from "vitest"

import { whatsappHref } from "./whatsapp"

describe("whatsappHref", () => {
  it.each([
    ["0544256456", "https://wa.me/972544256456"],
    ["054-425-6456", "https://wa.me/972544256456"],
    ["+972 54 425 6456", "https://wa.me/972544256456"],
    ["00972544256456", "https://wa.me/972544256456"],
    ["972544256456", "https://wa.me/972544256456"],
    // Copied from WhatsApp: wrapped in direction marks.
    ["\u202A+972 54-425-6456\u202C", "https://wa.me/972544256456"],
    ["\u200E+972 54-425-6456", "https://wa.me/972544256456"],
    ["+972 054-425-6456", "https://wa.me/972544256456"],
    ["00972-054-425-6456", "https://wa.me/972544256456"],
  ])("reads %s as an international number", (phone, href) => {
    expect(whatsappHref(phone)).toBe(href)
  })

  it("adds the prepared message, encoded", () => {
    expect(whatsappHref("0544256456", " a b&c?\n")).toBe(
      "https://wa.me/972544256456?text=a%20b%26c%3F"
    )
    expect(whatsappHref("0544256456", "שלום טל")).toBe(
      `https://wa.me/972544256456?text=${encodeURIComponent("שלום טל")}`
    )
  })

  it.each([undefined, null, "", "  "])(
    "leaves out an empty message (%j)",
    (message) => {
      expect(whatsappHref("0544256456", message)).toBe(
        "https://wa.me/972544256456"
      )
    }
  )

  it("gives no link for a broken number, even with a message", () => {
    expect(whatsappHref("abc", "hi")).toBeNull()
  })

  it.each([
    null,
    undefined,
    "",
    "abc",
    "05",
    "+0123456789",
    "1".repeat(16),
    "544256456",
    "+44 20 7946 0958",
  ])("gives no link for %j", (phone) => {
    expect(whatsappHref(phone)).toBeNull()
  })
})
