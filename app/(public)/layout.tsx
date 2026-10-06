import { Suspense } from "react"

import { SiteFooter } from "@/components/public/site-footer"
import { TopBar } from "@/components/public/top-bar"
import { ViewerTopBar, ViewerWhatsapp } from "@/components/public/viewer-shell"
import { SkipLink } from "@/components/shared/skip-link"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import {
  getPublishedPageSlugs,
  getPublishedSections,
  sectionContent,
} from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"
import { publicLegalNav, visibleLegalNav } from "@/lib/nav"

// Public shell (AD-2, story 5.2): the sticky top-bar with the menu-sheet,
// <main>, the whatsapp-bar (<aside>, fixed to the bottom; in the flow below
// a 480px window height) and the footer. The business name, the WhatsApp
// link and the footer's contact lines come from the published business
// details (content:global), read from the cache with the anon client;
// without them the WORDMARK and no bar. The footer links to the
// accessibility statement always and to privacy and terms once published
// (visibleLegalNav, story 5.5), and shows the visible links of site › footer
// (content:site, content:global; story 5.3).
// Story 5.7: the account link and the whatsapp-bar follow the viewer's role,
// read in their own <Suspense> (never cached): the link's fallback is the
// guest's, the bar's fallback is empty and the bar comes for anyone but a
// signed-in customer. The footer keeps room for the bar only while it is
// shown (app/globals.css › [data-site-footer]).
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [details, legalSlugs, site] = await Promise.all([
    getBusinessDetails(),
    getPublishedPageSlugs(publicLegalNav.map((item) => item.slug)),
    getPublishedSections("site"),
  ])
  const footerLinks = sectionContent(site, "footer", "footer")?.items ?? []
  const name = details?.business_name ?? shellCopy.wordmark
  const whatsappHref = guestWhatsappHref(details)

  return (
    <div className="flex min-h-svh flex-col">
      <SkipLink />
      <Suspense fallback={<TopBar name={name} />}>
        <ViewerTopBar name={name} />
      </Suspense>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <Suspense fallback={null}>
        <ViewerWhatsapp href={whatsappHref} />
      </Suspense>
      <SiteFooter
        details={details}
        legal={visibleLegalNav(legalSlugs)}
        links={footerLinks}
      />
    </div>
  )
}
