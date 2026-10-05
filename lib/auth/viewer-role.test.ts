import { beforeEach, describe, expect, it, vi } from "vitest"

import { getViewerRole } from "./viewer-role"

const getClaims = vi.fn()
const rpc = vi.fn()
const createClient = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}))

const signedIn = {
  data: { claims: { sub: "11111111-1111-1111-1111-111111111111" } },
}

beforeEach(() => {
  getClaims.mockReset()
  rpc.mockReset()
  createClient.mockReset()
  createClient.mockResolvedValue({ auth: { getClaims }, rpc })
})

// The public session page shows "להרשמה" only for "customer"; every other
// answer here leads to the guest's action (story 5.16).
describe("getViewerRole", () => {
  it("is null for a guest, without calling the RPC", async () => {
    getClaims.mockResolvedValue({ data: null })
    expect(await getViewerRole()).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(["customer", "admin", "none"])("returns %s", async (role) => {
    getClaims.mockResolvedValue(signedIn)
    rpc.mockResolvedValue({ data: role, error: null })
    expect(await getViewerRole()).toBe(role)
    expect(rpc).toHaveBeenCalledWith("get_my_session_role")
  })

  it("is null when the RPC fails", async () => {
    getClaims.mockResolvedValue(signedIn)
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "NOT_AUTHORIZED" },
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await getViewerRole()).toBeNull()
  })

  it("is null when the lookup throws", async () => {
    createClient.mockRejectedValue(new Error("no cookies"))
    expect(await getViewerRole()).toBeNull()
  })
})
