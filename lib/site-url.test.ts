import { describe, expect, it } from "vitest"

import { siteUrl } from "./site-url"

describe("siteUrl (fix-search-ready)", () => {
  it("uses NEXT_PUBLIC_SITE_URL without its trailing slash", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.co.il/" })).toBe(
      "https://example.co.il"
    )
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: " http://example.co.il ",
        VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app",
      })
    ).toBe("http://example.co.il")
  })

  it("ignores a value that is not an http(s) URL", () => {
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: "ftp://example.co.il",
        VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app",
      })
    ).toBe("https://x.vercel.app")
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "not a url" })).toBe(
      "http://localhost:3000"
    )
  })

  it("falls back to the Vercel production domain, then localhost", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe(
      "https://x.vercel.app"
    )
    expect(siteUrl({})).toBe("http://localhost:3000")
  })
})
