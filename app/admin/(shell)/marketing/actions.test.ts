import { beforeEach, describe, expect, it, vi } from "vitest"

import { updateMarketingTagsAction } from "./actions"

const callRpc = vi.fn()
const updateTag = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))
vi.mock("next/cache", () => ({
  updateTag: (...args: unknown[]) => updateTag(...args),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}))

const KEY = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  callRpc.mockReset()
  updateTag.mockReset()
})

describe("updateMarketingTagsAction", () => {
  it("sends the normalized IDs (blank as empty) and refreshes the public cache", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { version: 2 } })
    await expect(
      updateMarketingTagsAction({
        ids: { ga4: " g-ab12cd34ef ", gtm: "", pixel: "123456789012345" },
        expectedVersion: 1,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_update_marketing_tags",
      {
        p_ga4_measurement_id: "G-AB12CD34EF",
        p_gtm_container_id: "",
        p_meta_pixel_id: "123456789012345",
        p_expected_version: 1,
        p_idempotency_key: KEY,
      }
    )
    expect(updateTag).toHaveBeenCalledWith("marketing-tags")
  })

  it("refuses a bad ID with its field, without calling the RPC", async () => {
    for (const [ids, field] of [
      [{ ga4: "<script>", gtm: "", pixel: "" }, "ga4_measurement_id"],
      [{ ga4: "", gtm: "GTM-12 34", pixel: "" }, "gtm_container_id"],
      [{ ga4: "", gtm: "", pixel: "12345" }, "meta_pixel_id"],
      [{ ga4: "", gtm: "", pixel: "1".repeat(65) }, "meta_pixel_id"],
    ] as const) {
      await expect(
        updateMarketingTagsAction({
          ids,
          expectedVersion: 1,
          idempotencyKey: KEY,
        })
      ).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
        detail: { field },
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("refuses a bad shape, version or key", async () => {
    const ids = { ga4: "", gtm: "", pixel: "" }
    for (const input of [
      { ids, expectedVersion: 0, idempotencyKey: KEY },
      { ids, expectedVersion: 1, idempotencyKey: "nope" },
      { ids: null, expectedVersion: 1, idempotencyKey: KEY },
      { ids: { ga4: "" }, expectedVersion: 1, idempotencyKey: KEY },
    ]) {
      const result = await updateMarketingTagsAction(
        input as Parameters<typeof updateMarketingTagsAction>[0]
      )
      expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC's refusal on and keeps the cache", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "STALE_VERSION" })
    await expect(
      updateMarketingTagsAction({
        ids: { ga4: "G-AB12CD34EF", gtm: "", pixel: "" },
        expectedVersion: 1,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "STALE_VERSION" })
    expect(updateTag).not.toHaveBeenCalled()
  })
})
