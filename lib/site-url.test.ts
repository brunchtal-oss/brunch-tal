import { describe, expect, it } from "vitest"

import { explicitSiteUrl, siteUrl } from "./site-url"

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

describe("explicitSiteUrl (online payments)", () => {
  it("NEXT_PUBLIC_SITE_URL only, without a trailing slash", () => {
    expect(
      explicitSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.co.il/" })
    ).toBe("https://example.co.il")
  })

  it("null without it, with no Vercel or localhost fallback", () => {
    expect(
      explicitSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })
    ).toBeNull()
    expect(explicitSiteUrl({ NEXT_PUBLIC_SITE_URL: "ftp://x" })).toBeNull()
  })
})
