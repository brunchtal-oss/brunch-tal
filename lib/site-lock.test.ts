import { describe, expect, it } from "vitest"

import { siteLockCopy } from "@/lib/copy/site-lock"

import {
  checkSiteLock,
  handleSiteLockPost,
  isPublicFile,
  isSiteLocked,
  safeLockNext,
  SITE_LOCK_EXEMPT_PREFIXES,
  siteLockAccess,
  siteLockCookieHeader,
  siteLockDeniedResponse,
  siteLockFormResponse,
  wantsLockForm,
  type SiteLockEnv,
} from "./site-lock"

const basic = (credentials: string) =>
  `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`

const locked: SiteLockEnv = {
  SITE_LOCKED: "true",
  SITE_LOCK_USER: "tal",
  SITE_LOCK_PASSWORD: "s3cret:with-colon",
}
const good = basic("tal:s3cret:with-colon")

describe("checkSiteLock", () => {
  it.each(["/", "/login", "/_next/static/chunks/app.js", "/x.png", "/me"])(
    "denies %s without credentials when locked",
    (path) => {
      expect(checkSiteLock(path, null, locked)).toBe("deny")
    }
  )

  it("allows correct credentials", () => {
    expect(checkSiteLock("/", good, locked)).toBe("allow")
    expect(checkSiteLock("/reset/abc", good, locked)).toBe("allow")
  })

  it("accepts a lower-case scheme", () => {
    expect(checkSiteLock("/", good.replace("Basic", "basic"), locked)).toBe(
      "allow"
    )
  })

  it.each([
    ["wrong password", basic("tal:nope")],
    ["wrong user", basic("tali:s3cret:with-colon")],
    ["password prefix", basic("tal:s3cret")],
    ["empty credentials", basic(":")],
    ["no colon", basic("tals3cret")],
    ["broken base64", "Basic !!!notbase64"],
    ["bad padding", "Basic dGFsOnM"],
    ["other scheme", good.replace("Basic", "Bearer")],
    ["scheme only", "Basic"],
    ["empty header", ""],
  ])("denies %s", (_label, header) => {
    expect(checkSiteLock("/", header, locked)).toBe("deny")
  })

  it.each(["/api/jobs/x", "/api/jobs/reminders/run"])("exempts %s", (path) => {
    expect(checkSiteLock(path, null, locked)).toBe("allow")
  })

  it.each(["/api/jobsx", "/api/jobs", "/api/job/x", "/API/jobs/x"])(
    "does not exempt look-alike %s",
    (path) => {
      expect(checkSiteLock(path, null, locked)).toBe("deny")
    }
  )

  it.each([
    ["no password", { SITE_LOCKED: "true", SITE_LOCK_USER: "tal" }],
    ["no user", { SITE_LOCKED: "true", SITE_LOCK_PASSWORD: "x" }],
    [
      "empty both",
      { SITE_LOCKED: "true", SITE_LOCK_USER: "", SITE_LOCK_PASSWORD: "" },
    ],
  ])("fails closed with %s configured", (_label, env) => {
    expect(checkSiteLock("/", basic("tal:x"), env)).toBe("deny")
    expect(checkSiteLock("/", basic(":"), env)).toBe("deny")
    expect(checkSiteLock("/", null, env)).toBe("deny")
  })

  it("ignores stray whitespace around the configured credentials", () => {
    const padded = {
      SITE_LOCKED: "true",
      SITE_LOCK_USER: " tal\n",
      SITE_LOCK_PASSWORD: "s3cret:with-colon \n",
    }
    expect(checkSiteLock("/", good, padded)).toBe("allow")
    expect(
      checkSiteLock("/", null, { ...padded, SITE_LOCK_PASSWORD: "  " })
    ).toBe("deny")
  })

  it("does not lock when unlocked", () => {
    expect(checkSiteLock("/", null, {})).toBe("allow")
  })
})

