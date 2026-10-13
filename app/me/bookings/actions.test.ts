import { beforeEach, describe, expect, it, vi } from "vitest"

import { cancelBookingAction, setGuestDetailsAction } from "./actions"

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

describe("setGuestDetailsAction (story 3.5)", () => {
  it("saves the note with the customer's session and the sheet's key", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { booking_id: BOOKING_ID, guest_details: "צמחונית" },
    })
    await expect(
      setGuestDetailsAction({
        bookingId: BOOKING_ID,
        guestDetails: "צמחונית ",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: { guestDetails: "צמחונית" } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "set_booking_guest_details",
      {
        p_booking_id: BOOKING_ID,
        p_guest_details: "צמחונית ",
        p_idempotency_key: KEY,
      }
    )
  })

  it("a cleared note comes back as null", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { booking_id: BOOKING_ID, guest_details: null },
    })
    await expect(
      setGuestDetailsAction({
        bookingId: BOOKING_ID,
        guestDetails: "  ",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: { guestDetails: null } })
  })

  it("refuses malformed input or more than 1000 characters without calling the RPC", async () => {
    for (const input of [
      { bookingId: "nope", guestDetails: "x", idempotencyKey: KEY },
      { bookingId: BOOKING_ID, guestDetails: "x", idempotencyKey: "nope" },
      { bookingId: BOOKING_ID, guestDetails: 5, idempotencyKey: KEY },
      null,
    ]) {
      await expect(
        setGuestDetailsAction(
          input as unknown as Parameters<typeof setGuestDetailsAction>[0]
        )
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    await expect(
      setGuestDetailsAction({
        bookingId: BOOKING_ID,
        guestDetails: "א".repeat(1001),
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "guest_details" },
    })
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC's code through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "REGISTRATION_CLOSED" })
    await expect(
      setGuestDetailsAction({
        bookingId: BOOKING_ID,
        guestDetails: "x",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "REGISTRATION_CLOSED" })
  })
})
