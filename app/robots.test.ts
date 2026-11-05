import { describe, expect, it } from "vitest"

import { NAMED_CRAWLERS, robotsFor as robots } from "@/lib/seo/robots"

import defaultRobots from "./robots"

describe("robots", () => {
  it("disallows every crawler on the whole site until the launch (story 5.15)", () => {
    expect(robots({})).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] })
    expect(robots({ SITE_INDEXABLE: "true", VERCEL_ENV: "preview" })).toEqual({
      rules: [{ userAgent: "*", disallow: "/" }],
    })
  })

  it("is off with the default environment", () => {
    expect(defaultRobots()).toEqual({
      rules: [{ userAgent: "*", disallow: "/" }],
    })
  })

  it("allows every crawler but the API and lists the sitemap when indexable", () => {
    const result = robots({
      SITE_INDEXABLE: "true",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://example.co.il/",
    })
    expect(result).toEqual({
      rules: [
        { userAgent: [...NAMED_CRAWLERS], allow: "/", disallow: "/api/" },
        { userAgent: "*", allow: "/", disallow: "/api/" },
      ],
      sitemap: "https://example.co.il/sitemap.xml",
    })
    expect(NAMED_CRAWLERS).toContain("OAI-SearchBot")
    expect(NAMED_CRAWLERS).toContain("Claude-SearchBot")
    expect(NAMED_CRAWLERS).toHaveLength(13)
  })
})
