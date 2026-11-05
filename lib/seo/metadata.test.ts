import { describe, expect, it } from "vitest"

import type { PublishedPage } from "@/lib/content/pages"
import { shellCopy, WORDMARK } from "@/lib/copy/shell"

import {
  homeTitle,
  pageDescription,
  sessionMetadata,
  shareImage,
  sessionPageTitle,
  siteSeoFrom,
  truncateDescription,
  type ParentShare,
} from "./metadata"

describe("truncateDescription (fix-search-ready)", () => {
  it("keeps a short text, with its whitespace collapsed", () => {
    expect(truncateDescription("  שולחן   ערוך\nבבוקר  ")).toBe(
      "שולחן ערוך בבוקר"
    )
  })

  it("cuts a long text at a word, with the ellipsis inside the limit", () => {
    const text = "מילה ".repeat(60).trim()
    const result = truncateDescription(text, 155)
    expect(result.length).toBeLessThanOrEqual(155)
    expect(result.endsWith("מילה…")).toBe(true)
  })

  it("does not leave punctuation before the ellipsis", () => {
    expect(truncateDescription("אחת, שתיים שלוש", 10)).toBe("אחת…")
  })

  it("cuts one long word inside it", () => {
    expect(truncateDescription("a".repeat(20), 10)).toBe(`${"a".repeat(9)}…`)
  })
})

describe("sessionPageTitle", () => {
  it("is the session title and its weekday and date (Israel time)", () => {
    // 2026-10-12 07:00Z is Monday 10:00 in Israel.
    expect(sessionPageTitle("יווני", "2026-10-12T07:00:00Z")).toBe(
      "בראנץ׳ יווני · יום שני 12.10"
    )
  })
})

describe("sessionMetadata (fix-search-ready)", () => {
  const id = "11111111-1111-4111-8111-111111111111"
  const startsAt = "2026-10-12T07:00:00Z"
  const title = "בראנץ׳ יווני · יום שני 12.10"
  // The root layout's share tags, as Next resolves them.
  const parent = {
    openGraph: {
      type: "website",
      locale: "he_IL",
      siteName: "שם העסק",
      title: { absolute: "שם העסק", template: null },
      description: "תיאור האתר",
      images: [{ url: "https://cdn.example/hero.jpg" }],
    },
    twitter: {
      card: "summary_large_image",
      title: { absolute: "שם העסק", template: null },
      description: "תיאור האתר",
      images: [{ url: "https://cdn.example/hero.jpg" }],
    },
  } as unknown as ParentShare

  it("a session with a description and a photo", () => {
    const metadata = sessionMetadata(
      {
        id,
        concept_name: "יווני",
        starts_at: startsAt,
        description: "מילה ".repeat(60),
        photo: {
          photoUrl: "https://cdn.example/session.jpg",
          photoAlt: "שולחן",
          focusX: 50,
          focusY: 50,
        },
      },
      parent
    )
    expect(metadata.title).toBe(title)
    expect(metadata.alternates).toEqual({ canonical: `/sessions/${id}` })
    const description = metadata.description as string
    expect(description.length).toBeLessThanOrEqual(155)
    expect(description.endsWith("…")).toBe(true)
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      locale: "he_IL",
      siteName: "שם העסק",
      title,
      url: `/sessions/${id}`,
      description,
      images: [{ url: "https://cdn.example/session.jpg", alt: "שולחן" }],
    })
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title,
      description,
      images: [{ url: "https://cdn.example/session.jpg", alt: "שולחן" }],
    })
  })

  it("a session without a description or a photo keeps the site's", () => {
    const metadata = sessionMetadata(
      {
        id,
        concept_name: "יווני",
        starts_at: startsAt,
        description: null,
        photo: null,
      },
      parent
    )
    expect(metadata.title).toBe(title)
    expect(metadata).not.toHaveProperty("description")
    expect(metadata.alternates).toEqual({ canonical: `/sessions/${id}` })
    expect(metadata.openGraph).toEqual({
      type: "website",
      locale: "he_IL",
      siteName: "שם העסק",
      title,
      url: `/sessions/${id}`,
      description: "תיאור האתר",
      images: [{ url: "https://cdn.example/hero.jpg" }],
    })
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      title,
      description: "תיאור האתר",
      images: [{ url: "https://cdn.example/hero.jpg" }],
    })
  })

  it("never adds an empty images list", () => {
    const metadata = sessionMetadata(
      {
        id,
        concept_name: "יווני",
        starts_at: startsAt,
        description: null,
        photo: null,
      },
      { openGraph: null, twitter: null }
    )
    expect(metadata.openGraph).not.toHaveProperty("images")
    expect(metadata.twitter).not.toHaveProperty("images")
  })

  it("a session that is gone: the not-found title and noindex", () => {
    expect(sessionMetadata(null, parent)).toEqual({
      title: shellCopy.public.sessionNotFound.title,
      robots: { index: false, follow: false },
    })
  })
})

