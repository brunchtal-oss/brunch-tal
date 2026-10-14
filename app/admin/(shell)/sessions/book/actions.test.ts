import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminBookSessionsAction } from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const CUSTOMER = "11111111-1111-4111-8111-111111111111"
const id = (n: number) =>
  `${String(n).padStart(8, "0")}-2222-4222-8222-222222222222`
const key = (n: number) =>
  `${String(n).padStart(8, "0")}-3333-4333-8333-333333333333`
const item = (n: number) => ({ eventId: id(n), idempotencyKey: key(n) })

beforeEach(() => {
  callRpc.mockReset()
})

describe("adminBookSessionsAction", () => {
  it("books the dates one after another, each with its own key; a refusal does not stop the others", async () => {
    callRpc
      .mockResolvedValueOnce({ ok: true, data: { booking_id: "b1" } })
      .mockResolvedValueOnce({ ok: false, code: "EVENT_FULL" })
      .mockResolvedValueOnce({ ok: true, data: { booking_id: "b3" } })

    await expect(
      adminBookSessionsAction({
        customerId: CUSTOMER,
        items: [item(1), item(2), item(3)],
      })
    ).resolves.toEqual({
      ok: true,
      data: {
        results: [
          { event_id: id(1), ok: true, code: null, booking_id: "b1" },
          { event_id: id(2), ok: false, code: "EVENT_FULL", booking_id: null },
          { event_id: id(3), ok: true, code: null, booking_id: "b3" },
        ],
      },
    })
    expect(callRpc.mock.calls.map((call) => call.slice(1))).toEqual(
      [1, 2, 3].map((n) => [
        "admin_book_customer",
        {
          p_customer_id: CUSTOMER,
          p_event_id: id(n),
          p_idempotency_key: key(n),
        },
      ])
    )
  })

  it("refuses a bad shape without booking anything", async () => {
    const twentyOne = Array.from({ length: 21 }, (_, i) => item(i + 1))
    for (const input of [
      { customerId: CUSTOMER, items: [] },
      { customerId: CUSTOMER, items: twentyOne },
      { customerId: CUSTOMER, items: [item(1), item(1)] },
      {
        customerId: CUSTOMER,
        items: [item(1), { eventId: id(2), idempotencyKey: key(1) }],
      },
      {
        customerId: CUSTOMER,
        items: [{ eventId: "x", idempotencyKey: key(1) }],
      },
      {
        customerId: CUSTOMER,
        items: [{ eventId: id(1), idempotencyKey: "x" }],
      },
      { customerId: "nope", items: [item(1)] },
      { customerId: CUSTOMER, items: "x" },
    ]) {
      await expect(adminBookSessionsAction(input as never)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("twenty dates is the limit", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { booking_id: "b" } })
    const twenty = Array.from({ length: 20 }, (_, i) => item(i + 1))
    const result = await adminBookSessionsAction({
      customerId: CUSTOMER,
      items: twenty,
    })
    expect(result.ok).toBe(true)
    expect(callRpc).toHaveBeenCalledTimes(20)
  })
})
