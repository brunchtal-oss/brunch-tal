import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  markCorrectionHandledAction,
  previewSettleParkedAction,
  settleParkedAction,
} from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const ID = "33333333-3333-4333-8333-333333333333"
const KEY = "22222222-2222-4222-8222-222222222222"
const INVALID = { ok: false, code: "INVALID_INPUT" }

beforeEach(() => {
  callRpc.mockReset()
  callRpc.mockResolvedValue({ ok: true, data: {} })
})

describe("the 'to handle' buttons (story 3.13)", () => {
  it("טופל sends the booking", async () => {
    await expect(
      markCorrectionHandledAction({ bookingId: ID })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_correction_booking_handled",
      { p_booking_id: ID }
    )
  })

  it("the settle: a whitespace reason is sent as null", async () => {
    await settleParkedAction({
      entitlementId: ID,
      reason: "  ",
      confirmed: true,
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_settle_parked_purchase",
      {
        p_entitlement_id: ID,
        p_reason: null,
        p_confirmed: true,
        p_idempotency_key: KEY,
      }
    )
    callRpc.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "NOT_PARKED" },
    })
    await expect(
      previewSettleParkedAction({ entitlementId: ID })
    ).resolves.toEqual({ ok: true, data: { ok: false, code: "NOT_PARKED" } })
  })

  it("a bad id, reason or key is INVALID_INPUT without calling the RPC", async () => {
    await expect(
      markCorrectionHandledAction({ bookingId: "nope" })
    ).resolves.toEqual(INVALID)
    await expect(
      previewSettleParkedAction({ entitlementId: "nope" })
    ).resolves.toEqual(INVALID)
    for (const input of [
      {
        entitlementId: "nope",
        reason: "",
        confirmed: true,
        idempotencyKey: KEY,
      },
      {
        entitlementId: ID,
        reason: "x".repeat(2001),
        confirmed: true,
        idempotencyKey: KEY,
      },
      { entitlementId: ID, reason: "", confirmed: true, idempotencyKey: "x" },
    ]) {
      await expect(settleParkedAction(input)).resolves.toEqual(INVALID)
    }
    expect(callRpc).not.toHaveBeenCalled()
  })
})
