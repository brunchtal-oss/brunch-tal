import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { toSections, type PublishedPage } from "@/lib/content/pages"
import { WORDMARK } from "@/lib/copy/shell"

import { OG_DEFAULT_PATH, type SiteSeo } from "./metadata"
import {
  DEFAULT_H1,
  pageH1,
  pageMetadata,
  pageSeoDescription,
  pageSeoFrom,
  pageShareImage,
  pageTitle,
  SEO_PAGE_KEYS,
} from "./page-seo"

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }))

const BASE = "https://example.co.il"
const PAGE_IMAGE = "11111111-1111-4111-8111-111111111111"
const SITE_IMAGE = "22222222-2222-4222-8222-222222222222"

const site: SiteSeo = {
  name: "שם העסק",
  heroTitle: "כותרת ההירו",
  description: "תיאור האתר",
  image: { src: "https://cdn/hero.jpg", alt: "hero", focusX: 50, focusY: 50 },
}

const image = (id: string) => ({ media_id: id, focus_x: 50, focus_y: 50 })

function seoPage(
  rows: { key: string; kind: string; content: unknown }[],
  images: PublishedPage["images"] = {}
) {
  return pageSeoFrom({ sections: toSections(rows), images })
}

const EMPTY = pageSeoFrom(null)

// The seeded records: today's H1s and nothing else.
const SEEDED = seoPage([
  { key: "site", kind: "seo_site", content: {} },
  { key: "home", kind: "page_seo", content: { h1: site.name } },
  ...Object.entries(DEFAULT_H1).map(([key, h1]) => ({
    key,
    kind: "page_seo",
    content: { h1 },
  })),
])

