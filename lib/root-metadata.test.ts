import { describe, expect, it } from "vitest"

import { shellCopy, WORDMARK } from "@/lib/copy/shell"
import { shareImage } from "@/lib/seo/metadata"

import { rootMetadata } from "./root-metadata"

describe("rootMetadata (story 5.20)", () => {
  it("the name in the title, its template and the iPhone home screen", () => {
    expect(rootMetadata("שם חדש")).toEqual({
      title: { default: "שם חדש", template: "%s · שם חדש" },
      appleWebApp: { capable: true, title: "שם חדש" },
      icons: { apple: "/icons/apple-touch-icon.png" },
      openGraph: { type: "website", locale: "he_IL", siteName: "שם חדש" },
      twitter: { card: "summary_large_image" },
    })
  })

  it("the fallback name keeps the old title", () => {
    expect(rootMetadata(WORDMARK).title).toEqual({
      default: WORDMARK,
      template: `%s · ${WORDMARK}`,
    })
  })

  it("the base URL, description and share image (fix-search-ready)", () => {
    const image = { url: "https://cdn.example/hero.jpg", alt: "שולחן" }
    const metadata = rootMetadata("שם", {
      siteUrl: "https://example.co.il",
      description: "תיאור האתר",
      image,
    })
    expect(String(metadata.metadataBase)).toBe("https://example.co.il/")
    expect(metadata.description).toBe("תיאור האתר")
    expect(metadata.openGraph).toEqual({
      type: "website",
      locale: "he_IL",
      siteName: "שם",
      description: "תיאור האתר",
      images: [image],
    })
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      description: "תיאור האתר",
      images: [image],
    })
  })

  it("without a hero photo: the default image on the site", () => {
    const base = "https://example.co.il"
    const metadata = rootMetadata("שם", {
      siteUrl: base,
      image: shareImage({ image: null }, base),
    })
    const expected = {
      url: "https://example.co.il/og-default.jpg",
      width: 1200,
      height: 630,
      alt: shellCopy.public.ogDefaultAlt,
    }
    expect(metadata.openGraph).toMatchObject({ images: [expected] })
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      images: [expected],
    })
  })
})
