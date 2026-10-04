import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  approvePaymentAction,
  previewPaymentAction,
  searchCustomersAction,
} from "./actions"

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
const CUSTOMER = "44444444-4444-4444-8444-444444444444"
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
        kind: "link",
        link: `https://host.example/join/${TOKEN}`,
        linkExpiresAt: EXPIRES,
        payerLabel: null,
      },
    })
    expect(callRpc).toHaveBeenCalledWith(
      {},
      "admin_approve_payment",
      expect.objectContaining({
        p_customer_id: null,
        p_payer_label: null,
        p_amount_override_reason: null,
        p_confirmed: false,
        p_duplicate_confirmed: false,
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
      data: {
        kind: "link",
        link: null,
        linkExpiresAt: EXPIRES,
        payerLabel: null,
      },
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
    ["a reason over 500", { amountOverrideReason: "x".repeat(501) }],
    ["a customer id that is not a uuid", { customerId: "x" }],
    ["a payer label over 40", { payerLabel: "x".repeat(41) }],
    [
      "a payer label with an existing customer",
      {
        customerId: "44444444-4444-4444-8444-444444444444",
        payerLabel: "Dana",
      },
    ],
    ["a negative amount", { amountAgorot: "-1" }],
    ["an empty amount", { amountAgorot: "" }],
  ])("refuses %s without calling the RPC", async (_label, overrides) => {
    await expect(approvePaymentAction(null, form(overrides))).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("approves for an existing customer with the override and both confirmations", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: {
        payment_id: "p",
        entitlement_id: "e",
        customer_id: CUSTOMER,
        expires_on: "2026-11-19",
        product_name: "Card",
        units: 4,
      },
    })
    await expect(
      approvePaymentAction(
        null,
        form({
          customerId: CUSTOMER,
          amountAgorot: "44000",
          amountOverrideReason: " friend ",
          confirmed: "1",
          duplicateConfirmed: "1",
        })
      )
    ).resolves.toEqual({
      ok: true,
      data: {
        kind: "existing",
        productName: "Card",
        units: 4,
        expiresOn: "2026-11-19",
      },
    })
    expect(callRpc).toHaveBeenCalledWith(
      {},
      "admin_approve_payment",
      expect.objectContaining({
        p_customer_id: CUSTOMER,
        p_amount_agorot: 44000,
        p_amount_override_reason: "friend",
        p_confirmed: true,
        p_duplicate_confirmed: true,
      })
    )
  })

  it("sends a trimmed payer label for a new customer and returns it for the link card", async () => {
    requestHeaders = new Headers({ origin: "https://host.example" })
    callRpc.mockResolvedValue(approved(TOKEN))
    await expect(
      approvePaymentAction(null, form({ payerLabel: "  Michal " }))
    ).resolves.toMatchObject({
      ok: true,
      data: { kind: "link", payerLabel: "Michal" },
    })
    expect(callRpc).toHaveBeenCalledWith(
      {},
      "admin_approve_payment",
      expect.objectContaining({ p_payer_label: "Michal" })
    )
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

const PREVIEW_INPUT = {
  customerId: null,
  payerLabel: "",
  productId: PRODUCT,
  amountAgorot: 47200,
  paidOn: "2026-10-01",
  methodId: METHOD,
}

describe("previewPaymentAction", () => {
  it("returns the plan, the customer's name, the similar payments and the window", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: {
        product_name: "Card",
        units: 4,
        expires_on: "2026-11-19",
        expired: false,
        customer_name: "Dana",
        similar_payments: [
          {
            customer_name: null,
            payer_label: "Michal",
            paid_on: "2026-09-29",
            created_at: "2026-09-29T08:00:00+00:00",
          },
        ],
        duplicate_window_days: 7,
      },
    })
    await expect(
      previewPaymentAction({ ...PREVIEW_INPUT, customerId: CUSTOMER })
    ).resolves.toEqual({
      ok: true,
      data: {
        productName: "Card",
        units: 4,
        expiresOn: "2026-11-19",
        expired: false,
        customerName: "Dana",
        similar: [
          {
            customerName: null,
            payerLabel: "Michal",
            paidOn: "2026-09-29",
            createdAt: "2026-09-29T08:00:00+00:00",
          },
        ],
        windowDays: 7,
      },
    })
    expect(callRpc).toHaveBeenCalledWith(
      {},
      "preview_admin_approve_payment",
      expect.objectContaining({
        p_customer_id: CUSTOMER,
        p_payment_method_id: METHOD,
      })
    )
  })

  it.each([
    { ...PREVIEW_INPUT, productId: "x" },
    { ...PREVIEW_INPUT, customerId: "x" },
    { ...PREVIEW_INPUT, payerLabel: "x".repeat(41) },
    {
      ...PREVIEW_INPUT,
      customerId: "44444444-4444-4444-8444-444444444444",
      payerLabel: "Dana",
    },
    { ...PREVIEW_INPUT, methodId: "" },
    { ...PREVIEW_INPUT, amountAgorot: 1.5 },
    { ...PREVIEW_INPUT, amountAgorot: -1 },
    { ...PREVIEW_INPUT, paidOn: "tomorrow" },
  ])("refuses %j without calling the RPC", async (input) => {
    await expect(previewPaymentAction(input)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(callRpc).not.toHaveBeenCalled()
  })
})

describe("searchCustomersAction", () => {
  it("trims the query and formats the phones", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: [
        { id: CUSTOMER, full_name: "Dana", phone_e164: "+972541234567" },
        { id: PRODUCT, full_name: "Noa", phone_e164: null },
      ],
    })
    await expect(searchCustomersAction(" da ")).resolves.toEqual({
      ok: true,
      data: [
        { id: CUSTOMER, name: "Dana", phone: "054-123-4567" },
        { id: PRODUCT, name: "Noa", phone: "" },
      ],
    })
    expect(callRpc).toHaveBeenCalledWith({}, "admin_search_customers", {
      p_query: "da",
    })
  })

  it.each(["", " a ", "x".repeat(101)])(
    "refuses %j without calling the RPC",
    async (query) => {
      await expect(searchCustomersAction(query)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
      expect(callRpc).not.toHaveBeenCalled()
    }
  )
})
