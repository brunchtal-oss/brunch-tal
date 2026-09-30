import { beforeEach, describe, expect, it, vi } from "vitest"

import { signOutAction } from "./sign-out"

const signOut = vi.fn(async () => ({ error: null }))
const rpc = vi.fn()

class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`REDIRECT ${url}`)
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url)
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut }, rpc }),
}))

beforeEach(() => {
  signOut.mockClear()
  rpc.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("signOutAction", () => {
  it("sends an admin to /admin/login", async () => {
    rpc.mockResolvedValue({ data: "admin", error: null })
    await expect(signOutAction()).rejects.toMatchObject({
      url: "/admin/login",
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it.each(["customer", "none"])("sends %s to /login", async (role) => {
    rpc.mockResolvedValue({ data: role, error: null })
    await expect(signOutAction()).rejects.toMatchObject({ url: "/login" })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("still signs out when the role lookup fails", async () => {
    rpc.mockRejectedValue(new Error("fetch failed"))
    await expect(signOutAction()).rejects.toMatchObject({ url: "/login" })
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
