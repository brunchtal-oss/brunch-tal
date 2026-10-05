import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  adminBookCustomerAction,
  createEventAction,
  duplicateEventAction,
  previewAdminBookAction,
  publishEventAction,
  updateEventAction,
} from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const EVENT_ID = "11111111-1111-4111-8111-111111111111"
const KEY = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  callRpc.mockReset()
})

describe("createEventAction", () => {
  it("creates with the admin's session and the form's key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { event_id: EVENT_ID } })
    const event = { concept_id: EVENT_ID, date: "2026-12-15" }
    await expect(
      createEventAction({ event, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { eventId: EVENT_ID } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_create_event",
      { p_event: event, p_idempotency_key: KEY }
    )
  })

  it("refuses a bad key or an empty event without calling the RPC", async () => {
    for (const input of [
      { event: { date: "x" }, idempotencyKey: "nope" },
      { event: {}, idempotencyKey: KEY },
    ]) {
      await expect(createEventAction(input)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC's code and detail through", async () => {
    callRpc.mockResolvedValue({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "end_time" },
    })
    await expect(
      createEventAction({ event: { end_time: "09:00" }, idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "end_time" },
    })
  })
})

describe("updateEventAction", () => {
  it("sends the changes", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { event_id: EVENT_ID } })
    await expect(
      updateEventAction({
        eventId: EVENT_ID,
        changes: { capacity_adults: 13 },
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_update_event",
      {
        p_event_id: EVENT_ID,
        p_changes: { capacity_adults: 13 },
        p_idempotency_key: KEY,
      }
    )
  })

  it("never sends a concept change", async () => {
    await expect(
      updateEventAction({
        eventId: EVENT_ID,
        changes: { concept_id: EVENT_ID },
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })
})

describe("publishEventAction", () => {
  it("publishes with the key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { event_id: EVENT_ID } })
    await expect(
      publishEventAction({ eventId: EVENT_ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_publish_event",
      { p_event_id: EVENT_ID, p_idempotency_key: KEY }
    )
  })
})

describe("duplicateEventAction", () => {
  it("sends the new local date and times and returns the new draft", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { event_id: KEY } })
    await expect(
      duplicateEventAction({
        eventId: EVENT_ID,
        date: "2027-01-05",
        startTime: "09:30",
        endTime: "11:30",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: { eventId: KEY } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_duplicate_event",
      {
        p_event_id: EVENT_ID,
        p_date: "2027-01-05",
        p_start_time: "09:30",
        p_end_time: "11:30",
        p_idempotency_key: KEY,
      }
    )
  })

  it("refuses a bad date or time without calling the RPC", async () => {
    await expect(
      duplicateEventAction({
        eventId: EVENT_ID,
        date: "05.01.2027",
        startTime: "9:30",
        endTime: "11:30",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })
})

const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333"

describe("adminBookCustomerAction (story 3.4)", () => {
  it("books with the admin's session and the screen's key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { booking_id: "b1" } })
    await expect(
      adminBookCustomerAction({
        customerId: CUSTOMER_ID,
        eventId: EVENT_ID,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: { bookingId: "b1" } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_book_customer",
      {
        p_customer_id: CUSTOMER_ID,
        p_event_id: EVENT_ID,
        p_idempotency_key: KEY,
      }
    )
  })

  it("refuses a bad id or key without calling the RPC", async () => {
    for (const input of [
      { customerId: "x", eventId: EVENT_ID, idempotencyKey: KEY },
      { customerId: CUSTOMER_ID, eventId: "x", idempotencyKey: KEY },
      { customerId: CUSTOMER_ID, eventId: EVENT_ID, idempotencyKey: "x" },
    ]) {
      await expect(adminBookCustomerAction(input)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC's code through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "EVENT_FULL" })
    await expect(
      adminBookCustomerAction({
        customerId: CUSTOMER_ID,
        eventId: EVENT_ID,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "EVENT_FULL" })
  })
})

describe("previewAdminBookAction (story 3.4)", () => {
  it("returns the parsed preview", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "EVENT_FULL", occupied: 12, capacity: 12 },
    })
    await expect(
      previewAdminBookAction({ customerId: CUSTOMER_ID, eventId: EVENT_ID })
    ).resolves.toEqual({
      ok: true,
      data: { ok: false, code: "EVENT_FULL", occupied: 12, capacity: 12 },
    })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "preview_admin_book_customer",
      { p_customer_id: CUSTOMER_ID, p_event_id: EVENT_ID }
    )
  })

  it("refuses a bad id without calling the RPC", async () => {
    await expect(
      previewAdminBookAction({ customerId: "x", eventId: EVENT_ID })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })
})
