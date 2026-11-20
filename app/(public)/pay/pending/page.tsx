import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { PendingNotice } from "@/components/shared/payment-notice"
import { customerCopy } from "@/lib/copy/customer"
import { isCheckoutId } from "@/lib/payments/checkout-cookie"

const copy = customerCopy.purchase

export const metadata: Metadata = {
  title: copy.sheetTitle,
  robots: { index: false, follow: false },
}

// /pay/pending?c=<checkout> (online payments, PR B): the payment is not at
// the provider yet. No timer and no automatic refresh: one link, "לבדוק
// שוב", back to /pay/return for the same checkout, which decides again.
// Without a valid c the sentence alone.
export default function PaymentPendingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pt-8 pb-12">
      <PageHeading>{copy.sheetTitle}</PageHeading>
      <Suspense fallback={<PendingNotice checkoutId={null} />}>
        <Pending searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Pending({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { c } = await searchParams
  return <PendingNotice checkoutId={isCheckoutId(c) ? c : null} />
}
