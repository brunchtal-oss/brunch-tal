import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { loadPaymentFormData } from "../form-data"
import { PaymentFormHost } from "../payment-form-host"

export const metadata: Metadata = {
  title: adminCopy.payments.newTitle,
}

// A payment for a new customer: the purchase waits for her join link.
// Rendered inside the admin shell's <Suspense> gate.
export default function NewCustomerPaymentPage() {
  return (
    <>
      <PageHeading>{adminCopy.payments.newTitle}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <NewCustomerContent />
      </Suspense>
    </>
  )
}

async function NewCustomerContent() {
  const data = await loadPaymentFormData()
  return <PaymentFormHost {...data} customer={null} />
}
