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

const CUSTOMER = "11111111-1111-4111-8111-111111111111"
const KEY = "22222222-2222-4222-8222-222222222222"

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
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("anonymizeCustomer", () => {
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
