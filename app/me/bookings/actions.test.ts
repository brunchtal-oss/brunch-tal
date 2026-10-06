import { beforeEach, describe, expect, it, vi } from "vitest"

import { cancelBookingAction } from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const BOOKING_ID = "33333333-3333-4333-8333-333333333333"
const KEY = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  callRpc.mockReset()
})

describe("cancelBookingAction", () => {
  it("cancels with the customer's session and the sheet's key, no choice", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: {
        booking_id: BOOKING_ID,
        outcome: "pinned",
        entitlement_id: "e1",
        expires_on: "2026-10-20",
        awaiting_sessions: false,
      },
    })
    await expect(
      cancelBookingAction({ bookingId: BOOKING_ID, idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: true,
      data: {
        outcome: "pinned",
        expiresOn: "2026-10-20",
        awaitingSessions: false,
      },
    })
    expect(callRpc).toHaveBeenCalledWith({ session: true }, "cancel_booking", {
      p_booking_id: BOOKING_ID,
      p_idempotency_key: KEY,
    })
  })

  it("refuses malformed input without calling the RPC", async () => {
    for (const input of [
      { bookingId: "nope", idempotencyKey: KEY },
      { bookingId: BOOKING_ID, idempotencyKey: "nope" },
      { bookingId: 5, idempotencyKey: KEY },
      null,
    ]) {
      await expect(
        cancelBookingAction(
          input as unknown as { bookingId: string; idempotencyKey: string }
        )
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC's code through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "SELF_CANCEL_CLOSED" })
    await expect(
      cancelBookingAction({ bookingId: BOOKING_ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "SELF_CANCEL_CLOSED" })
  })
})