describe("siteSeoFrom (fix-search-ready)", () => {
  const mediaId = "22222222-2222-4222-8222-222222222222"
  const image = {
    src: "https://cdn.example/hero.jpg",
    alt: "שולחן",
    focusX: 50,
    focusY: 50,
  }
  function home(
    hero: Record<string, unknown> | null,
    images: PublishedPage["images"] = {}
  ): PublishedPage {
    return {
      sections: hero
        ? ({
            hero: { kind: "hero", content: hero },
          } as PublishedPage["sections"])
        : {},
      images,
    }
  }
  const details = {
    whatsapp_phone: "+972544256456",
    business_name: "שם העסק",
  } as Parameters<typeof siteSeoFrom>[0]

  it("the hero's description (not its title) is the description", () => {
    const seo = siteSeoFrom(
      details,
      home(
        {
          title: "כותרת",
          description: "תיאור",
          image: { media_id: mediaId, alt: "", focus_x: 50, focus_y: 50 },
        },
        { [mediaId]: image }
      )
    )
    expect(seo).toEqual({
      name: "שם העסק",
      heroTitle: "כותרת",
      description: "תיאור",
      image,
    })
  })

  it("a blank title or description is null, and no hero is nothing", () => {
    expect(
      siteSeoFrom(details, home({ title: "  ", description: "" }))
    ).toMatchObject({ heroTitle: null, description: null, image: null })
    expect(siteSeoFrom(null, home(null))).toEqual({
      name: WORDMARK,
      heroTitle: null,
      description: null,
      image: null,
    })
  })

  it("the image only when the published images have the hero's media_id", () => {
    const hero = {
      image: { media_id: mediaId, alt: "", focus_x: 50, focus_y: 50 },
    }
    expect(siteSeoFrom(details, home(hero)).image).toBeNull()
    expect(siteSeoFrom(details, home(hero, { other: image })).image).toBeNull()
    expect(
      siteSeoFrom(details, home(hero, { [mediaId]: image })).image
    ).toEqual(image)
  })
})

describe("homeTitle", () => {
  it("the name and the hero title, else the name", () => {
    expect(homeTitle("שם", "כותרת")).toBe("שם · כותרת")
    expect(homeTitle("שם", null)).toBe("שם")
  })
})

describe("shareImage (fix-search-ready)", () => {
  const base = "https://example.co.il"

  it("the hero's published photo", () => {
    expect(
      shareImage(
        {
          image: {
            src: "https://cdn.example/hero.jpg",
            alt: "שולחן",
            focusX: 50,
            focusY: 50,
          },
        },
        base
      )
    ).toEqual({ url: "https://cdn.example/hero.jpg", alt: "שולחן" })
  })

  it("else the default image, absolute, 1200x630, with its alt", () => {
    expect(shareImage({ image: null }, base)).toEqual({
      url: "https://example.co.il/og-default.jpg",
      width: 1200,
      height: 630,
      alt: shellCopy.public.ogDefaultAlt,
    })
    expect(shellCopy.public.ogDefaultAlt).toBe("שולחן בראנץ׳ ערוך מלמעלה")
  })
})

describe("pageDescription", () => {
  it("is the site description for every page today", () => {
    const site = { description: "תיאור האתר" }
    expect(pageDescription(null, site)).toBe("תיאור האתר")
    expect(pageDescription("gallery", site)).toBe("תיאור האתר")
    expect(pageDescription(null, { description: null })).toBeNull()
  })
})
