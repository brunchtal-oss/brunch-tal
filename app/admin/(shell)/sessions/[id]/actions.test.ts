import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  adminCancelBookingAction,
  adminCancelEventAction,
  adminRescheduleEventAction,
  previewAdminCancelAction,
  previewCancelEventAction,
  previewRescheduleEventAction,
} from "./actions"

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
        outcome: "credit",
        funding: "pinned",
        product_name: "Single",
        within_window: false,
        choice_required: true,
        options_count: 2,
        amount_agorot: 12800,
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
        funding: "pinned",
        productName: "Single",
        withinWindow: false,
        choiceRequired: true,
        optionsCount: 2,
        amountAgorot: 12800,
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

  it("story 3.7: sends the refund-or-credit choice only when there is one", async () => {
    callRpc.mockResolvedValue({ ok: true, data: {} })
    await adminCancelBookingAction({
      bookingId: BOOKING_ID,
      reason: "",
      confirmed: true,
      idempotencyKey: KEY,
      choice: "refund",
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_cancel_booking",
      {
        p_booking_id: BOOKING_ID,
        p_confirmed: true,
        p_idempotency_key: KEY,
        p_reason: undefined,
        p_choice: "refund",
      }
    )
  })

  it("refuses malformed input without calling the RPC", async () => {
    for (const input of [
      {
        bookingId: BOOKING_ID,
        reason: "",
        confirmed: true,
        idempotencyKey: KEY,
        choice: "maybe",
      },
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

const EVENT_ID = "55555555-5555-4555-8555-555555555555"
const WHEN = { date: "2026-10-20", startTime: "11:00", endTime: "13:00" }

describe("the session's cancel and time change (story 3.8)", () => {
  it("previews the cancel and passes a refusal", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "EVENT_NOT_CANCELLABLE" },
    })
    await expect(
      previewCancelEventAction({ eventId: EVENT_ID })
    ).resolves.toEqual({
      ok: true,
      data: { ok: false, code: "EVENT_NOT_CANCELLABLE", field: null },
    })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "preview_admin_cancel_event",
      { p_event_id: EVENT_ID }
    )
  })

  it("cancels with the message and the key; returns how many were notified", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { event_id: EVENT_ID, cancelled: 3, notified: 2 },
    })
    await expect(
      adminCancelEventAction({
        eventId: EVENT_ID,
        message: "Body",
        confirmed: true,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: { notified: 2 } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_cancel_event",
      {
        p_event_id: EVENT_ID,
        p_confirmed: true,
        p_message: "Body",
        p_idempotency_key: KEY,
        p_parked_acknowledged: false,
      }
    )
    await adminCancelEventAction({
      eventId: EVENT_ID,
      message: "Body",
      confirmed: true,
      parkedAcknowledged: true,
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_cancel_event",
      expect.objectContaining({ p_parked_acknowledged: true })
    )
  })

  it("an empty or too long message is INVALID_INPUT without a call", async () => {
    for (const message of ["   ", "x".repeat(1001)]) {
      await expect(
        adminCancelEventAction({
          eventId: EVENT_ID,
          message,
          confirmed: true,
          idempotencyKey: KEY,
        })
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("the time change sends the local date and times in Jerusalem's zone (the database converts)", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { ok: true, booking_count: 1 },
    })
    await previewRescheduleEventAction({ eventId: EVENT_ID, ...WHEN })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "preview_admin_reschedule_event",
      {
        p_event_id: EVENT_ID,
        p_starts_at: "2026-10-20 11:00:00 Asia/Jerusalem",
        p_ends_at: "2026-10-20 13:00:00 Asia/Jerusalem",
      }
    )
    callRpc.mockResolvedValue({ ok: true, data: { notified: 10 } })
    await expect(
      adminRescheduleEventAction({
        eventId: EVENT_ID,
        ...WHEN,
        message: "Moved",
        confirmed: true,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: { notified: 10 } })
    await expect(
      adminRescheduleEventAction({
        eventId: EVENT_ID,
        ...WHEN,
        startTime: "25:00",
        message: "Moved",
        confirmed: true,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
  })
})
