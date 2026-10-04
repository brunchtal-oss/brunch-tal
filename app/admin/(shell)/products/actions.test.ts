import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createProductAction,
  previewProductPriceAction,
  setProductPriceAction,
  updateProductAction,
} from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111"
const KEY = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  callRpc.mockReset()
})

describe("createProductAction", () => {
  it("creates with the admin's session and the form's key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { product_id: PRODUCT_ID } })
    const product = { name: "N", type: "single", price_agorot: 100 }
    await expect(
      createProductAction({ product, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { productId: PRODUCT_ID } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_create_product",
      { p_product: product, p_idempotency_key: KEY }
    )
  })

  it("refuses a bad key or an empty product without calling the RPC", async () => {
    for (const input of [
      { product: { name: "N" }, idempotencyKey: "nope" },
      { product: {}, idempotencyKey: KEY },
    ]) {
      await expect(createProductAction(input)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC's code and detail through", async () => {
    callRpc.mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "units" },
    })
    await expect(
      createProductAction({ product: { units: 0 }, idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "units" },
    })
  })
})

describe("updateProductAction", () => {
  it("sends the changes", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { product_id: PRODUCT_ID } })
    await expect(
      updateProductAction({
        productId: PRODUCT_ID,
        changes: { active: false },
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_update_product",
      {
        p_product_id: PRODUCT_ID,
        p_changes: { active: false },
        p_idempotency_key: KEY,
      }
    )
  })

  it("never sends a price (it goes through the sensitive dialog)", async () => {
    await expect(
      updateProductAction({
        productId: PRODUCT_ID,
        changes: { price_agorot: 1 },
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })
})

describe("price", () => {
  it("previews the plan", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: {
        product_id: PRODUCT_ID,
        name: "Card",
        old_price_agorot: 47200,
        new_price_agorot: 50000,
      },
    })
    await expect(
      previewProductPriceAction({ productId: PRODUCT_ID, priceAgorot: 50000 })
    ).resolves.toEqual({
      ok: true,
      data: { name: "Card", oldPriceAgorot: 47200, newPriceAgorot: 50000 },
    })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "preview_admin_set_product_price",
      { p_product_id: PRODUCT_ID, p_price_agorot: 50000 }
    )
  })

  it("sends the confirmation, the trimmed reason (empty as null) and the key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: {} })
    await setProductPriceAction({
      productId: PRODUCT_ID,
      priceAgorot: 50000,
      reason: "  ",
      confirmed: true,
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_set_product_price",
      {
        p_product_id: PRODUCT_ID,
        p_price_agorot: 50000,
        p_reason: null,
        p_confirmed: true,
        p_idempotency_key: KEY,
      }
    )
  })

  it("refuses a negative or fractional price", async () => {
    for (const priceAgorot of [-1, 1.5]) {
      await expect(
        setProductPriceAction({
          productId: PRODUCT_ID,
          priceAgorot,
          reason: "",
          confirmed: true,
          idempotencyKey: KEY,
        })
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes CONFIRM_REQUIRED through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "CONFIRM_REQUIRED" })
    await expect(
      setProductPriceAction({
        productId: PRODUCT_ID,
        priceAgorot: 50000,
        reason: "",
        confirmed: false,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "CONFIRM_REQUIRED" })
  })
})
