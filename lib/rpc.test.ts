import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRpc } from "./rpc"

const rpc = vi.fn()
// Only rpc() is used; the cast stands in for a Supabase client.
const client = { rpc } as unknown as Parameters<typeof callRpc>[0]

const TOKEN = "t".repeat(43)
const KEY = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  rpc.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("callRpc", () => {
  it("passes the name and args and returns the data", async () => {
    rpc.mockResolvedValue({ data: { token_id: "tok-1" }, error: null })

    await expect(
      callRpc(client, "reset_complete", {
        p_token: TOKEN,
        p_idempotency_key: KEY,
      })
    ).resolves.toEqual({ ok: true, data: { token_id: "tok-1" } })
    expect(rpc).toHaveBeenCalledWith("reset_complete", {
      p_token: TOKEN,
      p_idempotency_key: KEY,
    })
  })

  it("calls a function without parameters with no args", async () => {
    rpc.mockResolvedValue({ data: "customer", error: null })
    await expect(callRpc(client, "get_my_session_role")).resolves.toEqual({
      ok: true,
      data: "customer",
    })
    expect(rpc).toHaveBeenCalledWith("get_my_session_role")
  })

  it("maps a known P0001 code to { ok: false, code }", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "LINK_USED" },
    })
    await expect(
      callRpc(client, "reset_begin", { p_token: TOKEN, p_idempotency_key: KEY })
    ).resolves.toEqual({ ok: false, code: "LINK_USED" })
  })

  it("maps IDEMPOTENCY_KEY_REUSED", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "IDEMPOTENCY_KEY_REUSED" },
    })
    await expect(
      callRpc(client, "reset_begin", { p_token: TOKEN, p_idempotency_key: KEY })
    ).resolves.toEqual({ ok: false, code: "IDEMPOTENCY_KEY_REUSED" })
  })

  it("maps an unknown P0001 code to SERVER_ERROR", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "SOMETHING_NEW" },
    })
    await expect(
      callRpc(client, "reset_begin", { p_token: TOKEN, p_idempotency_key: KEY })
    ).resolves.toEqual({ ok: false, code: "SERVER_ERROR" })
  })

  it("maps a PostgREST or network error to SERVER_ERROR", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "", message: "TypeError: fetch failed" },
    })
    await expect(
      callRpc(client, "reset_begin", { p_token: TOKEN, p_idempotency_key: KEY })
    ).resolves.toEqual({ ok: false, code: "SERVER_ERROR" })
  })

  it("maps a thrown error to SERVER_ERROR", async () => {
    rpc.mockRejectedValue(new Error("socket hang up"))
    await expect(
      callRpc(client, "reset_begin", { p_token: TOKEN, p_idempotency_key: KEY })
    ).resolves.toEqual({ ok: false, code: "SERVER_ERROR" })
  })

  it("does not log a known business code", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "LINK_EXPIRED" },
    })
    await callRpc(client, "reset_begin", {
      p_token: TOKEN,
      p_idempotency_key: KEY,
    })
    expect(console.error).not.toHaveBeenCalled()
  })

  it.each([
    ["an unknown P0001 code", { code: "P0001", message: "SOMETHING_NEW" }],
    ["a PostgREST error", { code: "PGRST000", message: "down" }],
  ])(
    "logs %s as SERVER_ERROR with only the rpc name and codes",
    async (_label, error) => {
      rpc.mockResolvedValue({ data: null, error })
      await callRpc(client, "reset_begin", {
        p_token: TOKEN,
        p_idempotency_key: KEY,
      })

      expect(console.error).toHaveBeenCalledTimes(1)
      const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
      expect(logged).toContain("reset_begin")
      expect(logged).toContain("SERVER_ERROR")
      expect(logged).not.toContain(TOKEN)
      expect(logged).not.toContain(KEY)
      expect(logged).not.toContain(error.message)
    }
  )

  it("logs a thrown error as SERVER_ERROR", async () => {
    rpc.mockRejectedValue(new Error("socket hang up"))
    await callRpc(client, "reset_begin", {
      p_token: TOKEN,
      p_idempotency_key: KEY,
    })
    expect(console.error).toHaveBeenCalledTimes(1)
  })
})
