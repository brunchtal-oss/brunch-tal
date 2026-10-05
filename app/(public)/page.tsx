import { Suspense } from "react"

import { HomeView } from "@/components/public/page-views"
import { UpcomingSessions } from "@/components/public/upcoming-sessions"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedPage } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

// The home page (stories 5.1, 5.2, 5.16, 5.3): HomeView (the hero, the
// intro, the upcoming sessions, about, the testimonials and contact), shared
// with the admin preview. Everything but the sessions is published content
// read from the cache (content:home, content:about, content:gallery,
// content:global) through the anon client, so a draft never reaches it; a
// section without valid, visible published content is not shown. The
// sessions are dynamic (AD-2), inside <Suspense>, so the rest stays cached.
// Title: the root default.
export default async function HomePage() {
  const [home, about, gallery, details] = await Promise.all([
    getPublishedPage("home"),
    getPublishedPage("about"),
    getPublishedPage("gallery"),
    getBusinessDetails(),
  ])

  return (
    <HomeView
      home={home.sections}
      about={about.sections}
      gallery={gallery.sections}
      images={{ ...home.images, ...about.images, ...gallery.images }}
      name={details?.business_name ?? shellCopy.wordmark}
      whatsappHref={guestWhatsappHref(details)}
      sessions={
        <Suspense fallback={null}>
          <UpcomingSessions />
        </Suspense>
      }
    />
  )
}
