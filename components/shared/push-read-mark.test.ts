import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ usePathname: () => "/me" }))

const { readMarkOf } = await import("./push-read-mark")

const ID = "11111111-2222-4333-8444-555555555555"

describe("readMarkOf (story 3.5: opening a push marks it read)", () => {
  it("takes the id and keeps the rest of the address, hash included", () => {
    expect(
      readMarkOf(`https://example.test/me/bookings?read=${ID}#booking-b1`)
    ).toEqual({ id: ID, cleanPath: "/me/bookings#booking-b1" })
    expect(readMarkOf(`https://example.test/admin?x=1&read=${ID}`)).toEqual({
      id: ID,
      cleanPath: "/admin?x=1",
    })
  })

  it("nothing without a valid id", () => {
    expect(readMarkOf("https://example.test/me/bookings")).toBeNull()
    expect(readMarkOf("https://example.test/me?read=nope")).toBeNull()
    expect(readMarkOf("not a url")).toBeNull()
  })
})
