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
  updateSession.mockImplementation(async () => NextResponse.next())
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

describe("proxy: installing while locked (story 5.9)", () => {
  const html = { accept: "text/html,application/xhtml+xml" }

  async function cookieFromBasic() {
    const response = await proxy(request("/", credentials))
    const header = response!.headers.get("set-cookie") ?? ""
    const match = /site_lock=([^;]+)/.exec(header)
    expect(match).not.toBeNull()
    return match![1]
  }

  it.each(["/manifest.webmanifest", "/icons/icon-192.png"])(
    "serves %s without credentials",
    async (path) => {
      const response = await proxy(request(path))
      expect(response?.status ?? 200).not.toBe(401)
    }
  )

  it("stores site_lock on the page response after valid Basic Auth", async () => {
    const response = await proxy(request("/", credentials))
    const header = response!.headers.get("set-cookie") ?? ""
    expect(header).toMatch(/site_lock=[A-Za-z0-9_-]+;/)
    expect(header).toContain("HttpOnly")
    expect(header).toContain("Secure")
    expect(header).toContain("SameSite=Lax")
    expect(header).not.toContain("s3cret")
  })

  it("lets a valid cookie in without Basic Auth and does not reissue it", async () => {
    const value = await cookieFromBasic()
    updateSession.mockClear()
    const response = await proxy(
      new NextRequest("https://example.test/me", {
        headers: { cookie: `site_lock=${value}` },
      })
    )
    expect(response?.status).not.toBe(401)
    expect(updateSession).toHaveBeenCalledTimes(1)
    expect(response!.headers.get("set-cookie") ?? "").not.toContain("site_lock")
  })

  it("rejects a forged cookie", async () => {
    const response = await proxy(
      new NextRequest("https://example.test/me", {
        headers: { cookie: "site_lock=forged" },
      })
    )
    expect(response?.status).toBe(401)
  })

  it("rejects a cookie issued for an old password", async () => {
    const value = await cookieFromBasic()
    vi.stubEnv("SITE_LOCK_PASSWORD", "changed")
    const response = await proxy(
      new NextRequest("https://example.test/", {
        headers: { cookie: `site_lock=${value}` },
      })
    )
    expect(response?.status).toBe(401)
  })

  it("answers a denied HTML GET with 401, WWW-Authenticate and the form", async () => {
    const response = await proxy(
      new NextRequest("https://example.test/me/bookings?x=1", {
        headers: html,
      })
    )
    expect(response?.status).toBe(401)
    expect(response!.headers.get("WWW-Authenticate")).toMatch(/^Basic /)
    const body = await response!.text()
    expect(body).toContain('action="/site-lock"')
    expect(body).toContain('value="/me/bookings?x=1"')
    expect(updateSession).not.toHaveBeenCalled()
  })

  it("keeps the plain 401 for a denied request that is not HTML", async () => {
    const response = await proxy(request("/me"))
    expect(response!.headers.get("Content-Type")).toMatch(/^text\/plain/)
  })

  function postForm(fields: Record<string, string>) {
    return new NextRequest("https://example.test/site-lock", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    })
  }

  it("POST /site-lock with correct details: 303 to next with the cookie", async () => {
    const response = await proxy(
      postForm({ user: "tal", password: "s3cret", next: "/me" })
    )
    expect(response?.status).toBe(303)
    expect(response!.headers.get("Location")).toBe("https://example.test/me")
    expect(response!.headers.get("set-cookie")).toMatch(/^site_lock=/)
    expect(updateSession).not.toHaveBeenCalled()
  })

  it("POST /site-lock with wrong details: 401 and the form with the error", async () => {
    const response = await proxy(
      postForm({ user: "tal", password: "nope", next: "/me" })
    )
    expect(response?.status).toBe(401)
    expect(response!.headers.get("set-cookie")).toBeNull()
    expect(await response!.text()).toContain('action="/site-lock"')
  })

  it("POST /site-lock never redirects off the site", async () => {
    const response = await proxy(
      postForm({ user: "tal", password: "s3cret", next: "//evil.test" })
    )
    expect(response!.headers.get("Location")).toBe("https://example.test/")
  })

  it("does not handle POST /site-lock when the site is unlocked", async () => {
    vi.stubEnv("SITE_LOCKED", "false")
    await proxy(postForm({ user: "tal", password: "s3cret", next: "/me" }))
    expect(updateSession).toHaveBeenCalledTimes(1)
  })
})