describe("isSiteLocked", () => {
  it.each([
    [{ VERCEL_ENV: "production" }, true],
    [{ VERCEL_ENV: "preview" }, true],
    [{ VERCEL_ENV: "preview", SITE_LOCKED: "" }, true],
    [{ VERCEL_ENV: "production", SITE_LOCKED: "true" }, true],
    [{ VERCEL_ENV: "production", SITE_LOCKED: "no" }, true],
    [{ VERCEL_ENV: "production", SITE_LOCKED: "false" }, false],
    [{ VERCEL_ENV: "preview", SITE_LOCKED: " FALSE " }, false],
    [{}, false],
    [{ VERCEL_ENV: "development" }, false],
    [{ SITE_LOCKED: "false" }, false],
    [{ SITE_LOCKED: "true" }, true],
    [{ SITE_LOCKED: "TRUE" }, true],
  ] as [SiteLockEnv, boolean][])("%o -> %s", (env, expected) => {
    expect(isSiteLocked(env)).toBe(expected)
  })

  it("locks Vercel without the variable even with no credentials", () => {
    expect(checkSiteLock("/", null, { VERCEL_ENV: "preview" })).toBe("deny")
    expect(
      checkSiteLock("/", null, {
        VERCEL_ENV: "production",
        SITE_LOCKED: "false",
      })
    ).toBe("allow")
  })
})

describe("siteLockDeniedResponse", () => {
  it("asks for Basic Auth and is not cached", async () => {
    const response = siteLockDeniedResponse()
    expect(response.status).toBe(401)
    expect(response.headers.get("WWW-Authenticate")).toMatch(/^Basic /)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.text()).not.toMatch(/<html/i)
  })
})

describe("public files (story 5.9)", () => {
  it.each(["/manifest.webmanifest", "/icons/icon-192.png", "/icons/x"])(
    "lets %s through without credentials",
    (path) => {
      expect(isPublicFile(path)).toBe(true)
      expect(checkSiteLock(path, null, locked)).toBe("allow")
    }
  )

  it.each([
    "/manifest.webmanifest/x",
    "/manifest.webmanifestx",
    "/icons",
    "/iconsx/a.png",
    "/x/icons/a.png",
    "/sw.js",
    "/offline",
  ])("keeps %s locked", (path) => {
    expect(isPublicFile(path)).toBe(false)
    expect(checkSiteLock(path, null, locked)).toBe("deny")
  })

  it("leaves the exempt prefixes as they were", () => {
    expect(SITE_LOCK_EXEMPT_PREFIXES).toEqual(["/api/jobs/"])
  })
})

describe("site_lock cookie (story 5.9)", () => {
  const issued = () => siteLockAccess("/", good, null, locked).issueCookie!

  it("issues a cookie for valid Basic Auth without one", () => {
    const access = siteLockAccess("/", good, null, locked)
    expect(access.decision).toBe("allow")
    expect(access.issueCookie).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(access.issueCookie).not.toContain("s3cret")
  })

  it("lets a valid cookie in without Basic Auth, and issues nothing", () => {
    expect(siteLockAccess("/me", null, issued(), locked)).toEqual({
      decision: "allow",
      issueCookie: null,
    })
    expect(siteLockAccess("/", good, issued(), locked).issueCookie).toBeNull()
  })

  it.each([
    ["forged", "AAAA"],
    ["empty", ""],
    ["one character off", "x"],
  ])("denies a %s cookie", (_label, value) => {
    const cookie = value === "x" ? `${issued().slice(0, -1)}x` : value
    expect(siteLockAccess("/", null, cookie, locked).decision).toBe("deny")
  })

  it("voids the cookie when the user or the password changes", () => {
    const cookie = issued()
    for (const env of [
      { ...locked, SITE_LOCK_PASSWORD: "other" },
      { ...locked, SITE_LOCK_USER: "other" },
    ]) {
      expect(checkSiteLock("/", null, env, cookie)).toBe("deny")
    }
  })

  it("replaces an old cookie when Basic Auth is valid", () => {
    const old = siteLockAccess("/", basic("tal:old"), null, {
      ...locked,
      SITE_LOCK_PASSWORD: "old",
    }).issueCookie
    const access = siteLockAccess("/", good, old, locked)
    expect(access.decision).toBe("allow")
    expect(access.issueCookie).toBe(issued())
  })

  it("fails closed with no credentials configured, cookie or not", () => {
    const env = { SITE_LOCKED: "true" }
    expect(checkSiteLock("/", null, env, issued())).toBe("deny")
  })

  it("writes the cookie HttpOnly, Secure, Lax, for 30 days", () => {
    const header = siteLockCookieHeader("abc")
    expect(header).toMatch(/^site_lock=abc;/)
    for (const part of [
      "Path=/",
      `Max-Age=${60 * 60 * 24 * 30}`,
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
    ]) {
      expect(header).toContain(part)
    }
  })
})

