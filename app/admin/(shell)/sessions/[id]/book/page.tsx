import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { buttonClass } from "@/components/shared/button-class"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { errorMessage } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { CustomerSearch } from "../../../payments/new/existing/customer-search"
import { loadBookingCustomer } from "../../book/load-customer"
import { isReadOnlySession } from "../../load-session"
import { loadEventDetails } from "../load-details"
import { SessionHeader } from "../session-header"
import { ManualBooking } from "./manual-booking"
import { parseBookPreview } from "./preview"

const copy = adminCopy.sessions
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: copy.manualBooking,
}

// Manual booking for one session (story 3.4, CAP-14). Without ?customer:
// find her (admin_search_customers); a result comes back here with her id.
// With ?customer: the preview (preview_admin_book_customer) and one confirm.
// A session that is not published (a draft), or is cancelled, completed or
// ended, takes no booking: back to its details.
// Rendered inside the admin shell's <Suspense> gate.
export default function ManualBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ customer?: string | string[] }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <ManualBookingContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

async function ManualBookingContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ customer?: string | string[] }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const { customer: customerParam } = await searchParams
  const customerId =
    typeof customerParam === "string" ? customerParam : undefined

  const details = await loadEventDetails(id)
  if (!details) notFound()
  if (
    details.status !== "published" ||
    isReadOnlySession(
      { status: details.status, ends_at: details.endsAt },
      new Date()
    )
  ) {
    redirect(`/admin/sessions/${id}`)
  }

  const searchHref = `/admin/sessions/${id}/book`

  return (
    <>
      <SessionHeader
        conceptName={details.conceptName}
        status={details.status}
        startsAt={details.startsAt}
        endsAt={details.endsAt}
      />
      <section aria-labelledby="manual-heading" className="flex flex-col gap-6">
        <h2
          id="manual-heading"
          className="font-heading text-[22px] leading-[1.25] font-light"
        >
          {copy.manualBooking}
        </h2>
        {customerId === undefined ? (
          <CustomerSearch hrefTemplate={`${searchHref}?customer=:id`} />
        ) : (
          <CustomerBooking
            eventId={id}
            customerId={customerId}
            searchHref={searchHref}
          />
        )}
      </section>
    </>
  )
}

async function CustomerBooking({
  eventId,
  customerId,
  searchHref,
}: {
  eventId: string
  customerId: string
  searchHref: string
}) {
  const customer = await loadBookingCustomer(customerId)
  const change = (
    <Link
      href={searchHref}
      className={buttonClass({
        variant: "outline",
        size: "lg",
        className: "h-11 text-base",
      })}
    >
      {adminCopy.payments.changeCustomer}
    </Link>
  )
  if (!customer) {
    return (
      <InlineNotice tone="error" actions={change}>
        {errorMessage("CUSTOMER_NOT_AVAILABLE")}
      </InlineNotice>
    )
  }

  const result = await callRpc(
    await createClient(),
    "preview_admin_book_customer",
    { p_customer_id: customer.id, p_event_id: eventId }
  )
  if (!result.ok) throw new Error("manual booking preview failed")

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold">
          <bdi>
            {adminCopy.payments.customerHead(customer.name, customer.phone)}
          </bdi>
        </p>
        <Link
          href={searchHref}
          className="py-3 text-[15px] font-semibold underline underline-offset-[3px]"
        >
          {adminCopy.payments.changeCustomer}
        </Link>
      </div>
      <ManualBooking
        eventId={eventId}
        customer={{ id: customer.id, name: customer.name }}
        initialPreview={parseBookPreview(result.data)}
      />
    </>
  )
}
