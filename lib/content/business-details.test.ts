import { beforeEach, describe, expect, it, vi } from "vitest"

import { getWhatsappHref } from "./business-details"

const maybeSingle = vi.fn()
const eq = vi.fn()

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    from: () => ({ select: () => ({ eq }) }),
  }),
}))

beforeEach(() => {
  maybeSingle.mockReset()
  eq.mockReset()
  const chain = { eq, maybeSingle }
  eq.mockReturnValue(chain)
})

describe("getWhatsappHref", () => {
  it("builds the link from the published business details", async () => {
    maybeSingle.mockResolvedValue({
      data: { published_content: { whatsapp_phone: "0544256456" } },
      error: null,
    })
    await expect(getWhatsappHref()).resolves.toBe("https://wa.me/972544256456")
    expect(eq).toHaveBeenCalledWith("page_slug", "contact")
    expect(eq).toHaveBeenCalledWith("key", "business_details")
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

  it("throws on a read error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "x" } })
    await expect(getWhatsappHref()).rejects.toThrow()
  })
})
