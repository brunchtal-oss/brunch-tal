import { beforeEach, describe, expect, it, vi } from "vitest"

import { SPECIAL_BRUNCH_FALLBACK } from "@/lib/special-brunch"

import { getSpecialBrunchContent } from "./join-form"

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
  eq.mockReturnValue({ eq, maybeSingle })
})

const EDITED = { ...SPECIAL_BRUNCH_FALLBACK, couples_title: "X" }

// Story 2.16: the one reader of the special-brunch wording.
describe("getSpecialBrunchContent", () => {
  it("returns the published block, tagged content:join-form", async () => {
    maybeSingle.mockResolvedValue({
      data: { published_content: EDITED },
      error: null,
    })
    await expect(getSpecialBrunchContent()).resolves.toEqual(EDITED)
    expect(eq).toHaveBeenCalledWith("page_slug", "join-form")
    expect(eq).toHaveBeenCalledWith("key", "special_brunch")
    expect(cacheTag).toHaveBeenCalledWith("content:join-form")
  })

  it("no row -> the fallback (the seed's wording)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(getSpecialBrunchContent()).resolves.toEqual(
      SPECIAL_BRUNCH_FALLBACK
    )
  })

  it("a block that fails the schema -> the fallback", async () => {
    maybeSingle.mockResolvedValue({
      data: { published_content: { ...EDITED, question: "" } },
      error: null,
    })
    await expect(getSpecialBrunchContent()).resolves.toEqual(
      SPECIAL_BRUNCH_FALLBACK
    )
  })

  it("a read error throws (never cached as the fallback)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "x" } })
    await expect(getSpecialBrunchContent()).rejects.toThrow(
      "special brunch content failed"
    )
  })
})
