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

  it("keeps a safe next for the next login", async () => {
    rpc.mockResolvedValue({ data: "customer", error: null })
    const data = new FormData()
    data.set("next", "/join/abc")
    await expect(signOutAction(data)).rejects.toMatchObject({
      url: "/login?next=%2Fjoin%2Fabc",
    })
  })

  it.each(["https://evil.example/x", "//evil.example", ""])(
    "drops an unsafe next %j",
    async (next) => {
      rpc.mockResolvedValue({ data: "none", error: null })
      const data = new FormData()
      data.set("next", next)
      await expect(signOutAction(data)).rejects.toMatchObject({
        url: "/login",
      })
    }
  )

  it("sends an admin to /admin/login whatever the next", async () => {
    rpc.mockResolvedValue({ data: "admin", error: null })
    const data = new FormData()
    data.set("next", "/join/abc")
    await expect(signOutAction(data)).rejects.toMatchObject({
      url: "/admin/login",
    })
  })

  it("removes this device's push subscription before signing out", async () => {
    const order: string[] = []
    rpc.mockImplementation(async (name: string) => {
      order.push(name)
      return {
        data: name === "get_my_session_role" ? "customer" : { removed: 1 },
        error: null,
      }
    })
    signOut.mockImplementationOnce(async () => {
      order.push("signOut")
      return { error: null }
    })
    const data = new FormData()
    data.set("push_endpoint", "https://push.example.test/abc")
    await expect(signOutAction(data)).rejects.toMatchObject({ url: "/login" })
    expect(rpc).toHaveBeenCalledWith("unregister_push_subscription", {
      p_endpoint: "https://push.example.test/abc",
    })
    expect(order).toEqual([
      "get_my_session_role",
      "unregister_push_subscription",
      "signOut",
    ])
  })

  it("still signs out when removing the subscription fails", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "get_my_session_role"
        ? { data: "admin", error: null }
        : Promise.reject(new Error("fetch failed"))
    )
    const data = new FormData()
    data.set("push_endpoint", "https://push.example.test/abc")
    await expect(signOutAction(data)).rejects.toMatchObject({
      url: "/admin/login",
    })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it.each(["", "http://push.example.test/abc", "not a url"])(
    "skips an empty or invalid endpoint %j",
    async (endpoint) => {
      rpc.mockResolvedValue({ data: "customer", error: null })
      const data = new FormData()
      data.set("push_endpoint", endpoint)
      await expect(signOutAction(data)).rejects.toMatchObject({ url: "/login" })
      expect(rpc).toHaveBeenCalledTimes(1)
    }
  )
})
