import { beforeEach, describe, expect, it, vi } from "vitest"

import { cancelBookingAction, chooseCreditOutcomeAction } from "./actions"

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
      data: { booking_id: BOOKING_ID, outcome: "card", entitlement_id: "e1" },
    })
    await expect(
      cancelBookingAction({ bookingId: BOOKING_ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { outcome: "card" } })
    expect(callRpc).toHaveBeenCalledWith({ session: true }, "cancel_booking", {
      p_booking_id: BOOKING_ID,
      p_idempotency_key: KEY,
    })
  })

  it("story 3.7: sends the choice of a pinned booking", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { booking_id: BOOKING_ID, outcome: "refund", credit_id: "c1" },
    })
    await expect(
      cancelBookingAction({
        bookingId: BOOKING_ID,
        idempotencyKey: KEY,
        choice: "refund",
      })
    ).resolves.toEqual({ ok: true, data: { outcome: "refund" } })
    expect(callRpc).toHaveBeenCalledWith({ session: true }, "cancel_booking", {
      p_booking_id: BOOKING_ID,
      p_idempotency_key: KEY,
      p_choice: "refund",
    })
  })

  it("refuses malformed input without calling the RPC", async () => {
    for (const input of [
      { bookingId: "nope", idempotencyKey: KEY },
      { bookingId: BOOKING_ID, idempotencyKey: "nope" },
      { bookingId: 5, idempotencyKey: KEY },
      { bookingId: BOOKING_ID, idempotencyKey: KEY, choice: "maybe" },
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

describe("chooseCreditOutcomeAction (story 3.8)", () => {
  it("sends her choice with the sheet's key; a refusal passes its code", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { credit_id: BOOKING_ID, outcome: "refund" },
    })
    await expect(
      chooseCreditOutcomeAction({
        creditId: BOOKING_ID,
        choice: "refund",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: { outcome: "refund" } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "choose_credit_outcome",
      { p_credit_id: BOOKING_ID, p_choice: "refund", p_idempotency_key: KEY }
    )
    callRpc.mockResolvedValue({ ok: false, code: "CHOICE_NOT_PENDING" })
    await expect(
      chooseCreditOutcomeAction({
        creditId: BOOKING_ID,
        choice: "credit",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "CHOICE_NOT_PENDING" })
  })

  it("a bad shape is INVALID_INPUT without a call", async () => {
    await expect(
      chooseCreditOutcomeAction({
        creditId: "x",
        choice: "credit",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    await expect(
      chooseCreditOutcomeAction({
        creditId: BOOKING_ID,
        choice: "other" as "credit",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })
})
