import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  addCustomerNoteAction,
  changeEmailAction,
  changePhoneAction,
  deleteCustomerNoteAction,
  issueResetLinkAction,
} from "./actions"

const callRpc = vi.fn()
const changeEmail = vi.fn()
const resetLinkFor = vi.fn(
  async (token: string) => `https://site.test/reset/${token}`
)

vi.mock("@/lib/server/privileged/account", () => ({
  changeEmail: (...args: unknown[]) => changeEmail(...args),
}))
vi.mock("@/lib/server/join-link", () => ({
  resetLinkFor: (token: string) => resetLinkFor(token),
}))

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

describe("the account section's actions (story 2.8)", () => {
  it("changeEmailAction checks the shape and hands over to changeEmail", async () => {
    changeEmail.mockResolvedValue({ ok: true, data: undefined })
    await expect(
      changeEmailAction({
        customerId: ID,
        email: "new@example.test",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(changeEmail).toHaveBeenLastCalledWith(ID, "new@example.test", KEY)

    changeEmail.mockClear()
    for (const input of [
      { customerId: "x", email: "a@b.co", idempotencyKey: KEY },
      { customerId: ID, email: "  ", idempotencyKey: KEY },
      { customerId: ID, email: `${"a".repeat(250)}@b.co`, idempotencyKey: KEY },
      { customerId: ID, email: "a@b.co", idempotencyKey: "x" },
    ]) {
      await expect(changeEmailAction(input)).resolves.toEqual(INVALID)
    }
    expect(changeEmail).not.toHaveBeenCalled()
  })

  it("changePhoneAction: changed is ok, taken is PHONE_TAKEN, codes pass through", async () => {
    callRpc.mockResolvedValueOnce({ ok: true, data: { result: "changed" } })
    await expect(
      changePhoneAction({
        customerId: ID,
        phone: " 052-765-4321 ",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_change_phone",
      { p_customer_id: ID, p_phone: "052-765-4321", p_idempotency_key: KEY }
    )

    callRpc.mockResolvedValueOnce({ ok: true, data: { result: "taken" } })
    await expect(
      changePhoneAction({
        customerId: ID,
        phone: "0527654321",
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "PHONE_TAKEN" })

    callRpc.mockResolvedValueOnce({ ok: false, code: "INVALID_PHONE" })
    await expect(
      changePhoneAction({ customerId: ID, phone: "12", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "INVALID_PHONE" })

    await expect(
      changePhoneAction({ customerId: ID, phone: "", idempotencyKey: KEY })
    ).resolves.toEqual(INVALID)
  })

  it("issueResetLinkAction returns the link once, and null on a repeat", async () => {
    callRpc.mockResolvedValueOnce({
      ok: true,
      data: {
        token: "raw",
        token_id: ID,
        link_expires_at: "2026-10-16T07:00:00Z",
      },
    })
    await expect(
      issueResetLinkAction({ customerId: ID, idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: true,
      data: {
        link: "https://site.test/reset/raw",
        linkExpiresAt: "2026-10-16T07:00:00Z",
      },
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_issue_link",
      { p_purpose: "reset", p_target_id: ID, p_idempotency_key: KEY }
    )

    callRpc.mockResolvedValueOnce({
      ok: true,
      data: {
        token_id: ID,
        link_expires_at: "2026-10-16T07:00:00Z",
        reissue_required: true,
      },
    })
    await expect(
      issueResetLinkAction({ customerId: ID, idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: true,
      data: { link: null, linkExpiresAt: "2026-10-16T07:00:00Z" },
    })

    callRpc.mockResolvedValueOnce({ ok: false, code: "RESET_TARGET_INVALID" })
    await expect(
      issueResetLinkAction({ customerId: ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "RESET_TARGET_INVALID" })
  })
})
