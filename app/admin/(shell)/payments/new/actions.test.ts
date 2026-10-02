import { beforeEach, describe, expect, it, vi } from "vitest"

import { approvePaymentAction, previewPaymentAction } from "./actions"

const callRpc = vi.fn()
let requestHeaders = new Headers()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
}))
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
}))

const PRODUCT = "11111111-1111-4111-8111-111111111111"
const METHOD = "33333333-3333-4333-8333-333333333333"
const KEY = "22222222-2222-4222-8222-222222222222"
const TOKEN = "t".repeat(43)
const EXPIRES = "2026-10-03T07:42:00+00:00"

const VALID: Record<string, string> = {
  productId: PRODUCT,
  paymentMethodId: METHOD,
  paidOn: "2026-10-01",
  amountAgorot: "47200",
  reference: "",
  note: "",
  idempotencyKey: KEY,
}

function form(overrides: Record<string, string> = {}) {
  const data = new FormData()
  for (const [name, value] of Object.entries({ ...VALID, ...overrides })) {
    data.append(name, value)
  }
  return data
}

function approved(token?: string) {
  return {
    ok: true,
    data: {
      ...(token ? { token } : {}),
      link_expires_at: EXPIRES,
      reissue_required: !token,
    },
  }
}

beforeEach(() => {
  callRpc.mockReset()
  requestHeaders = new Headers()
})

describe("approvePaymentAction", () => {
  it("builds the join link from the request's Origin", async () => {
    requestHeaders = new Headers({ origin: "https://host.example" })
    callRpc.mockResolvedValue(approved(TOKEN))

    await expect(approvePaymentAction(null, form())).resolves.toEqual({
      ok: true,
      data: {
        link: `https://host.example/join/${TOKEN}`,
        linkExpiresAt: EXPIRES,
      },
    })
    expect(callRpc).toHaveBeenCalledWith(
      {},
      "admin_approve_payment",
      expect.objectContaining({
        p_product_id: PRODUCT,
        p_payment_method_id: METHOD,
        p_amount_agorot: 47200,
        p_paid_on: "2026-10-01",
        p_reference: null,
        p_note: null,
        p_idempotency_key: KEY,
      })
    )
  })

  it("falls back to x-forwarded-host and x-forwarded-proto without an Origin", async () => {
    requestHeaders = new Headers({
      "x-forwarded-host": "192.168.1.5:3000",
      "x-forwarded-proto": "http",
      host: "ignored.example",
    })
    callRpc.mockResolvedValue(approved(TOKEN))

    const result = await approvePaymentAction(null, form())
    expect(result).toMatchObject({
      ok: true,
      data: { link: `http://192.168.1.5:3000/join/${TOKEN}` },
    })
  })

  it("returns link: null for a repeat that carries no token", async () => {
    requestHeaders = new Headers({ origin: "https://host.example" })
    callRpc.mockResolvedValue(approved())

    await expect(approvePaymentAction(null, form())).resolves.toEqual({
      ok: true,
      data: { link: null, linkExpiresAt: EXPIRES },
    })
  })

  it.each([
    ["a product id that is not a uuid", { productId: "x" }],
    ["a method id that is not a uuid", { paymentMethodId: "x" }],
    ["a malformed date", { paidOn: "01.10.2026" }],
    ["an amount that is not an integer", { amountAgorot: "472.5" }],
    ["a missing key", { idempotencyKey: "" }],
    ["a reference over 100", { reference: "x".repeat(101) }],
    ["a note over 500", { note: "x".repeat(501) }],
  ])("refuses %s without calling the RPC", async (_label, overrides) => {
    await expect(approvePaymentAction(null, form(overrides))).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes an RPC code through", async () => {
    callRpc.mockResolvedValue({
      ok: false,
      code: "PAYMENT_METHOD_NOT_SELECTABLE",
    })
    await expect(approvePaymentAction(null, form())).resolves.toEqual({
      ok: false,
      code: "PAYMENT_METHOD_NOT_SELECTABLE",
    })
  })
})

describe("previewPaymentAction", () => {
  it("returns the plan's product, units and expiry", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { product_name: "Card", units: 4, expires_on: "2026-11-19" },
    })
    await expect(
      previewPaymentAction({
        productId: PRODUCT,
        amountAgorot: 47200,
        paidOn: "2026-10-01",
      })
    ).resolves.toEqual({
      ok: true,
      data: { productName: "Card", units: 4, expiresOn: "2026-11-19" },
    })
  })

  it.each([
    { productId: "x", amountAgorot: 47200, paidOn: "2026-10-01" },
    { productId: PRODUCT, amountAgorot: 1.5, paidOn: "2026-10-01" },
    { productId: PRODUCT, amountAgorot: 47200, paidOn: "tomorrow" },
  ])("refuses %j without calling the RPC", async (input) => {
    await expect(previewPaymentAction(input)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(callRpc).not.toHaveBeenCalled()
  })
})
