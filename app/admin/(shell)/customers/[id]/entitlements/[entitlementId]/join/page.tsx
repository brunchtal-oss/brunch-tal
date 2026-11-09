import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PageHeading } from "@/components/shared/page-heading"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { getPhotoConsentContent } from "@/lib/content/join-form"
import { getPublishedPageSlugs } from "@/lib/content/pages"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { errorMessage } from "@/lib/errors"
import { localToday } from "@/lib/time"

import { BackLink } from "../../../back-link"
import {
  entitlementHref,
  isVoided,
  nameOf,
  UNBOUND_SEGMENT,
} from "../entitlement-items"
import { loadEntitlement } from "../load-entitlement"
import { FillJoinForm, FillUsed, FillVoided } from "./fill-outcome"

const copy = adminCopy.customers.entitlement.fill

export const metadata: Metadata = {
  title: copy.title,
}

// Tal fills the join form together with a customer who paid but struggles
// with her link (story 2.15, user decision 2026-11-09). The same form as the
// customer's (JoinForm), with the same published photo questions and privacy
// policy. Opening the page changes nothing: the customer's link is revoked
// only when Tal submits. A bound or voided purchase opens its outcome screen.
export default function FillJoinPage({
  params,
}: {
  params: Promise<{ id: string; entitlementId: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <FillJoinContent params={params} />
    </Suspense>
  )
}

async function FillJoinContent({
  params,
}: {
  params: Promise<{ id: string; entitlementId: string }>
}) {
  const { id, entitlementId } = await params
  const page = await loadEntitlement(entitlementId)
  // A purchase bound since the link was opened still answers here.
  if (page.customer_id === null && id !== UNBOUND_SEGMENT) notFound()
  if (
    page.customer_id !== null &&
    id !== UNBOUND_SEGMENT &&
    id !== page.customer_id
  ) {
    notFound()
  }

  const header = (
    <header className="flex flex-col gap-1">
      <BackLink href={entitlementHref(page.customer_id, entitlementId)}>
        {copy.backToPurchase}
      </BackLink>
      <PageHeading>{copy.title}</PageHeading>
      <p className="text-base text-muted-foreground">
        <bdi>{page.product_name ?? nameOf(page.customer_label)}</bdi>
      </p>
    </header>
  )

  if (page.customer_id !== null) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <FillUsed
          customer={{
            id: page.customer_id,
            name: nameOf(page.customer_label),
          }}
        />
      </div>
    )
  }
  if (isVoided(page)) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <FillVoided />
      </div>
    )
  }

  const [photoConsent, legalSlugs] = await Promise.all([
    getPhotoConsentContent(),
    getPublishedPageSlugs(["privacy"]),
  ])

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="flex flex-col gap-2 text-base">
        <p>{copy.together}</p>
        <p>{copy.onSubmit}</p>
      </div>
      {photoConsent ? (
        <FillJoinForm
          entitlementId={entitlementId}
          paymentId={page.payment_id}
          // One key per page load (AD-5).
          idempotencyKey={randomUUID()}
          productName={null}
          amountAgorot={null}
          photoConsent={photoConsent}
          today={localToday()}
          privacyHref={legalSlugs.includes("privacy") ? "/privacy" : null}
        />
      ) : (
        // Both photo questions are required (CAP-40); without their
        // published wording the form cannot be answered.
        <Alert>
          <AlertTitle className="whitespace-normal">
            {errorMessage("SERVER_ERROR")}
          </AlertTitle>
        </Alert>
      )}
    </div>
  )
}
