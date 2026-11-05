import { Suspense } from "react"
import type { Metadata } from "next"

import { JsonLd } from "@/components/public/json-ld"
import { HomeView } from "@/components/public/page-views"
import { UpcomingSessions } from "@/components/public/upcoming-sessions"
import {
  businessNameOf,
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedPage, sectionContent } from "@/lib/content/pages"
import {
  getPageSeo,
  pageH1,
  pageMetadata,
  pageShareImage,
} from "@/lib/seo/page-seo"
import { getSiteSeo } from "@/lib/seo/site-seo"
import { buildStructuredData } from "@/lib/seo/structured-data"
import { siteUrl } from "@/lib/site-url"

// The SEO page's Google title, else "{name} · {hero title}" as is (no
// template), else the name alone; the canonical is the site's root
// (fix-search-ready, fix-seo-editor). Cached readers only.
export async function generateMetadata(): Promise<Metadata> {
  const [seo, site] = await Promise.all([getPageSeo(), getSiteSeo()])
  return pageMetadata(seo, "home", site, siteUrl())
}

// The home page (stories 5.1, 5.2, 5.16, 5.3): HomeView (the hero, the
// intro, the upcoming sessions, about, the testimonials and contact), shared
// with the admin preview. Everything but the sessions is published content
// read from the cache (content:home, content:about, content:gallery,
// content:global) through the anon client, so a draft never reaches it; a
// section without valid, visible published content is not shown. The
// sessions are dynamic (AD-2), inside <Suspense>, so the rest stays cached.
// The business and the website as structured data (JSON-LD), from the same
// published content (fix-search-ready).
export default async function HomePage() {
  const [home, about, gallery, details, site, seo, pageSeo] = await Promise.all(
    [
      getPublishedPage("home"),
      getPublishedPage("about"),
      getPublishedPage("gallery"),
      getBusinessDetails(),
      getPublishedPage("site"),
      getSiteSeo(),
      getPageSeo(),
    ]
  )

  return (
    <>
      <JsonLd
        data={buildStructuredData({
          name: seo.name,
          url: siteUrl(),
          details,
          description: seo.description,
          image: pageShareImage(pageSeo, null, seo, siteUrl()).url,
          footer: sectionContent(site.sections, "footer", "footer"),
        })}
      />
      <HomeView
        home={home.sections}
        about={about.sections}
        gallery={gallery.sections}
        images={{ ...home.images, ...about.images, ...gallery.images }}
        // The H1: the SEO page's, else the business name (fix-seo-editor).
        name={pageH1(pageSeo, "home", businessNameOf(details))}
        whatsappHref={guestWhatsappHref(details)}
        sessions={
          <Suspense fallback={null}>
            <UpcomingSessions />
          </Suspense>
        }
      />
    </>
  )
}
