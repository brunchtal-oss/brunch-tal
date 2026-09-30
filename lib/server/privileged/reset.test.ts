import { beforeEach, describe, expect, it, vi } from "vitest"

import { completeReset, getResetTokenView } from "./reset"

const rpc = vi.fn()
const updateUserById = vi.fn()

vi.mock("@/lib/server/privileged/service-client", () => ({
  createServiceClient: () => ({ rpc, auth: { admin: { updateUserById } } }),
}))

const TOKEN = "t".repeat(43)
const USER_ID = "11111111-1111-1111-1111-111111111111"
const p0001 = (code: string) => ({ code: "P0001", message: code })

beforeEach(() => {
  rpc.mockReset()
  updateUserById.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("getResetTokenView", () => {
  const view = (state_public: string, purpose: string | null = "reset") => ({
    data: { state_public, purpose },
    error: null,
  })

  it("calls token_view with the raw token", async () => {
    rpc.mockResolvedValue(view("active"))
    await getResetTokenView(TOKEN)
    expect(rpc).toHaveBeenCalledWith("token_view", { p_token: TOKEN })
  })

  it.each([
    ["active", "active"],
    ["used", "used"],
    ["expired", "expired"],
    ["conflict", "expired"],
    ["not_found", "expired"],
  ])("maps %s to %s", async (statePublic, expected) => {
    rpc.mockResolvedValue(
      view(statePublic, statePublic === "not_found" ? null : "reset")
    )
    await expect(getResetTokenView(TOKEN)).resolves.toBe(expected)
  })

  it.each(["join", "claim"])(
    "treats an active %s link as expired",
    async (purpose) => {
      rpc.mockResolvedValue(view("active", purpose))
      await expect(getResetTokenView(TOKEN)).resolves.toBe("expired")
    }
  )

  it("throws when the RPC fails", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST000", message: "down" },
    })
    await expect(getResetTokenView(TOKEN)).rejects.toThrow()
  })
})

describe("completeReset", () => {
  const beginOk = { data: { token_id: "tok-1", user_id: USER_ID }, error: null }
  const completeOk = {
    data: { token_id: "tok-1", user_id: USER_ID, already_consumed: false },
    error: null,
  }
  const updateOk = {
    data: { user: { id: USER_ID, email: "dev-customer@example.com" } },
    error: null,
  }

  function rpcNames() {
    return rpc.mock.calls.map(([name]) => name)
  }

  it("runs begin -> updateUserById -> complete and returns the email from the update", async () => {
    const order: string[] = []
    rpc.mockImplementation(async (name: string) => {
      order.push(name)
      return name === "reset_begin" ? beginOk : completeOk
    })
    updateUserById.mockImplementation(async () => {
      order.push("updateUserById")
      return updateOk
    })

    const result = await completeReset(TOKEN, "Test-pass-123")

    expect(order).toEqual(["reset_begin", "updateUserById", "reset_complete"])
    expect(rpc).toHaveBeenCalledWith("reset_begin", { p_token: TOKEN })
    expect(rpc).toHaveBeenCalledWith("reset_complete", { p_token: TOKEN })
    expect(updateUserById).toHaveBeenCalledWith(USER_ID, {
      password: "Test-pass-123",
    })
    expect(result).toEqual({
      ok: true,
      data: { email: "dev-customer@example.com" },
    })
  })

  it.each(["LINK_USED", "LINK_EXPIRED"])(
    "maps begin %s to the same code without touching Auth",
    async (code) => {
      rpc.mockResolvedValue({ data: null, error: p0001(code) })

      await expect(completeReset(TOKEN, "Test-pass-123")).resolves.toEqual({
        ok: false,
        code,
      })
      expect(updateUserById).not.toHaveBeenCalled()
      expect(rpcNames()).toEqual(["reset_begin"])
    }
  )

  it("maps a begin error without a known code to SERVER_ERROR", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST000", message: "down" },
    })
    await expect(completeReset(TOKEN, "Test-pass-123")).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })

  it.each([
    ["weak_password", "PASSWORD_TOO_SHORT"],
    ["unexpected_failure", "SERVER_ERROR"],
    [undefined, "SERVER_ERROR"],
  ])(
    "maps an Auth %s error to %s and never calls complete",
    async (authCode, code) => {
      rpc.mockResolvedValue(beginOk)
      updateUserById.mockResolvedValue({
        data: { user: null },
        error: { code: authCode, status: 422, message: "x" },
      })

      await expect(completeReset(TOKEN, "Test-pass-123")).resolves.toEqual({
        ok: false,
        code,
      })
      expect(rpcNames()).toEqual(["reset_begin"])
    }
  )

  it("returns SERVER_ERROR when complete fails, and a retry completes (failure in the middle)", async () => {
    let completeCalls = 0
    rpc.mockImplementation(async (name: string) => {
      if (name === "reset_begin") return beginOk
      completeCalls++
      return completeCalls === 1
        ? { data: null, error: { code: "PGRST000", message: "network" } }
        : completeOk
    })
    updateUserById.mockResolvedValue(updateOk)

    await expect(completeReset(TOKEN, "Test-pass-123")).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    await expect(completeReset(TOKEN, "Test-pass-123")).resolves.toEqual({
      ok: true,
      data: { email: "dev-customer@example.com" },
    })
    expect(updateUserById).toHaveBeenCalledTimes(2)
    expect(completeCalls).toBe(2)
  })

  it("never logs the token, password or email", async () => {
    rpc.mockResolvedValue(beginOk)
    updateUserById.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", status: 500, message: "x" },
    })

    await completeReset(TOKEN, "Test-pass-123")

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain("Test-pass-123")
    expect(logged).not.toContain("@example.com")
  })
})
