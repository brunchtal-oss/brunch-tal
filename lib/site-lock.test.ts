import { describe, expect, it } from "vitest"

import {
  checkSiteLock,
  isSiteLocked,
  siteLockDeniedResponse,
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
