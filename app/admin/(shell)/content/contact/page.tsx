import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import type { EditorField } from "../content-editor"
import { EditorContent } from "../editor-page"

const copy = adminCopy.content
const business = copy.business

export const metadata: Metadata = {
  title: copy.pages.contact,
}

// The business details' fields (lib/content/schema.ts ›
// businessDetailsSchema).
const FIELDS: readonly EditorField[] = [
  {
    name: "whatsapp_phone",
    label: business.whatsappPhone,
    hint: business.whatsappPhoneHint,
    type: "tel",
    maxLength: 30,
    ltr: true,
  },
  { name: "business_name", label: business.businessName, maxLength: 80 },
  {
    name: "phone",
    label: business.phone,
    type: "tel",
    maxLength: 30,
    ltr: true,
  },
  {
    name: "whatsapp_message",
    label: business.whatsappMessage,
    hint: business.whatsappMessageHint,
    multiline: true,
    maxLength: 500,
  },
  { name: "address", label: business.address, maxLength: 200 },
  {
    name: "arrival_instructions",
    label: business.arrivalInstructions,
    multiline: true,
    maxLength: 1000,
  },
  {
    name: "navigation_url",
    label: business.navigationUrl,
    hint: business.navigationUrlHint,
    type: "url",
    maxLength: 500,
    ltr: true,
  },
  {
    name: "payment_instructions",
    label: business.paymentInstructions,
    multiline: true,
    maxLength: 1000,
  },
]

// /admin/content/contact (story 5.1): the business details, one record for
// the whole site. Its preview comes with /contact in 5.2.
export default function ContentContactPage() {
  return (
    <>
      <PageHeading>{copy.pages.contact}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <EditorContent slug="contact" fields={FIELDS} />
      </Suspense>
    </>
  )
}
