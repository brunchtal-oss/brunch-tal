import { beforeEach, describe, expect, it, vi } from "vitest"

import { completeRefundAction, previewCompleteRefundAction } from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const ID = "33333333-3333-4333-8333-333333333333"
const KEY = "22222222-2222-4222-8222-222222222222"

const INPUT = {
  refundRequestId: ID,
  refundedOn: "2026-10-13",
  amountAgorot: 18000,
  reference: " 1234 ",
  confirmed: true,
  idempotencyKey: KEY,
}

beforeEach(() => {
  callRpc.mockReset()
})

describe("previewCompleteRefundAction (story 3.9)", () => {
  it("returns the parsed plan, or the RPC's refusal", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "REFUND_ALREADY_COMPLETED" },
    })
    await expect(
      previewCompleteRefundAction({ refundRequestId: ID })
    ).resolves.toEqual({
      ok: true,
      data: { ok: false, code: "REFUND_ALREADY_COMPLETED" },
    })
    expect(callRpc.mock.calls[0].slice(1)).toEqual([
      "preview_admin_complete_refund",
      { p_refund_request_id: ID },
    ])
    callRpc.mockResolvedValue({ ok: false, code: "NOT_AUTHORIZED" })
    await expect(
      previewCompleteRefundAction({ refundRequestId: ID })
    ).resolves.toEqual({ ok: false, code: "NOT_AUTHORIZED" })
  })

  it("refuses a malformed id without calling the RPC", async () => {
    await expect(
      previewCompleteRefundAction({ refundRequestId: "x" })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })
})

describe("completeRefundAction (story 3.9)", () => {
  it("sends every field to admin_complete_refund (the reference as typed: the RPC trims it)", async () => {
    callRpc.mockResolvedValue({ ok: true, data: {} })
    await expect(completeRefundAction(INPUT)).resolves.toEqual({
      ok: true,
      data: undefined,
    })
    expect(callRpc.mock.calls[0].slice(1)).toEqual([
      "admin_complete_refund",
      {
        p_refund_request_id: ID,
        p_refunded_on: "2026-10-13",
        p_amount_agorot: 18000,
        p_reference: " 1234 ",
        p_confirmed: true,
        p_idempotency_key: KEY,
      },
    ])
  })

  it("passes a refusal through with its detail", async () => {
    callRpc.mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "refunded_on" },
    })
    await expect(completeRefundAction(INPUT)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "refunded_on" },
    })
  })

  it.each([
    ["a bad id", { refundRequestId: "x" }],
    ["a bad key", { idempotencyKey: "x" }],
    ["a bad date", { refundedOn: "13.10.2026" }],
    ["a negative amount", { amountAgorot: -1 }],
    ["a fractional amount", { amountAgorot: 1.5 }],
    ["no confirmed flag", { confirmed: "yes" }],
  ])("refuses %s without calling the RPC", async (_label, change) => {
    await expect(
      completeRefundAction({ ...INPUT, ...change } as typeof INPUT)
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })
})
