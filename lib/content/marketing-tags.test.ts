import { beforeEach, describe, expect, it, vi } from "vitest"

import { getMarketingTags, MARKETING_TAGS_CACHE_TAG } from "./marketing-tags"

const maybeSingle = vi.fn()
const select = vi.fn()
const cacheTag = vi.fn()

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: (...args: unknown[]) => cacheTag(...args),
}))
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    from: () => ({ select }),
  }),
}))

const OFF = { ga4: null, gtm: null, pixel: null }

beforeEach(() => {
  maybeSingle.mockReset()
  select.mockReset()
  cacheTag.mockReset()
  select.mockReturnValue({ maybeSingle })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("getMarketingTags", () => {
  it("reads the three IDs only, tagged marketing-tags", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        ga4_measurement_id: "G-AB12CD34EF",
        gtm_container_id: "GTM-AB12CD3",
        meta_pixel_id: "123456789012345",
      },
      error: null,
    })
    await expect(getMarketingTags()).resolves.toEqual({
      ga4: "G-AB12CD34EF",
      gtm: "GTM-AB12CD3",
      pixel: "123456789012345",
    })
    expect(MARKETING_TAGS_CACHE_TAG).toBe("marketing-tags")
    expect(cacheTag).toHaveBeenCalledWith(MARKETING_TAGS_CACHE_TAG)
    expect(select).toHaveBeenCalledWith(
      "ga4_measurement_id, gtm_container_id, meta_pixel_id"
    )
  })

  it("an invalid stored value comes back off", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        ga4_measurement_id: "G-AB'",
        gtm_container_id: null,
        meta_pixel_id: "123456789012345",
      },
      error: null,
    })
    await expect(getMarketingTags()).resolves.toEqual({
      ga4: null,
      gtm: null,
      pixel: "123456789012345",
    })
  })

  it("a read error or a thrown error: every tool off", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "x" } })
    await expect(getMarketingTags()).resolves.toEqual(OFF)
    maybeSingle.mockRejectedValue(new Error("network"))
    await expect(getMarketingTags()).resolves.toEqual(OFF)
  })
})
