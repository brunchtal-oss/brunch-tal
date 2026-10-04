import { SiteFooter } from "@/components/public/site-footer"
import { TopBar } from "@/components/public/top-bar"
import { WhatsappBar, WhatsappFlowLink } from "@/components/public/whatsapp-bar"
import { SkipLink } from "@/components/shared/skip-link"
import {
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { getPublishedSections, sectionContent } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

// Public shell (AD-2, story 5.2): the sticky top-bar with the menu-sheet,
// <main>, the whatsapp-bar (<aside>, fixed to the bottom; in the flow below
// a 480px window height) and the footer. The business name, the WhatsApp
// link and the footer text come from published content (content:global),
// read from the cache with the anon client; without them the WORDMARK, no
// bar and no footer text.
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [details, site] = await Promise.all([
    getBusinessDetails(),
    getPublishedSections("site"),
  ])
  const name = details?.business_name ?? shellCopy.wordmark
  const whatsappHref = guestWhatsappHref(details)

  return (
    <div
      className={cn(
        "flex min-h-svh flex-col",
        // Room for the fixed whatsapp-bar (48px + 16px from the edge + safe
        // area, plus air) inside the screen-tall shell, so the footer ends
        // above it; none when the bar is in the flow (short window).
        whatsappHref &&
          "pb-[calc(4.5rem+env(safe-area-inset-bottom))] short:pb-0"
      )}
    >
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
      />
    </div>
  )
}
