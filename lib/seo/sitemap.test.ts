import { describe, expect, it } from "vitest"

import { buildSitemap, SITEMAP_CONTENT_SLUGS } from "./sitemap"

const base = "https://example.co.il"

describe("buildSitemap (fix-search-ready)", () => {
  it("lists the public pages, the published legal pages and the sessions", () => {
    const result = buildSitemap({
      base,
      publishedLegalSlugs: ["privacy", "terms"],
      publishedAt: { home: "2026-11-01T10:00:00Z", terms: null },
      sessions: [{ id: "11111111-1111-4111-8111-111111111111" }],
    })
    expect(result).toEqual([
      { url: "https://example.co.il/", lastModified: "2026-11-01T10:00:00Z" },
      { url: "https://example.co.il/sessions" },
      { url: "https://example.co.il/how-it-works" },
      { url: "https://example.co.il/gallery" },
      { url: "https://example.co.il/contact" },
      { url: "https://example.co.il/terms" },
      { url: "https://example.co.il/privacy" },
      { url: "https://example.co.il/accessibility" },
      {
        url: "https://example.co.il/sessions/11111111-1111-4111-8111-111111111111",
      },
    ])
  })

  it("leaves out an unpublished legal page but keeps the accessibility statement", () => {
    const urls = buildSitemap({
      base,
      publishedLegalSlugs: [],
      publishedAt: {},
      sessions: [],
    }).map((entry) => entry.url)
    expect(urls).not.toContain(`${base}/privacy`)
    expect(urls).not.toContain(`${base}/terms`)
    expect(urls).toContain(`${base}/accessibility`)
  })

  it("never lists the private, auth, token or app-only pages", () => {
    const urls = buildSitemap({
      base,
      publishedLegalSlugs: ["privacy", "terms"],
      publishedAt: {},
      sessions: [],
    }).map((entry) => new URL(entry.url).pathname)
    for (const path of urls) {
      expect(path).not.toMatch(
        /^\/(me|admin|login|reset|join|install|offline|api)\b/
      )
    }
  })

  it("dates the pages by their content's last publish", () => {
    expect(SITEMAP_CONTENT_SLUGS).toContain("home")
    expect(SITEMAP_CONTENT_SLUGS).toContain("how-it-works")
    const result = buildSitemap({
      base,
      publishedLegalSlugs: [],
      publishedAt: { "how-it-works": "2026-10-20T08:00:00Z" },
      sessions: [],
    })
    expect(result.find((e) => e.url.endsWith("/how-it-works"))).toEqual({
      url: `${base}/how-it-works`,
      lastModified: "2026-10-20T08:00:00Z",
    })
    expect(result.find((e) => e.url.endsWith("/sessions"))).toEqual({
      url: `${base}/sessions`,
    })
  })
})
