import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { getWhatsappHref } from "@/lib/content/business-details"
import { authCopy } from "@/lib/copy/auth"

import { ForgotForm } from "./forgot-form"

// Story 6.11: "forgot password", for a customer and for Tal alike (the
// link under both login forms). The answer comes from the action; its
// "צרי קשר" links to the published business WhatsApp.
export const metadata: Metadata = {
  title: authCopy.forgot.title,
  robots: { index: false, follow: false },
}

export default async function ForgotPasswordPage() {
  const contactHref = await getWhatsappHref()
  return (
    <>
      <PageHeading>{authCopy.forgot.title}</PageHeading>
      <ForgotForm loginHref="/login" contactHref={contactHref} />
    </>
  )
}
