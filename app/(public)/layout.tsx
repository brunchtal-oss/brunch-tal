import { Suspense } from "react"

import { CookieNotice } from "@/components/public/cookie-notice"
import { MarketingTags } from "@/components/public/marketing-tags"
import { SiteFooter } from "@/components/public/site-footer"
import { TopBar } from "@/components/public/top-bar"
import { ViewerTopBar, ViewerWhatsapp } from "@/components/public/viewer-shell"
import { SkipLink } from "@/components/shared/skip-link"
import {
  businessNameOf,
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import {
  getPublishedPageSlugs,
  getPublishedSections,
  sectionContent,
} from "@/lib/content/pages"
import { getMarketingTags } from "@/lib/content/marketing-tags"
import { footerLinks } from "@/lib/content/visible"
import { cookieNoticeView } from "@/lib/cookie-notice"
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
// Story 5.23: the cookie notice (cookie-notice › notice, cached, tag
// content:cookie-notice), right after the skip link; its link to /privacy
// only once privacy is published. Whether this device clicked "הבנתי" is
// read in the browser only (components/public/cookie-notice.tsx).
// Story 5.24: the marketing tags (cached, tag marketing-tags) render last,
// for every visitor, here only (components/public/marketing-tags.tsx).
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [details, legalSlugs, site, cookie, tags] = await Promise.all([
    getBusinessDetails(),
    getPublishedPageSlugs(publicLegalNav.map((item) => item.slug)),
    getPublishedSections("site"),
    getPublishedSections("cookie-notice"),
    getMarketingTags(),
  ])
  const links = footerLinks(sectionContent(site, "footer", "footer")?.items)
  const name = businessNameOf(details)
  const whatsappHref = guestWhatsappHref(details)
  const notice = cookieNoticeView(
    sectionContent(cookie, "notice", "cookie_notice"),
    legalSlugs.includes("privacy")
  )

  return (
    <div className="flex min-h-svh flex-col">
      <SkipLink />
      {notice && <CookieNotice {...notice} />}
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
        links={links}
      />
      <MarketingTags {...tags} />
    </div>
  )
}
