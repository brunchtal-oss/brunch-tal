import { describe, expect, it } from "vitest"

import { isIndexable, NOINDEX_SOURCES } from "./indexing.mjs"

describe("isIndexable (fix-search-ready)", () => {
  it("is off by default", () => {
    expect(isIndexable({})).toBe(false)
    expect(isIndexable({ VERCEL_ENV: "production" })).toBe(false)
  })

  it("is on only with SITE_INDEXABLE=true in production", () => {
    expect(
      isIndexable({ SITE_INDEXABLE: "true", VERCEL_ENV: "production" })
    ).toBe(true)
  })

  it.each(["preview", "development", undefined])(
    "is never on in %s",
    (vercelEnv) => {
      expect(
        isIndexable({ SITE_INDEXABLE: "true", VERCEL_ENV: vercelEnv })
      ).toBe(false)
    }
  )

  it.each([
    [" TRUE ", true],
    ["True", true],
    ["yes", false],
    ["1", false],
    ["false", false],
    ["", false],
  ])("reads %j as %s", (value, expected) => {
    expect(
      isIndexable({ SITE_INDEXABLE: value, VERCEL_ENV: "production" })
    ).toBe(expected)
  })

  it("keeps noindex on the private, auth, token, app-only and API paths", () => {
    expect(NOINDEX_SOURCES).toEqual([
      "/me",
      "/me/:path*",
      "/admin",
      "/admin/:path*",
      "/login",
      "/reset/:path*",
      "/join/:path*",
      "/offline",
      "/install",
      "/api/:path*",
    ])
  })
})
