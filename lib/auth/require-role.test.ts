import { beforeEach, describe, expect, it, vi } from "vitest"

import { requireRole } from "./require-role"

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

function asRole(role: string) {
  getClaims.mockResolvedValue(signedIn)
  rpc.mockResolvedValue({ data: role, error: null })
}

beforeEach(() => {
  getClaims.mockReset()
  rpc.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("requireRole('customer')", () => {
  it("sends a guest to /login?next=%2Fme without calling the RPC", async () => {
    getClaims.mockResolvedValue({ data: null })
    await expect(requireRole("customer")).rejects.toMatchObject({
      url: "/login?next=%2Fme",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("sends an admin to /admin", async () => {
    asRole("admin")
    await expect(requireRole("customer")).rejects.toMatchObject({
      url: "/admin",
    })
    expect(rpc).toHaveBeenCalledWith("get_my_session_role")
  })

  it("sends none to /login without next (the page shows a notice)", async () => {
    asRole("none")
    await expect(requireRole("customer")).rejects.toMatchObject({
      url: "/login",
    })
  })

  it.each([
    [
      "an RPC error",
      () =>
        rpc.mockResolvedValue({
          data: null,
          error: { code: "P0001", message: "NOT_AUTHORIZED" },
        }),
    ],
    ["a thrown RPC", () => rpc.mockRejectedValue(new Error("fetch failed"))],
  ])("sends %s to /login with next", async (_label, arrange) => {
    getClaims.mockResolvedValue(signedIn)
    arrange()
    await expect(requireRole("customer")).rejects.toMatchObject({
      url: "/login?next=%2Fme",
    })
  })

  it("encodes a next that contains ? and &", async () => {
    getClaims.mockResolvedValue({ data: null })
    await expect(
      requireRole("customer", "/me/bookings?tab=credits&x=1")
    ).rejects.toMatchObject({
      url: "/login?next=%2Fme%2Fbookings%3Ftab%3Dcredits%26x%3D1",
    })
  })

  it("lets an active customer through", async () => {
    asRole("customer")
    await expect(requireRole("customer")).resolves.toBeUndefined()
  })
})

describe("requireRole('admin')", () => {
  it("sends a guest to /admin/login with next", async () => {
    getClaims.mockResolvedValue({ data: null })
    await expect(requireRole("admin", "/admin/more")).rejects.toMatchObject({
      url: "/admin/login?next=%2Fadmin%2Fmore",
    })
  })

  it("sends a customer to /admin/login?next=%2Fadmin", async () => {
    asRole("customer")
    await expect(requireRole("admin")).rejects.toMatchObject({
      url: "/admin/login?next=%2Fadmin",
    })
  })

  it("sends none to /admin/login", async () => {
    asRole("none")
    await expect(requireRole("admin")).rejects.toMatchObject({
      url: "/admin/login",
    })
  })

  it("sends an RPC error to /admin/login with next", async () => {
    getClaims.mockResolvedValue(signedIn)
    rpc.mockResolvedValue({ data: null, error: { code: "XX000" } })
    await expect(requireRole("admin")).rejects.toMatchObject({
      url: "/admin/login?next=%2Fadmin",
    })
  })

  it("lets an admin through", async () => {
    asRole("admin")
    await expect(requireRole("admin")).resolves.toBeUndefined()
  })
})
