import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCancelBookingAction, previewAdminCancelAction } from "./actions"

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

describe("previewAdminCancelAction (story 3.6)", () => {
  it("returns the server's plan, or its refusal code", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        pending_join: true,
        outcome: "pinned",
        product_name: "Single",
        within_window: true,
        expires_on: "2026-10-20",
        awaiting_sessions: false,
        options_count: 2,
      },
    })
    await expect(
      previewAdminCancelAction({ bookingId: BOOKING_ID })
    ).resolves.toEqual({
      ok: true,
      data: {
        ok: true,
        pendingJoin: true,
        customerName: null,
        outcome: "pinned",
        productName: "Single",
        withinWindow: true,
        expiresOn: "2026-10-20",
        awaitingSessions: false,
        optionsCount: 2,
      },
    })
    callRpc.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "MANUAL_HANDLING_REQUIRED" },
    })
    await expect(
      previewAdminCancelAction({ bookingId: BOOKING_ID })
    ).resolves.toEqual({
      ok: true,
      data: { ok: false, code: "MANUAL_HANDLING_REQUIRED" },
    })
  })
})

describe("adminCancelBookingAction (story 3.6)", () => {
  it("sends the confirmation, the key and a reason only when one was written", async () => {
    callRpc.mockResolvedValue({ ok: true, data: {} })
    await expect(
      adminCancelBookingAction({
        bookingId: BOOKING_ID,
        reason: "  ",
        confirmed: true,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_cancel_booking",
      {
        p_booking_id: BOOKING_ID,
        p_confirmed: true,
        p_idempotency_key: KEY,
        p_reason: undefined,
      }
    )
  })

  it("refuses malformed input without calling the RPC", async () => {
    for (const input of [
      { bookingId: "nope", reason: "", confirmed: true, idempotencyKey: KEY },
      {
        bookingId: BOOKING_ID,
        reason: "",
        confirmed: true,
        idempotencyKey: "x",
      },
      {
        bookingId: BOOKING_ID,
        reason: 5,
        confirmed: true,
        idempotencyKey: KEY,
      },
      {
        bookingId: BOOKING_ID,
        reason: "",
        confirmed: "yes",
        idempotencyKey: KEY,
      },
    ]) {
      await expect(
        adminCancelBookingAction(
          input as unknown as Parameters<typeof adminCancelBookingAction>[0]
        )
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })
})
