import { beforeEach, describe, expect, it, vi } from "vitest"

import { WORDMARK } from "@/lib/copy/shell"

const getBusinessName = vi.fn<() => Promise<string>>()

vi.mock("@/lib/content/business-details", () => ({
  getBusinessName: () => getBusinessName(),
}))

const { default: manifest } = await import("./manifest")

beforeEach(() => {
  getBusinessName.mockReset()
})

// Story 5.20: a new install gets the published business name.
describe("the manifest", () => {
  it("names the app with the published business name", async () => {
    getBusinessName.mockResolvedValue("שם חדש")
    const m = await manifest()
    expect(m.name).toBe("שם חדש")
    expect(m.short_name).toBe("שם חדש")
    expect(m.start_url).toBe("/me")
  })

  it("the WORDMARK when none is published", async () => {
    getBusinessName.mockResolvedValue(WORDMARK)
    expect((await manifest()).name).toBe(WORDMARK)
  })
})
