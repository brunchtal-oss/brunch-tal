import { beforeEach, describe, expect, it, vi } from "vitest"

import { changeEmail, changeOwnEmail } from "./account"

// Tal's session (her two RPCs) and the service role (the Auth update; the
// customer's own two RPCs since story 6.11 round 2). sessionRpc / serviceRpc
// record which client called which RPC; rpc answers both.
const rpc = vi.fn()
const sessionRpc = vi.fn()
const serviceRpc = vi.fn()
const updateUserById = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string, args: unknown) => {
      sessionRpc(name)
      return rpc(name, args)
    },
  }),
}))
// Story 6.11: the current password of a self change.
const checkPassword = vi.fn()
vi.mock("@/lib/server/privileged/email-auth", () => ({
  checkPassword: (...args: unknown[]) => checkPassword(...args),
}))
vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({
    auth: { admin: { updateUserById } },
    rpc: (name: string, args: unknown) => {
      serviceRpc(name)
      return rpc(name, args)
    },
  }),
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
  sessionRpc.mockReset()
  serviceRpc.mockReset()
  updateUserById.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("changeEmail", () => {
  it("begin -> Auth with the normalized address -> finish(true)", async () => {
    rpcAnswers({
      admin_begin_email_change: { result: "pending", user_id: CUSTOMER },
      admin_finish_email_change: { result: "changed" },
    })
    updateUserById.mockResolvedValue({ data: { user: {} }, error: null })

    await expect(
      changeEmail(CUSTOMER, " New@Example.com ", KEY)
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(rpc.mock.calls[0][1]).toEqual({
      p_customer_id: CUSTOMER,
      p_email: "new@example.com",
      p_idempotency_key: KEY,
    })
    expect(updateUserById).toHaveBeenCalledWith(CUSTOMER, {
      email: "new@example.com",
      email_confirm: true,
    })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_succeeded: true })
  })

  it("taken at begin: EMAIL_TAKEN, Auth is never called", async () => {
    rpcAnswers({ admin_begin_email_change: { result: "taken" } })

    await expect(changeEmail(CUSTOMER, "a@example.com", KEY)).resolves.toEqual({
      ok: false,
      code: "EMAIL_TAKEN",
    })
    expect(updateUserById).not.toHaveBeenCalled()
    expect(calledRpcs()).toEqual(["admin_begin_email_change"])
  })

  it("Auth's email_exists: finish(false) closes the intent, EMAIL_TAKEN", async () => {
    rpcAnswers({
      admin_begin_email_change: { result: "pending", user_id: CUSTOMER },
      admin_finish_email_change: { result: "taken" },
    })
    updateUserById.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422 },
    })

    await expect(changeEmail(CUSTOMER, "a@example.com", KEY)).resolves.toEqual({
      ok: false,
      code: "EMAIL_TAKEN",
    })
    expect(rpc.mock.calls[1]).toEqual([
      "admin_finish_email_change",
      expect.objectContaining({ p_succeeded: false }),
    ])
  })

  it.each(["email_address_invalid", "validation_failed"])(
    "Auth refuses the address (%s): finish(false) closes the intent, INVALID_INPUT",
    async (code) => {
      rpcAnswers({
        admin_begin_email_change: { result: "pending", user_id: CUSTOMER },
        admin_finish_email_change: { result: "taken" },
      })
      updateUserById.mockResolvedValue({
        data: { user: null },
        error: { code, status: 400 },
      })

      await expect(
        changeEmail(CUSTOMER, "bad@example.com", KEY)
      ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
      expect(calledRpcs()).toEqual([
        "admin_begin_email_change",
        "admin_finish_email_change",
      ])
      expect(rpc.mock.calls[1][1]).toMatchObject({ p_succeeded: false })
    }
  )

  it("finish fails after Auth took the address: SERVER_ERROR", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "admin_begin_email_change"
        ? { data: { result: "pending", user_id: CUSTOMER }, error: null }
        : {
            data: null,
            error: { code: "P0001", message: "CONCURRENT_CHANGE" },
          }
    )
    updateUserById.mockResolvedValue({ data: { user: {} }, error: null })

    await expect(
      changeEmail(CUSTOMER, "new@example.com", KEY)
    ).resolves.toEqual({ ok: false, code: "SERVER_ERROR" })
    expect(calledRpcs()).toEqual([
      "admin_begin_email_change",
      "admin_finish_email_change",
    ])
  })

  it("another Auth failure keeps the state (resumable) and logs no address", async () => {
    rpcAnswers({
      admin_begin_email_change: { result: "pending", user_id: CUSTOMER },
    })
    updateUserById.mockRejectedValue(new Error("network"))

    await expect(
      changeEmail(CUSTOMER, "secret@example.com", KEY)
    ).resolves.toEqual({ ok: false, code: "SERVER_ERROR" })
    expect(calledRpcs()).toEqual(["admin_begin_email_change"])
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logged).toContain("account.email_update_failed")
    expect(logged).not.toContain("secret@example.com")
  })
})

