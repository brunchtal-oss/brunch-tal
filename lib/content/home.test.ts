import { beforeEach, describe, expect, it, vi } from "vitest"

import { getHomeHero } from "./home"

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

describe("getHomeHero", () => {
  it("returns the published hero, tagged content:home", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        published_content: { title: " t ", description: "d", cta_label: "c" },
      },
      error: null,
    })
    await expect(getHomeHero()).resolves.toEqual({
      title: "t",
      description: "d",
      cta_label: "c",
    })
    expect(eq).toHaveBeenCalledWith("page_slug", "home")
    expect(eq).toHaveBeenCalledWith("key", "hero")
    expect(cacheTag).toHaveBeenCalledWith("content:home")
  })

  it.each([
    ["nothing is published", { data: null, error: null }],
    [
      "the published hero has no title",
      { data: { published_content: { cta_label: "c" } }, error: null },
    ],
    [
      "the published hero is empty",
      { data: { published_content: {} }, error: null },
    ],
  ])("is null when %s", async (_label, result) => {
    maybeSingle.mockResolvedValue(result)
    await expect(getHomeHero()).resolves.toBeNull()
  })

  it("falls back to null on a read error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    maybeSingle.mockResolvedValue({ data: null, error: { message: "x" } })
    await expect(getHomeHero()).resolves.toBeNull()
    expect(log).toHaveBeenCalledWith("content.read_failed", { page: "home" })
    log.mockRestore()
  })
})
