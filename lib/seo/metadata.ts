import type { Metadata, ResolvedMetadata } from "next"

import { businessNameOf } from "@/lib/content/business-details"
import type { PublishedPage } from "@/lib/content/pages"
import type { BusinessDetailsContent } from "@/lib/content/schema"
import type { ResolvedImage } from "@/lib/content/visible"
import { shellCopy } from "@/lib/copy/shell"
import { customerCopy } from "@/lib/copy/customer"
import type { PublicSession } from "@/lib/sessions/public"
import { formatSessionDate } from "@/lib/time"

// Page metadata helpers (fix-search-ready).

/**
 * A description for search results and shares: whitespace collapsed, at
 * most `max` characters. A longer text is cut at the last space that fits
 * and ends with "…" (counted in the limit); one long word is cut inside it.
 */
export function truncateDescription(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  const room = clean.slice(0, max - 1)
  const space = room.lastIndexOf(" ")
  const cut = (space > 0 ? room.slice(0, space) : room).replace(
    /[\s.,;:!?\-–—]+$/,
    ""
  )
  return `${cut}…`
}

/** "בראנץ׳ {concept} · יום שני 12.10": a session page's own title. */
export function sessionPageTitle(concept: string, startsAt: string): string {
  return `${customerCopy.sessionTitle(concept)} · ${formatSessionDate(startsAt)}`
}

/** The parent's share tags (the root layout's, resolved). */
export type ParentShare = Pick<ResolvedMetadata, "openGraph" | "twitter">

/**
 * A session page's metadata (fix-search-ready): its own title,
 * description, share photo, canonical and og:url. Without a description or
 * a photo, the parent's (the site's) stay. Next replaces the nested
 * openGraph/twitter objects, so the parent's are spread in and their titles
 * are set again. A session that is gone (null) is not indexed.
 */
export function sessionMetadata(
  session: Pick<
    PublicSession,
    "id" | "concept_name" | "starts_at" | "description" | "photo"
  > | null,
  parent: ParentShare
): Metadata {
  if (!session) {
    return {
      title: shellCopy.public.sessionNotFound.title,
      robots: { index: false, follow: false },
    }
  }
  const title = sessionPageTitle(session.concept_name, session.starts_at)
  const path = `/sessions/${session.id}`
  const description = session.description
    ? truncateDescription(session.description)
    : null
  const images = session.photo
    ? [
        {
          url: session.photo.photoUrl,
          ...(session.photo.photoAlt ? { alt: session.photo.photoAlt } : {}),
        },
      ]
    : null
  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: path },
    openGraph: {
      ...parent.openGraph,
      title,
      url: path,
      ...(description ? { description } : {}),
      ...(images ? { images } : {}),
    },
    twitter: {
      ...parent.twitter,
      title,
      ...(description ? { description } : {}),
      ...(images ? { images, card: "summary_large_image" as const } : {}),
    },
  }
}

// What search and share tags say about the site: the published business
// name, and the home hero's title, description and photo. Published content
// only: a draft or a hidden item never reaches a tag.
export type SiteSeo = {
  name: string
  heroTitle: string | null
  description: string | null
  image: ResolvedImage | null
}

function filled(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

export function siteSeoFrom(
  details: BusinessDetailsContent | null,
  home: PublishedPage
): SiteSeo {
  const section = Object.hasOwn(home.sections, "hero")
    ? home.sections.hero
    : undefined
  const hero = section?.kind === "hero" ? section.content : null
  const mediaId = hero?.image?.media_id
  return {
    name: businessNameOf(details),
    heroTitle: filled(hero?.title),
    description: filled(hero?.description),
    image:
      mediaId && Object.hasOwn(home.images, mediaId)
        ? home.images[mediaId]
        : null,
  }
}

/** The home page's whole title: "{name} · {hero title}", else the name. */
export function homeTitle(name: string, heroTitle: string | null): string {
  return heroTitle ? `${name} · ${heroTitle}` : name
}

/** A share image (Open Graph, X), with an absolute URL. */
export type ShareImage = {
  url: string
  alt?: string
  width?: number
  height?: number
}

/** The default share image (public/og-default.jpg, 1200x630). */
export const OG_DEFAULT_PATH = "/og-default.jpg"

/**
 * The site's share image: the home hero's published photo, else the
 * default image on this site (fix-search-ready). Also the JSON-LD image.
 */
export function shareImage(
  site: Pick<SiteSeo, "image">,
  base: string
): ShareImage {
  if (site.image) {
    return {
      url: site.image.src,
      ...(site.image.alt ? { alt: site.image.alt } : {}),
    }
  }
  return {
    url: `${base}${OG_DEFAULT_PATH}`,
    width: 1200,
    height: 630,
    alt: shellCopy.public.ogDefaultAlt,
  }
}

/**
 * A page's description for search results and shares: the description Tal
 * set for the page in the content editor's SEO page (fix-seo-editor), else
 * the site description, the home hero's. page null: the root layout's
 * site-wide default.
 */
export function pageDescription(
  page: string | null,
  site: Pick<SiteSeo, "description">,
  seo?: { pages: Partial<Record<string, { description?: string }>> }
): string | null {
  const record =
    page && seo && Object.hasOwn(seo.pages, page) ? seo.pages[page] : undefined
  return record?.description?.trim() || site.description
}
