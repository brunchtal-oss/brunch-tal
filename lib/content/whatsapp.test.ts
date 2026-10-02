import { describe, expect, it } from "vitest"

import { whatsappHref } from "./whatsapp"

describe("whatsappHref", () => {
  it.each([
    ["0544256456", "https://wa.me/972544256456"],
    ["054-425-6456", "https://wa.me/972544256456"],
    ["+972 54 425 6456", "https://wa.me/972544256456"],
    ["00972544256456", "https://wa.me/972544256456"],
    ["972544256456", "https://wa.me/972544256456"],
  ])("reads %s as an international number", (phone, href) => {
    expect(whatsappHref(phone)).toBe(href)
  })

  it.each([null, undefined, "", "abc", "05", "+0123456789", "1".repeat(16)])(
    "gives no link for %j",
    (phone) => {
      expect(whatsappHref(phone)).toBeNull()
    }
  )
})
