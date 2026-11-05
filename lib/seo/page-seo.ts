import type { Metadata } from "next"

import { getPublishedPage, type PublishedPage } from "@/lib/content/pages"
import type { PageSeoContent } from "@/lib/content/schema"
import type { ImageMap, ResolvedImage } from "@/lib/content/visible"
import { shellCopy } from "@/lib/copy/shell"
import { rootMetadata } from "@/lib/root-metadata"

import {
  homeTitle,
  pageDescription,
  shareImage,
  type ShareImage,
  type SiteSeo,
} from "./metadata"

// What Tal sets per public page in the content editor's SEO page
// (fix-seo-editor): the page's H1, its Google title, its description and its
// share image, and one share image for the whole site. Read from published
// content only (getPublishedPage("seo"), tag content:seo). A missing or
// invalid record falls back, field by field, to the values the code used
// before the SEO page existed, so the site never breaks without it.

export const SEO_PAGE_KEYS = [
  "home",
  "sessions",
  "how_it_works",
  "gallery",
  "contact",
  "privacy",
  "terms",
  "accessibility",
] as const

export type SeoPageKey = (typeof SEO_PAGE_KEYS)[number]

export function isSeoPageKey(value: unknown): value is SeoPageKey {
  return (
    typeof value === "string" &&
    (SEO_PAGE_KEYS as readonly string[]).includes(value)
  )
}

/** Each page's address on the site. */
export const SEO_PAGE_PATHS: Record<SeoPageKey, string> = {
  home: "/",
  sessions: "/sessions",
  how_it_works: "/how-it-works",
  gallery: "/gallery",
  contact: "/contact",
  privacy: "/privacy",
  terms: "/terms",
  accessibility: "/accessibility",
}

// The H1 of each inner page before the SEO page (the navigation's names);
// the home page's is the business name. Also the migration's seed.
export const DEFAULT_H1: Record<Exclude<SeoPageKey, "home">, string> = {
  sessions: shellCopy.nav.publicSessions,
  how_it_works: shellCopy.nav.howItWorks,
  gallery: shellCopy.nav.gallery,
  contact: shellCopy.nav.contact,
  privacy: shellCopy.public.footer.privacy,
  terms: shellCopy.public.footer.terms,
  accessibility: shellCopy.public.footer.accessibility,
}

export type PageSeo = {
  pages: Partial<Record<SeoPageKey, PageSeoContent>>
  /** seo › site's published image, resolved; null without one. */
  siteImage: ResolvedImage | null
  images: ImageMap
}

const EMPTY: PageSeo = { pages: {}, siteImage: null, images: {} }

function imageOf(
  images: ImageMap,
  image: { media_id: string } | undefined
): ResolvedImage | null {
  return image && Object.hasOwn(images, image.media_id)
    ? images[image.media_id]
    : null
}

/** The published SEO records (the visible, valid sections of `seo`). */
export function pageSeoFrom(page: PublishedPage | null): PageSeo {
  if (!page) return EMPTY
  const pages: PageSeo["pages"] = {}
  for (const key of SEO_PAGE_KEYS) {
    const section = Object.hasOwn(page.sections, key)
      ? page.sections[key]
      : undefined
    if (section?.kind === "page_seo") pages[key] = section.content
  }
  const site = Object.hasOwn(page.sections, "site")
    ? page.sections.site
    : undefined
  return {
    pages,
    siteImage:
      site?.kind === "seo_site"
        ? imageOf(page.images, site.content.image)
        : null,
    images: page.images,
  }
}

/** The published SEO records, from the cached reader (tag content:seo). */
export async function getPageSeo(): Promise<PageSeo> {
  return pageSeoFrom(await getPublishedPage("seo"))
}

function recordOf(seo: PageSeo, key: SeoPageKey | null) {
  return key && Object.hasOwn(seo.pages, key) ? seo.pages[key] : undefined
}

/** The page's H1: the record's, else today's (home: the business name). */
export function pageH1(seo: PageSeo, key: SeoPageKey, name: string): string {
  return (
    recordOf(seo, key)?.h1?.trim() || (key === "home" ? name : DEFAULT_H1[key])
  )
}

/**
 * The page's <title>: the record's Google title as is (absolute), else
 * today's: the home page's whole title, or the H1 in the site's template
 * ("{H1} · {name}").
 */
export function pageTitle(
  seo: PageSeo,
  key: SeoPageKey,
  site: Pick<SiteSeo, "name" | "heroTitle">
): { absolute: string } | string {
  const own = recordOf(seo, key)?.title?.trim()
  if (own) return { absolute: own }
  if (key === "home") {
    return { absolute: homeTitle(site.name, site.heroTitle) }
  }
  return pageH1(seo, key, site.name)
}

/** The title as the tab and a search result show it. */
export function fullTitle(
  title: { absolute: string } | string,
  name: string
): string {
  return typeof title === "string" ? `${title} · ${name}` : title.absolute
}

/**
 * A page's description: the record's, else the site description (the home
 * hero's). null (the root layout): the site description.
 */
export function pageSeoDescription(
  seo: PageSeo,
  key: SeoPageKey | null,
  site: Pick<SiteSeo, "description">
): string | null {
  return pageDescription(key, site, seo)
}

/**
 * A page's share image: the record's, else the site's (seo › site), else
 * the home hero's photo, else the default image. null: the site's chain.
 */
export function pageShareImage(
  seo: PageSeo,
  key: SeoPageKey | null,
  site: Pick<SiteSeo, "image">,
  base: string
): ShareImage {
  const own = imageOf(seo.images, recordOf(seo, key)?.image)
  return shareImage({ image: own ?? seo.siteImage ?? site.image }, base)
}

/**
 * A public page's metadata: its title and canonical, its description, and
 * its share tags (og:title, og:url, twitter:title, the description and the
 * share image, with the root's type, locale and site name; Next replaces the
 * nested objects, so they are built whole). An untouched record gives the
 * same H1, <title>, description and og:image as before.
 */
export function pageMetadata(
  seo: PageSeo,
  key: SeoPageKey,
  site: SiteSeo,
  base: string
): Metadata {
  const title = pageTitle(seo, key, site)
  const metadata: Metadata = {
    title,
    alternates: { canonical: SEO_PAGE_PATHS[key] },
  }
  const description = pageSeoDescription(seo, key, site)
  const share = rootMetadata(site.name, {
    siteUrl: base,
    description,
    image: pageShareImage(seo, key, site, base),
  })
  const shown = fullTitle(title, site.name)
  return {
    ...metadata,
    ...(description ? { description } : {}),
    openGraph: { ...share.openGraph, title: shown, url: SEO_PAGE_PATHS[key] },
    twitter: { ...share.twitter, title: shown },
  }
}
