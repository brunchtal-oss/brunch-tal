import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getBusinessDetails,
  getWhatsappHref,
  guestWhatsappHref,
} from "./business-details"

const maybeSingle = vi.fn()
const eq = vi.fn()
const cacheTag = vi.fn()

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: (...args: unknown[]) => cacheTag(...args),
}))
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    from: () => ({ select: () => ({ eq }) }),
  }),
}))

beforeEach(() => {
  maybeSingle.mockReset()
  eq.mockReset()
  cacheTag.mockReset()
  const chain = { eq, maybeSingle }
  eq.mockReturnValue(chain)
})

const FULL = {
  whatsapp_phone: "0544256456",
  business_name: "n",
  phone: "0501234567",
  whatsapp_message: "hi tal",
  address: "a",
  arrival_instructions: "i",
  navigation_url: "https://maps.example.com/x",
  payment_instructions: "p",
}

describe("getBusinessDetails", () => {
  it("returns every published field, tagged content:global", async () => {
    maybeSingle.mockResolvedValue({
      data: { published_content: FULL },
      error: null,
    })
    await expect(getBusinessDetails()).resolves.toEqual(FULL)
    expect(eq).toHaveBeenCalledWith("page_slug", "contact")
    expect(eq).toHaveBeenCalledWith("key", "business_details")
    // Publishing the contact page updates content:global (story 5.1).
    expect(cacheTag).toHaveBeenCalledWith("content:global")
  })

  it("falls back to null on a read error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    maybeSingle.mockResolvedValue({ data: null, error: { message: "x" } })
    await expect(getBusinessDetails()).resolves.toBeNull()
    expect(log).toHaveBeenCalledWith("content.read_failed", {
      page: "contact",
    })
    log.mockRestore()
  })
})

describe("getWhatsappHref", () => {
  it("builds the link from the published number, without the message", async () => {
    maybeSingle.mockResolvedValue({
      data: { published_content: FULL },
      error: null,
    })
    await expect(getWhatsappHref()).resolves.toBe("https://wa.me/972544256456")
  })

  it.each([
    ["nothing is published", { data: null, error: null }],
    [
      "the content is invalid",
      { data: { published_content: { whatsapp_phone: " " } }, error: null },
    ],
    [
      "the number cannot be read",
      { data: { published_content: { whatsapp_phone: "abc" } }, error: null },
    ],
  ])("is null when %s", async (_label, result) => {
    maybeSingle.mockResolvedValue(result)
    await expect(getWhatsappHref()).resolves.toBeNull()
  })
})

describe("guestWhatsappHref", () => {
  it("adds the prepared message", () => {
    expect(guestWhatsappHref(FULL)).toBe(
      "https://wa.me/972544256456?text=hi%20tal"
    )
    expect(guestWhatsappHref({ whatsapp_phone: "0544256456" })).toBe(
      "https://wa.me/972544256456"
    )
    expect(guestWhatsappHref(null)).toBeNull()
  })
})
