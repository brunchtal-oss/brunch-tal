import { beforeEach, describe, expect, it, vi } from "vitest"

import { addCustomerNoteAction, deleteCustomerNoteAction } from "./actions"

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
  callRpc.mockResolvedValue({ ok: true, data: { note_id: ID } })
})

describe("the customer card's note actions (story 4.2)", () => {
  it("send each RPC its arguments and return ok without data", async () => {
    await expect(
      addCustomerNoteAction({
        customerId: ID,
        body: "הערה",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_add_customer_note",
      { p_customer_id: ID, p_body: "הערה", p_idempotency_key: KEY }
    )

    // Sent trimmed of every whitespace, as checked.
    await addCustomerNoteAction({
      customerId: ID,
      body: "\n\tהערה\n",
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_add_customer_note",
      { p_customer_id: ID, p_body: "הערה", p_idempotency_key: KEY }
    )

    await expect(
      deleteCustomerNoteAction({ noteId: ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_delete_customer_note",
      { p_note_id: ID, p_idempotency_key: KEY }
    )
  })

  it("refuse a bad shape without calling the RPC", async () => {
    for (const input of [
      { customerId: "x", body: "הערה", idempotencyKey: KEY },
      { customerId: ID, body: "  ", idempotencyKey: KEY },
      { customerId: ID, body: "x".repeat(1001), idempotencyKey: KEY },
      { customerId: ID, body: "הערה", idempotencyKey: "nope" },
    ]) {
      await expect(addCustomerNoteAction(input)).resolves.toEqual(INVALID)
    }
    await expect(
      deleteCustomerNoteAction({ noteId: "x", idempotencyKey: KEY })
    ).resolves.toEqual(INVALID)
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("pass an RPC failure through", async () => {
    callRpc.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" })
    await expect(
      deleteCustomerNoteAction({ noteId: ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" })
  })
})
