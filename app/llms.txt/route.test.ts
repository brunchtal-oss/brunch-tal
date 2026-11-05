import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { shellCopy } from "@/lib/copy/shell"
import { pageSeoFrom } from "@/lib/seo/page-seo"
import { toSections } from "@/lib/content/pages"

import { GET } from "./route"

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }))
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }))
vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  getPageSeo: vi.fn(),
  getSiteSeo: vi.fn(),
  getPublishedPageSlugs: vi.fn(),
  listUpcomingPublicSessions: vi.fn(),
}))

vi.mock("@/lib/seo/page-seo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/page-seo")>()),
  getPageSeo: mocks.getPageSeo,
}))
vi.mock("@/lib/seo/site-seo", () => ({ getSiteSeo: mocks.getSiteSeo }))
vi.mock("@/lib/content/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content/pages")>()),
  getPublishedPageSlugs: mocks.getPublishedPageSlugs,
}))
vi.mock("@/lib/sessions/public", () => ({
  listUpcomingPublicSessions: mocks.listUpcomingPublicSessions,
}))

const copy = shellCopy.public.llms

describe("/llms.txt (fix-seo-editor)", () => {
  beforeEach(() => {
    vi.stubEnv("SITE_INDEXABLE", "")
    vi.stubEnv("VERCEL_ENV", "")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.co.il")
    mocks.getSiteSeo.mockResolvedValue({
      name: "שם העסק",
      heroTitle: null,
      description: "תיאור האתר",
      image: null,
    })
    mocks.getPageSeo.mockResolvedValue(
      pageSeoFrom({
        sections: toSections([
          {
            key: "gallery",
            kind: "page_seo",
            content: { h1: "גלריה", description: "תיאור הגלריה" },
          },
          {
            key: "contact",
            kind: "page_seo",
            // The same as the site description: no detail on its line.
            content: { h1: "יצירת קשר", description: "תיאור האתר" },
          },
        ]),
        images: {},
      })
    )
    mocks.getPublishedPageSlugs.mockResolvedValue(["terms"])
    mocks.listUpcomingPublicSessions.mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is 404 with the default environment", async () => {
    const response = await GET()
    expect(response.status).toBe(404)
    expect(mocks.getSiteSeo).not.toHaveBeenCalled()
  })

  it("is the site's map as text when indexable", async () => {
    vi.stubEnv("SITE_INDEXABLE", "true")
    vi.stubEnv("VERCEL_ENV", "production")
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    )
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=300")
    const text = await response.text()
    expect(text.startsWith("# שם העסק\n\n> תיאור האתר\n")).toBe(true)
    expect(text).toContain(
      "- [גלריה](https://example.co.il/gallery): תיאור הגלריה\n"
    )
    // A description equal to the site's has no detail.
    expect(text).toContain("- [יצירת קשר](https://example.co.il/contact)\n")
    expect(text).toContain(`## ${copy.policies}`)
    // Only terms is published: privacy is left out.
    expect(text).toContain("https://example.co.il/terms")
    expect(text).not.toContain("https://example.co.il/privacy")
    expect(text).toContain("https://example.co.il/accessibility")
    expect(text).not.toContain(`## ${copy.sessions}`)
  })
})
