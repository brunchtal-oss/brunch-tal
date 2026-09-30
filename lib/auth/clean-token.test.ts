import { describe, expect, it } from "vitest"

import { cleanToken } from "./clean-token"

const TOKEN = "cS3wY451dH7T5jTMI2LdM7V6ETkPQFDNy3sRqhUAp-g"

describe("cleanToken", () => {
  it("keeps a valid token unchanged", () => {
    expect(cleanToken(TOKEN)).toBe(TOKEN)
  })

  it.each([
    ["LRM", "\u200E"],
    ["RLM", "\u200F"],
    ["PDF", "\u202C"],
    ["RLE", "\u202B"],
    ["isolate", "\u2066"],
    ["zero-width space", "\u200B"],
    ["BOM", "\uFEFF"],
    ["Arabic letter mark", "\u061C"],
    ["space", " "],
    ["newline", "\n"],
  ])("removes a %s around the token", (_label, mark) => {
    expect(cleanToken(`${mark}${TOKEN}${mark}`)).toBe(TOKEN)
  })

  it.each(["%E2%80%8E", "%E2%80%8F", "%E2%80%AC", "%20"])(
    "removes a percent-encoded %s",
    (encoded) => {
      expect(cleanToken(`${TOKEN}${encoded}`)).toBe(TOKEN)
    }
  )

  it("leaves a malformed escape for the lookup to reject", () => {
    expect(cleanToken(`${TOKEN}%E2%80`)).toBe(`${TOKEN}%E2%80`)
  })
})
