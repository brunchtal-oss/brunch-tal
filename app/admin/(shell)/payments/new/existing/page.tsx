import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"

import { CustomerSearch } from "./customer-search"

const copy = adminCopy.payments

export const metadata: Metadata = {
  title: copy.newTitle,
}

// Finding the existing customer of a payment (story 2.5), by part of her
// name or her phone; a result opens the form for her.
export default function ExistingCustomerSearchPage() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <PageHeading>{copy.newTitle}</PageHeading>
        <p className="text-base text-muted-foreground">
          {copy.existingCustomer}
        </p>
      </div>
      <CustomerSearch />
    </>
  )
}
