import { beforeEach, describe, expect, it, vi } from "vitest"

import { bookSessionAction, bookSessionsAction } from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const EVENT_ID = "11111111-1111-4111-8111-111111111111"
const KEY = "22222222-2222-4222-8222-222222222222"
const BOOKING_ID = "33333333-3333-4333-8333-333333333333"

beforeEach(() => {
  callRpc.mockReset()
})

describe("bookSessionAction", () => {
  it("books with the customer's session and the sheet's key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { booking_id: BOOKING_ID } })
    await expect(
      bookSessionAction({ eventId: EVENT_ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { bookingId: BOOKING_ID } })
    expect(callRpc).toHaveBeenCalledWith({ session: true }, "book_session", {
      p_event_id: EVENT_ID,
      p_idempotency_key: KEY,
    })
  })

  it("refuses malformed input without calling the RPC", async () => {
    for (const input of [
      { eventId: "nope", idempotencyKey: KEY },
      { eventId: EVENT_ID, idempotencyKey: "nope" },
      { eventId: 5, idempotencyKey: KEY },
      null,
    ]) {
      await expect(
        bookSessionAction(
          input as unknown as { eventId: string; idempotencyKey: string }
        )
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC's code through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "EVENT_FULL" })
    await expect(
      bookSessionAction({ eventId: EVENT_ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "EVENT_FULL" })
  })
})

describe("bookSessionsAction", () => {
  const OTHER = "44444444-4444-4444-8444-444444444444"

  it("books the dates with the customer's session and the sheet's key, and returns the RPC's results", async () => {
    const results = { results: [{ event_id: EVENT_ID, ok: true }] }
    callRpc.mockResolvedValue({ ok: true, data: results })
    await expect(
      bookSessionsAction({ eventIds: [EVENT_ID, OTHER], idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: results })
    expect(callRpc).toHaveBeenCalledWith({ session: true }, "book_sessions", {
      p_items: [EVENT_ID, OTHER],
      p_idempotency_key: KEY,
    })
  })

  it("refuses an empty list, more than 20, a duplicate, a bad id or key without calling the RPC", async () => {
    for (const input of [
      { eventIds: [], idempotencyKey: KEY },
      {
        eventIds: Array.from(
          { length: 21 },
          (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`
        ),
        idempotencyKey: KEY,
      },
      { eventIds: [EVENT_ID, EVENT_ID.toUpperCase()], idempotencyKey: KEY },
      { eventIds: ["nope"], idempotencyKey: KEY },
      { eventIds: [5], idempotencyKey: KEY },
      { eventIds: EVENT_ID, idempotencyKey: KEY },
      { eventIds: [EVENT_ID], idempotencyKey: "nope" },
      null,
    ]) {
      await expect(
        bookSessionsAction(
          input as unknown as { eventIds: string[]; idempotencyKey: string }
        ),
        JSON.stringify(input)
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC's code through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "NOT_AUTHORIZED" })
    await expect(
      bookSessionsAction({ eventIds: [EVENT_ID], idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "NOT_AUTHORIZED" })
  })
})
