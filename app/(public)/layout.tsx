import { SiteFooter } from "@/components/public/site-footer"
import { TopBar } from "@/components/public/top-bar"
import { WhatsappBar, WhatsappFlowLink } from "@/components/public/whatsapp-bar"
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
import { publicLegalNav } from "@/lib/nav"
import { cn } from "@/lib/utils"

// Public shell (AD-2, story 5.2): the sticky top-bar with the menu-sheet,
// <main>, the whatsapp-bar (<aside>, fixed to the bottom; in the flow below
// a 480px window height) and the footer. The business name, the WhatsApp
// link and the footer text come from published content (content:global),
// read from the cache with the anon client; without them the WORDMARK, no
// bar and no footer text. The footer links to a legal page once it is
// published.
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [details, site, legalSlugs] = await Promise.all([
    getBusinessDetails(),
    getPublishedSections("site"),
    getPublishedPageSlugs(publicLegalNav.map((item) => item.slug)),
  ])
  const name = details?.business_name ?? shellCopy.wordmark
  const whatsappHref = guestWhatsappHref(details)

  return (
    <div className="flex min-h-svh flex-col">
      <SkipLink />
      <TopBar name={name} />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <WhatsappBar href={whatsappHref} />
      <WhatsappFlowLink href={whatsappHref} />
      <SiteFooter
        name={name}
        footer={sectionContent(site, "footer", "footer")}
        details={details}
        legal={publicLegalNav.filter((item) => legalSlugs.includes(item.slug))}
        className={cn(
          // Room for the fixed whatsapp-bar (48px + 16px from the edge +
          // safe area, plus air) inside the footer's band, so its text ends
          // above the bar and the band reaches the bottom of the screen;
          // none when the bar is in the flow (short window).
          whatsappHref &&
            "pb-[calc(4.5rem+env(safe-area-inset-bottom))] short:pb-0"
        )}
      />
    </div>
  )
}
