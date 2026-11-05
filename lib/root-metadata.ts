import type { Metadata } from "next"

import { titleTemplateOf } from "@/lib/copy/shell"
import type { ShareImage } from "@/lib/seo/metadata"

export type RootMetadataOptions = {
  /** The site's base URL (siteUrl()): relative URLs resolve against it. */
  siteUrl?: string
  /** The site description: the home hero's published description. */
  description?: string | null
  /** The share image (shareImage(): the hero's photo, else the default). */
  image?: ShareImage | null
}

// The root layout's metadata for a business name (story 5.20): the tab
// title "{page name} · {name}", the name alone on a page without its own
// title, and the name under the icon on an iPhone home screen (story 5.9:
// full screen). The manifest link is added by app/manifest.ts.
// fix-search-ready: the base for absolute URLs, the site description and
// the share tags (Open Graph, X) for every page.
export function rootMetadata(
  name: string,
  options: RootMetadataOptions = {}
): Metadata {
  const { siteUrl, description, image } = options
  const images = image ? [image] : undefined
  return {
    ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
    title: { default: name, template: titleTemplateOf(name) },
    ...(description ? { description } : {}),
    appleWebApp: { capable: true, title: name },
    icons: { apple: "/icons/apple-touch-icon.png" },
    openGraph: {
      type: "website",
      locale: "he_IL",
      siteName: name,
      ...(description ? { description } : {}),
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      ...(description ? { description } : {}),
      ...(images ? { images } : {}),
    },
  }
}