describe("changeOwnEmail (story 6.11)", () => {
  const input = {
    userId: CUSTOMER,
    currentEmail: "old@example.com",
    email: "New@Example.com",
    password: "Current-pass-1",
  }

  beforeEach(() => {
    checkPassword.mockReset()
  })

  it.each([
    ["wrong", "WRONG_PASSWORD"],
    ["limited", "TOO_MANY_ATTEMPTS"],
    ["failed", "SERVER_ERROR"],
  ])("password check %s: %s before any RPC", async (check, code) => {
    checkPassword.mockResolvedValue(check)
    await expect(changeOwnEmail(input, KEY)).resolves.toEqual({
      ok: false,
      code,
    })
    expect(checkPassword).toHaveBeenCalledWith(
      "old@example.com",
      "Current-pass-1"
    )
    expect(rpc).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it("afterPasswordCheck: never on a wrong password; after a good one, before the change; its failure stops it", async () => {
    const step = vi.fn(async () => ({ ok: true as const, data: undefined }))
    checkPassword.mockResolvedValue("wrong")
    await changeOwnEmail(input, KEY, step)
    expect(step).not.toHaveBeenCalled()

    checkPassword.mockResolvedValue("ok")
    step.mockResolvedValueOnce({
      ok: false,
      code: "NOT_AUTHORIZED",
    } as never)
    await expect(changeOwnEmail(input, KEY, step)).resolves.toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
      stage: "details",
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it("the same pipeline with her own RPCs, as the service role with her id", async () => {
    checkPassword.mockResolvedValue("ok")
    rpcAnswers({
      begin_my_email_change: { result: "pending", user_id: CUSTOMER },
      finish_my_email_change: { result: "changed" },
    })
    updateUserById.mockResolvedValue({ data: { user: {} }, error: null })

    await expect(changeOwnEmail(input, KEY)).resolves.toEqual({
      ok: true,
      data: undefined,
    })
    expect(rpc.mock.calls[0]).toEqual([
      "begin_my_email_change",
      {
        p_user_id: CUSTOMER,
        p_email: "new@example.com",
        p_idempotency_key: KEY,
      },
    ])
    expect(updateUserById).toHaveBeenCalledWith(CUSTOMER, {
      email: "new@example.com",
      email_confirm: true,
    })
    expect(rpc.mock.calls[1][0]).toBe("finish_my_email_change")
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_user_id: CUSTOMER,
      p_succeeded: true,
    })
    // Never through her session: a held session alone cannot begin.
    expect(sessionRpc).not.toHaveBeenCalled()
    expect(serviceRpc.mock.calls.map((c) => c[0])).toEqual([
      "begin_my_email_change",
      "finish_my_email_change",
    ])
  })

  it("taken: EMAIL_TAKEN, Auth is never called", async () => {
    checkPassword.mockResolvedValue("ok")
    rpcAnswers({ begin_my_email_change: { result: "taken" } })
    await expect(changeOwnEmail(input, KEY)).resolves.toEqual({
      ok: false,
      code: "EMAIL_TAKEN",
    })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it.each(["ACCOUNT_CHANGE_BLOCKED", "EMAIL_UNCHANGED", "NOT_AUTHORIZED"])(
    "a %s refusal of begin passes through, Auth is never called",
    async (code) => {
      checkPassword.mockResolvedValue("ok")
      rpc.mockResolvedValue({
        data: null,
        error: { code: "P0001", message: code },
      })
      await expect(changeOwnEmail(input, KEY)).resolves.toMatchObject({
        ok: false,
        code,
      })
      expect(updateUserById).not.toHaveBeenCalled()
    }
  )

  it("Auth's email_exists: finish(false) closes her intent, EMAIL_TAKEN", async () => {
    checkPassword.mockResolvedValue("ok")
    rpcAnswers({
      begin_my_email_change: { result: "pending", user_id: CUSTOMER },
      finish_my_email_change: { result: "taken" },
    })
    updateUserById.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422 },
    })
    await expect(changeOwnEmail(input, KEY)).resolves.toEqual({
      ok: false,
      code: "EMAIL_TAKEN",
    })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_succeeded: false })
  })

  it("another Auth failure leaves it pending (Tal's stuck item), SERVER_ERROR", async () => {
    checkPassword.mockResolvedValue("ok")
    rpcAnswers({
      begin_my_email_change: { result: "pending", user_id: CUSTOMER },
    })
    updateUserById.mockRejectedValue(new Error("network"))
    await expect(changeOwnEmail(input, KEY)).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["begin_my_email_change"])
  })
})
