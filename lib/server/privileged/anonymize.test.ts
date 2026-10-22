import { beforeEach, describe, expect, it, vi } from "vitest"

import { anonymizeCustomer } from "./anonymize"

// Tal's session (the two RPCs) and the service role (the Auth delete).
const rpc = vi.fn()
const deleteUser = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: unknown) => rpc(name, args),
  }),
}))
vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({ auth: { admin: { deleteUser } } }),
}))
const deleteOrphanUser = vi.fn()
vi.mock("@/lib/server/privileged/join", () => ({
  deleteOrphanUser: (...args: unknown[]) => deleteOrphanUser(...args),
}))

const CUSTOMER = "11111111-1111-4111-8111-111111111111"
const KEY = "22222222-2222-4222-8222-222222222222"
const ORPHAN = "33333333-3333-4333-8333-333333333333"

function rpcAnswers(answers: Record<string, unknown>) {
  rpc.mockImplementation(async (name: string) => ({
    data: answers[name],
    error: null,
  }))
}

const calledRpcs = () => rpc.mock.calls.map((call) => call[0])

beforeEach(() => {
  rpc.mockReset()
  deleteUser.mockReset()
  deleteOrphanUser.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("anonymizeCustomer", () => {
  it("story 5.20: the Auth users of her revoked claiming links are deleted; a bad id or her own is skipped", async () => {
    rpcAnswers({
      admin_anonymize_customer: {
        result: "pending",
        user_id: CUSTOMER,
        orphan_user_ids: [ORPHAN, CUSTOMER, "not-a-uuid", 7],
      },
      admin_finish_anonymize_customer: { result: "done" },
    })
    deleteUser.mockResolvedValue({ data: {}, error: null })
    // A failed orphan deletion is only logged; the removal goes on.
    deleteOrphanUser.mockResolvedValue(false)

    await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual({
      ok: true,
      data: undefined,
    })
    expect(deleteOrphanUser).toHaveBeenCalledTimes(1)
    expect(deleteOrphanUser.mock.calls[0][1]).toBe(ORPHAN)
    // No token id to log (not the customer id).
    expect(deleteOrphanUser.mock.calls[0][2]).toBeNull()
    expect(deleteUser).toHaveBeenCalledWith(CUSTOMER)
  })

  it("an orphan deletion that throws is logged; the removal goes on", async () => {
    rpcAnswers({
      admin_anonymize_customer: {
        result: "pending",
        user_id: CUSTOMER,
        orphan_user_ids: [ORPHAN],
      },
      admin_finish_anonymize_customer: { result: "done" },
    })
    deleteUser.mockResolvedValue({ data: {}, error: null })
    deleteOrphanUser.mockRejectedValue(new Error("network"))
    await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual({
      ok: true,
      data: undefined,
    })
    expect(console.error).toHaveBeenCalledWith(
      "anonymize.delete_orphan_failed",
      { customerId: CUSTOMER }
    )
    expect(deleteUser).toHaveBeenCalledWith(CUSTOMER)
  })

  it("no orphan_user_ids: nothing extra is deleted", async () => {
    rpcAnswers({
      admin_anonymize_customer: { result: "pending", user_id: CUSTOMER },
      admin_finish_anonymize_customer: { result: "done" },
    })
    deleteUser.mockResolvedValue({ data: {}, error: null })
    await anonymizeCustomer(CUSTOMER, KEY)
    expect(deleteOrphanUser).not.toHaveBeenCalled()
  })

  it("step 1 (confirmed, the screen's key) -> deleteUser -> finish with a fresh key", async () => {
    rpcAnswers({
      admin_anonymize_customer: { result: "pending", user_id: CUSTOMER },
      admin_finish_anonymize_customer: { result: "done" },
    })
    deleteUser.mockResolvedValue({ data: {}, error: null })

    await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual({
      ok: true,
      data: undefined,
    })
    expect(rpc.mock.calls[0][1]).toEqual({
      p_customer_id: CUSTOMER,
      p_confirmed: true,
      p_idempotency_key: KEY,
    })
    expect(deleteUser).toHaveBeenCalledWith(CUSTOMER)
    expect(rpc.mock.calls[1][0]).toBe("admin_finish_anonymize_customer")
    expect(rpc.mock.calls[1][1].p_customer_id).toBe(CUSTOMER)
    expect(rpc.mock.calls[1][1].p_idempotency_key).not.toBe(KEY)
  })

  it.each([
    { status: 404, code: undefined },
    { status: 400, code: "user_not_found" },
  ])(
    "an Auth user already gone ($status $code) counts as deleted",
    async (error) => {
      rpcAnswers({
        admin_anonymize_customer: { result: "pending", user_id: CUSTOMER },
        admin_finish_anonymize_customer: { result: "done" },
      })
      deleteUser.mockResolvedValue({ data: null, error })

      await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual({
        ok: true,
        data: undefined,
      })
      expect(calledRpcs()).toEqual([
        "admin_anonymize_customer",
        "admin_finish_anonymize_customer",
      ])
    }
  )

  it("already removed and closed (done): no Auth call, no finish", async () => {
    rpcAnswers({ admin_anonymize_customer: { result: "done" } })

    await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual({
      ok: true,
      data: undefined,
    })
    expect(deleteUser).not.toHaveBeenCalled()
    expect(calledRpcs()).toEqual(["admin_anonymize_customer"])
  })

  it("a blocked removal returns the RPC's code; Auth is never called", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "ANONYMIZE_BLOCKED" },
    })

    await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual(
      expect.objectContaining({ ok: false, code: "ANONYMIZE_BLOCKED" })
    )
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it("an Auth failure stays pending: SERVER_ERROR, no finish, ids and codes only in the log", async () => {
    rpcAnswers({
      admin_anonymize_customer: { result: "pending", user_id: CUSTOMER },
    })
    deleteUser.mockResolvedValue({
      data: null,
      error: { status: 500, code: "unexpected_failure" },
    })

    await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(calledRpcs()).toEqual(["admin_anonymize_customer"])
    expect(vi.mocked(console.error).mock.calls).toEqual([
      [
        "anonymize.delete_user_failed",
        { customerId: CUSTOMER, authCode: "unexpected_failure" },
      ],
    ])
  })

  it("a thrown Auth call is a failure too", async () => {
    rpcAnswers({
      admin_anonymize_customer: { result: "pending", user_id: CUSTOMER },
    })
    deleteUser.mockRejectedValue(new Error("network"))

    await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })

  it("finish fails (the Auth user still exists): SERVER_ERROR", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "admin_anonymize_customer"
        ? { data: { result: "pending", user_id: CUSTOMER }, error: null }
        : {
            data: null,
            error: { code: "P0001", message: "CONCURRENT_CHANGE" },
          }
    )
    deleteUser.mockResolvedValue({ data: {}, error: null })

    await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })

  it("finish answers not_pending (closed meanwhile): ok", async () => {
    rpcAnswers({
      admin_anonymize_customer: { result: "pending", user_id: CUSTOMER },
      admin_finish_anonymize_customer: { result: "not_pending" },
    })
    deleteUser.mockResolvedValue({ data: {}, error: null })

    await expect(anonymizeCustomer(CUSTOMER, KEY)).resolves.toEqual({
      ok: true,
      data: undefined,
    })
  })
})
