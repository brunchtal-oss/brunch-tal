import { describe, expect, it, vi } from "vitest"

import { signOutAction } from "./actions"

const signOut = vi.fn(async () => ({ error: null }))

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
  createClient: async () => ({ auth: { signOut } }),
}))

describe("signOutAction", () => {
  it("signs out and redirects to /login", async () => {
    await expect(signOutAction()).rejects.toMatchObject({ url: "/login" })
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
