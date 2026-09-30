import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { updateSession } from "./proxy"

type CookieMethods = {
  setAll: (cookies: { name: string; value: string; options?: object }[]) => void
}

let setCookies = false

// getClaims() refreshes the session; with setCookies it rewrites cookies
// through setAll, which rebuilds the response (the second NextResponse.next).
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    { cookies }: { cookies: CookieMethods }
  ) => ({
    auth: {
      getClaims: async () => {
        if (setCookies) {
          cookies.setAll([{ name: "sb-token", value: "fresh", options: {} }])
        }
        return { data: null }
      },
    },
  }),
}))

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
})

function request() {
  return new NextRequest("https://example.test/admin/more", {
    headers: { "x-request-path": "/admin/more?x=1" },
  })
}

describe("updateSession", () => {
  it.each([
    ["without a cookie refresh", false],
    ["after setAll rebuilds the response", true],
  ])("forwards x-request-path %s", async (_label, refresh) => {
    setCookies = refresh
    const response = await updateSession(request())
    expect(response.headers.get("x-middleware-request-x-request-path")).toBe(
      "/admin/more?x=1"
    )
    if (refresh) {
      expect(response.cookies.get("sb-token")?.value).toBe("fresh")
    }
  })
})
