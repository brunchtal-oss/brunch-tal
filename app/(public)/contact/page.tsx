import type { Metadata } from "next"

import { ContactView } from "@/components/public/page-views"
import { getBusinessDetails } from "@/lib/content/business-details"
import { getPublishedSections } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"

export const metadata: Metadata = { title: shellCopy.nav.contact }

// /contact (stories 5.2, 5.3): contact › intro and the published business
// details (content:contact, content:global), through ContactView, shared
// with the admin preview. WhatsApp is the whatsapp-bar below.
export default async function ContactPage() {
  const [sections, details] = await Promise.all([
    getPublishedSections("contact"),
    getBusinessDetails(),
  ])
  return <ContactView sections={sections} details={details} />
}
