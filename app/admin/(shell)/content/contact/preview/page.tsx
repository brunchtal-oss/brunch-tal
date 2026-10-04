import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"

import { ContactDetails } from "@/components/public/contact-details"
import { PublicPageHeading } from "@/components/public/public-page"
import { businessDetailsSchema } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { hasPendingDraft, sectionOf } from "../../content-items"
import { PreviewBar } from "../../home/preview/preview-bar"
import { loadContentPage } from "../../load-page"

export const metadata: Metadata = {
  title: adminCopy.content.previewTitle,
}

// /admin/content/contact/preview (story 5.2): /contact's business details
// component with the saved draft (else what is published), under the fixed
// bar "preview, not published yet". Dynamic, admin only, never cached
// (AD-16): the draft is read with the admin's session.
export default function ContactPreviewPage() {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <Preview />
    </Suspense>
  )
}

async function Preview() {
  const page = await loadContentPage("contact")
  const section = sectionOf(page, "business_details")
  const pending = section ? hasPendingDraft(section) : false
  const content = pending ? section?.draft_content : section?.published_content
  const parsed = businessDetailsSchema.safeParse(content)
  const details = parsed.success ? parsed.data : null

  return (
    <div className="flex min-h-[70svh] flex-col">
      <PreviewBar
        slug="contact"
        hasPending={pending}
        publishKey={randomUUID()}
      />
      <div className="-mx-6 flex flex-1 flex-col border-b border-border pb-12">
        <PublicPageHeading>{shellCopy.nav.contact}</PublicPageHeading>
        <div className="px-6 pt-8">
          <ContactDetails details={details} />
        </div>
      </div>
    </div>
  )
}
