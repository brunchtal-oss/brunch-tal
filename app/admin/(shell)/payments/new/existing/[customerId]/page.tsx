import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { InlineNotice } from "@/components/shared/inline-notice"
import { PageHeading } from "@/components/shared/page-heading"
import { buttonClass } from "@/components/shared/button-class"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { errorMessage } from "@/lib/errors"
import { formatLocalPhone } from "@/lib/phone"
import { createClient } from "@/lib/supabase/server"

import { loadPaymentFormData } from "../../form-data"
import { PaymentFormHost } from "../../payment-form-host"

const copy = adminCopy.payments
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: copy.newTitle,
}

// A payment for the customer chosen in the search (story 2.5): the same form,
// with her name and phone at its head. An id that is not an available
// customer (unknown, anonymized) shows CUSTOMER_NOT_AVAILABLE and a way back
// to the search. Rendered inside the admin shell's <Suspense> gate.
export default function ExistingCustomerPaymentPage({
  params,
}: {
  params: Promise<{ customerId: string }>
}) {
  return (
    <>
      <PageHeading>{copy.newTitle}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <ExistingCustomerContent params={params} />
      </Suspense>
    </>
  )
}

async function ExistingCustomerContent({
  params,
}: {
  params: Promise<{ customerId: string }>
}) {
  const { customerId } = await params
  const customer = UUID.test(customerId) ? await loadCustomer(customerId) : null

  if (!customer) {
    return (
      <InlineNotice
        tone="error"
        actions={
          <Link
            href="/admin/payments/new/existing"
            className={buttonClass({
              variant: "outline",
              size: "lg",
              className: "h-11 text-base",
            })}
          >
            {copy.changeCustomer}
          </Link>
        }
      >
        {errorMessage("CUSTOMER_NOT_AVAILABLE")}
      </InlineNotice>
    )
  }

  const data = await loadPaymentFormData()
  return <PaymentFormHost {...data} customer={customer} />
}

// Admin reads profiles through RLS. Anonymized: not available (as in
// admin_approve_payment, which checks again under its lock).
async function loadCustomer(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone_e164, anonymized_at")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("customer read failed")
  if (!data || data.anonymized_at) return null
  return {
    id: data.id,
    name: data.full_name,
    phone: data.phone_e164 ? formatLocalPhone(data.phone_e164) : "",
  }
}
