import { beforeEach, describe, expect, it, vi } from "vitest"

import { requireCustomer } from "./require-customer"

const getClaims = vi.fn()
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
  createClient: async () => ({ auth: { getClaims }, rpc }),
}))

const signedIn = {
  data: { claims: { sub: "11111111-1111-1111-1111-111111111111" } },
}

beforeEach(() => {
  getClaims.mockReset()
  rpc.mockReset()
})

describe("requireCustomer", () => {
  it("redirects a guest (no claims) without calling the RPC", async () => {
    getClaims.mockResolvedValue({ data: null })
    await expect(requireCustomer()).rejects.toMatchObject({
      url: "/login?next=%2Fme",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["admin", { data: "admin", error: null }],
    ["none", { data: "none", error: null }],
    [
      "an RPC error",
      { data: null, error: { code: "P0001", message: "NOT_AUTHORIZED" } },
    ],
  ])("redirects when the role is %s", async (_label, result) => {
    getClaims.mockResolvedValue(signedIn)
    rpc.mockResolvedValue(result)
    await expect(requireCustomer()).rejects.toMatchObject({
      url: "/login?next=%2Fme",
    })
    expect(rpc).toHaveBeenCalledWith("get_my_session_role")
  })

  it("encodes a next that contains ? and &", async () => {
    getClaims.mockResolvedValue({ data: null })
    await expect(
      requireCustomer("/me/bookings?tab=credits&x=1")
    ).rejects.toMatchObject({
      url: "/login?next=%2Fme%2Fbookings%3Ftab%3Dcredits%26x%3D1",
    })
  })

  it("lets an active customer through", async () => {
    getClaims.mockResolvedValue(signedIn)
    rpc.mockResolvedValue({ data: "customer", error: null })
    await expect(requireCustomer()).resolves.toBeUndefined()
  })
})
