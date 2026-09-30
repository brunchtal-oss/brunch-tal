import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { proxy } from "./proxy"

const updateSession = vi.fn()

vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: (request: NextRequest) => updateSession(request),
}))

const credentials = `Basic ${Buffer.from("tal:s3cret").toString("base64")}`

function request(path: string, authorization?: string) {
  return new NextRequest(`https://example.test${path}`, {
    headers: authorization ? { authorization } : {},
  })
}

beforeEach(() => {
  updateSession.mockReset()
  updateSession.mockResolvedValue(NextResponse.next())
  vi.stubEnv("VERCEL_ENV", "preview")
  vi.stubEnv("SITE_LOCKED", "")
  vi.stubEnv("SITE_LOCK_USER", "tal")
  vi.stubEnv("SITE_LOCK_PASSWORD", "s3cret")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("proxy", () => {
  it("covers every path, static files included", async () => {
    const { config } = await import("./proxy")
    expect(config.matcher).toEqual(["/:path*"])
  })

  it.each([
    "/",
    "/me",
    "/_next/static/chunks/app.js",
    "/favicon.ico",
    "/a.png",
  ])(
    "answers 401 on %s without credentials, before any session work",
    async (path) => {
      const response = await proxy(request(path))
      expect(response?.status).toBe(401)
      expect(updateSession).not.toHaveBeenCalled()
    }
  )

  it.each(["/me", "/reset/abc", "/login", "/"])(
    "refreshes the session on %s with credentials",
    async (path) => {
      await proxy(request(path, credentials))
      expect(updateSession).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/favicon.ico",
    "/a.png",
  ])("skips the session refresh on static %s", async (path) => {
    const response = await proxy(request(path, credentials))
    expect(response).toBeUndefined()
    expect(updateSession).not.toHaveBeenCalled()
  })

  it.each([
    ["/admin/more?x=1", "/admin/more?x=1"],
    ["/me", "/me"],
    ["/login", null],
    ["/reset/abc", null],
  ])(
    "sets the request path header on %s (forged values dropped)",
    async (path, expected) => {
      const forged = request(path, credentials)
      forged.headers.set("x-request-path", "/forged")
      await proxy(forged)
      const seen = updateSession.mock.calls[0][0] as NextRequest
      expect(seen.headers.get("x-request-path")).toBe(expected)
    }
  )

  it("lets /api/jobs/ through without credentials", async () => {
    const response = await proxy(request("/api/jobs/x"))
    expect(response?.status).not.toBe(401)
  })

  it("reads the lock settings from process.env", async () => {
    vi.stubEnv("SITE_LOCKED", "false")
    const response = await proxy(request("/"))
    expect(response?.status).not.toBe(401)
  })
})