describe("page SEO resolvers (fix-seo-editor)", () => {
  it("seeded records give exactly the metadata and H1s of before", () => {
    for (const seo of [SEEDED, EMPTY]) {
      expect(pageH1(seo, "home", site.name)).toBe(site.name)
      expect(pageH1(seo, "gallery", site.name)).toBe(DEFAULT_H1.gallery)
      const gallery = pageMetadata(seo, "gallery", site, BASE)
      expect(gallery).toMatchObject({
        title: DEFAULT_H1.gallery,
        alternates: { canonical: "/gallery" },
        description: site.description,
        openGraph: {
          type: "website",
          locale: "he_IL",
          siteName: site.name,
          title: `${DEFAULT_H1.gallery} · ${site.name}`,
          url: "/gallery",
          description: site.description,
          images: [{ url: site.image!.src, alt: "hero" }],
        },
        twitter: { title: `${DEFAULT_H1.gallery} · ${site.name}` },
      })
      expect(pageMetadata(seo, "home", site, BASE)).toMatchObject({
        title: { absolute: "שם העסק · כותרת ההירו" },
        alternates: { canonical: "/" },
        openGraph: { title: "שם העסק · כותרת ההירו", url: "/" },
      })
      expect(pageSeoDescription(seo, null, site)).toBe(site.description)
      expect(pageShareImage(seo, null, site, BASE).url).toBe(site.image!.src)
    }
  })

  it("a Google title only still sets the share tags", () => {
    const seo = seoPage([
      {
        key: "contact",
        kind: "page_seo",
        content: { h1: "יצירת קשר", title: "כותרת לגוגל" },
      },
    ])
    const metadata = pageMetadata(seo, "contact", site, BASE)
    expect(metadata).toMatchObject({
      title: { absolute: "כותרת לגוגל" },
      description: site.description,
      openGraph: {
        type: "website",
        locale: "he_IL",
        siteName: site.name,
        title: "כותרת לגוגל",
        url: "/contact",
        description: site.description,
        images: [{ url: site.image!.src }],
      },
      twitter: { title: "כותרת לגוגל", description: site.description },
    })
  })

  it("an edited H1 is the page's H1 and its title in the template", () => {
    const seo = seoPage([
      { key: "gallery", kind: "page_seo", content: { h1: "גלריה" } },
    ])
    expect(pageH1(seo, "gallery", site.name)).toBe("גלריה")
    expect(pageTitle(seo, "gallery", site)).toBe("גלריה")
  })

  it("a Google title is absolute; home without one keeps its title", () => {
    const seo = seoPage([
      {
        key: "contact",
        kind: "page_seo",
        content: { h1: "יצירת קשר", title: "  כותרת לגוגל " },
      },
      { key: "home", kind: "page_seo", content: { h1: "בית", title: "" } },
    ])
    expect(pageTitle(seo, "contact", site)).toEqual({
      absolute: "כותרת לגוגל",
    })
    expect(pageTitle(seo, "home", site)).toEqual({
      absolute: "שם העסק · כותרת ההירו",
    })
    expect(pageTitle(seo, "home", { ...site, heroTitle: null })).toEqual({
      absolute: "שם העסק",
    })
  })

  it("a description of its own, else the site description", () => {
    const seo = seoPage([
      {
        key: "gallery",
        kind: "page_seo",
        content: { h1: "g", description: "תיאור הגלריה" },
      },
    ])
    expect(pageSeoDescription(seo, "gallery", site)).toBe("תיאור הגלריה")
    expect(pageSeoDescription(seo, "contact", site)).toBe(site.description)
    const metadata = pageMetadata(seo, "gallery", site, BASE)
    expect(metadata.description).toBe("תיאור הגלריה")
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      locale: "he_IL",
      siteName: site.name,
      title: `g · ${site.name}`,
      description: "תיאור הגלריה",
      url: "/gallery",
      images: [{ url: site.image!.src, alt: "hero" }],
    })
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: `g · ${site.name}`,
      description: "תיאור הגלריה",
    })
  })

  it("share image: the page's, else the site's, else the hero, else the default", () => {
    const images = {
      [PAGE_IMAGE]: {
        src: "https://cdn/page.jpg",
        alt: "",
        focusX: 50,
        focusY: 50,
      },
      [SITE_IMAGE]: {
        src: "https://cdn/site.jpg",
        alt: "s",
        focusX: 50,
        focusY: 50,
      },
    }
    const both = seoPage(
      [
        {
          key: "site",
          kind: "seo_site",
          content: { image: image(SITE_IMAGE) },
        },
        {
          key: "gallery",
          kind: "page_seo",
          content: { h1: "g", image: image(PAGE_IMAGE) },
        },
      ],
      images
    )
    expect(pageShareImage(both, "gallery", site, BASE).url).toBe(
      "https://cdn/page.jpg"
    )
    expect(pageShareImage(both, "contact", site, BASE).url).toBe(
      "https://cdn/site.jpg"
    )
    expect(pageShareImage(both, null, site, BASE).url).toBe(
      "https://cdn/site.jpg"
    )
    expect(pageShareImage(EMPTY, null, site, BASE).url).toBe(site.image!.src)
    expect(pageShareImage(EMPTY, null, { image: null }, BASE).url).toBe(
      `${BASE}${OG_DEFAULT_PATH}`
    )
    // The page's own image sets the share tags of the page alone.
    const metadata = pageMetadata(both, "gallery", site, BASE)
    expect(metadata.openGraph).toMatchObject({
      images: [{ url: "https://cdn/page.jpg" }],
    })
    expect(metadata.description).toBe(site.description)
  })

  it("an invalid record falls back field by field to the code", () => {
    const seo = seoPage([
      { key: "gallery", kind: "page_seo", content: { h1: "" } },
      { key: "terms", kind: "page_seo", content: { title: "no h1" } },
      { key: "contact", kind: "text_block", content: { title: "x" } },
    ])
    expect(pageH1(seo, "gallery", site.name)).toBe(DEFAULT_H1.gallery)
    expect(pageTitle(seo, "terms", site)).toBe(DEFAULT_H1.terms)
    expect(pageH1(seo, "contact", site.name)).toBe(DEFAULT_H1.contact)
  })
})

describe("the seo_content migration (fix-seo-editor)", () => {
  const dir = join(process.cwd(), "supabase", "migrations")
  const file = readdirSync(dir).find((name) =>
    name.endsWith("_seo_content.sql")
  )
  const sql = readFileSync(join(dir, file!), "utf8")

  it("seeds every page with today's H1 and the wordmark for home", () => {
    for (const key of SEO_PAGE_KEYS) {
      expect(sql).toContain(`('${key}', 'page_seo',`)
    }
    for (const [key, h1] of Object.entries(DEFAULT_H1)) {
      expect(sql).toContain(`('${key}', 'page_seo'`)
      expect(sql).toContain(`'h1', '${h1}'`)
    }
    expect(sql).toContain(`'${WORDMARK}'`)
    expect(sql).toContain("('site', 'seo_site', 1, '{}'::jsonb)")
    expect(sql).not.toMatch(/\bdrop\b/i)
  })
})