describe("sign-in form (story 5.9)", () => {
  it.each([
    ["GET", "text/html,application/xhtml+xml", true],
    ["GET", "*/*", false],
    ["GET", null, false],
    ["POST", "text/html", false],
    ["HEAD", "text/html", false],
  ] as const)("%s with Accept %s -> form %s", (method, accept, expected) => {
    expect(wantsLockForm(method, accept)).toBe(expected)
  })

  it("answers 401 with WWW-Authenticate and the form", async () => {
    const response = siteLockFormResponse("/me?x=1")
    expect(response.status).toBe(401)
    expect(response.headers.get("WWW-Authenticate")).toMatch(/^Basic /)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Content-Type")).toMatch(/^text\/html/)
    const html = await response.text()
    expect(html).toContain('<html lang="he" dir="rtl">')
    expect(html).toContain('action="/site-lock"')
    expect(html).toContain('name="user"')
    expect(html).toContain('name="password"')
    expect(html).toContain('name="next" value="/me?x=1"')
    expect(html).toContain(siteLockCopy.title)
    expect(html).not.toContain(siteLockCopy.error)
  })

  it("escapes next in the form", async () => {
    const html = await siteLockFormResponse('/a"><script>x</script>').text()
    expect(html).not.toContain("<script>")
    expect(html).toContain("&quot;&gt;&lt;script&gt;")
  })

  it.each([
    ["/me", "/me"],
    ["/me/bookings?x=1", "/me/bookings?x=1"],
    ["//evil.test", "/"],
    ["/\\evil.test", "/"],
    ["https://evil.test", "/"],
    ["me", "/"],
    ["", "/"],
    [null, "/"],
    ["/a\nb", "/"],
    ["/site-lock", "/"],
    ["/site-lock?x=1", "/"],
    ["/site-lock#x", "/"],
    ["/site-locked", "/site-locked"],
  ])("safeLockNext(%j) -> %s", (value, expected) => {
    expect(safeLockNext(value)).toBe(expected)
  })
})

describe("handleSiteLockPost (story 5.9)", () => {
  const ORIGIN = "https://example.test"
  const post = (
    user: string | null,
    password: string | null,
    next: string | null
  ) => handleSiteLockPost({ user, password, next }, locked, ORIGIN)

  it("redirects to next with the cookie on correct credentials", () => {
    const response = post("tal", "s3cret:with-colon", "/me")
    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe(`${ORIGIN}/me`)
    const cookie = response.headers.get("Set-Cookie")!
    const value = siteLockAccess("/", good, null, locked).issueCookie
    expect(cookie).toBe(siteLockCookieHeader(value!))
    expect(cookie).not.toContain("s3cret")
  })

  it("never redirects off the site", () => {
    for (const next of ["//x", "/\\x", "https://x", null]) {
      expect(
        post("tal", "s3cret:with-colon", next).headers.get("Location")
      ).toBe(`${ORIGIN}/`)
    }
  })

  it.each([
    ["wrong password", "tal", "nope"],
    ["wrong user", "tali", "s3cret:with-colon"],
    ["missing fields", null, null],
  ])("answers 401 with the form and the error on %s", async (_l, u, p) => {
    const response = post(u, p, "/me")
    expect(response.status).toBe(401)
    expect(response.headers.get("Set-Cookie")).toBeNull()
    const html = await response.text()
    expect(html).toContain(siteLockCopy.error)
    expect(html).toContain('name="next" value="/me"')
  })

  it("fails closed with no credentials configured", () => {
    const response = handleSiteLockPost(
      { user: "", password: "", next: "/" },
      { SITE_LOCKED: "true" },
      ORIGIN
    )
    expect(response.status).toBe(401)
  })
})
