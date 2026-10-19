import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { InlineNotice } from "@/components/shared/inline-notice"
import { PageHeading } from "@/components/shared/page-heading"
import { buttonClass } from "@/components/shared/button-class"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { errorMessage } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { formatLocalDate, formatSessionDate } from "@/lib/time"

import { toBookableEvents } from "../../payments/new/event-options"
import { bookListView, markBooked, parseCustomerBookable } from "./book-items"
import {
  loadBookedEventIds,
  loadBookingCustomer,
  loadFreeEntries,
} from "./load-customer"
import { MultiBooking } from "./multi-booking"

const copy = adminCopy.sessions

export const metadata: Metadata = {
  title: copy.manualBooking,
}

// Manual booking from the customer's side (story 3.4): after a card is
// approved ("לרישום לתאריך"), or later from her card (4.2). The open
// sessions she can be booked for (admin_list_customer_bookable_events,
// story 3.19) with {occupied}/{capacity}, and a line with how many were
// hidden; none she can be booked for: a notice with "הוספת תשלום". A
// session she is already booked for shows "רשומה" (story 4.3, user
// decision 2026-10-13); every other row is a checkbox, and several dates
// are booked at once (MultiBooking). /admin/sessions/[id]/book stays for a
// session's own page. Rendered inside the admin shell's <Suspense> gate.
export default function BookCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string | string[] }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <BookCustomerContent searchParams={searchParams} />
    </Suspense>
  )
}

async function BookCustomerContent({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string | string[] }>
}) {
  const { customer: customerParam } = await searchParams
  const customer = await loadBookingCustomer(
    typeof customerParam === "string" ? customerParam : undefined
  )
  if (!customer) {
    return (
      <>
        <PageHeading>{copy.manualBooking}</PageHeading>
        <InlineNotice
          tone="error"
          actions={
            <Link
              href="/admin/sessions"
              className={buttonClass({
                variant: "outline",
                size: "lg",
                className: "h-11 text-base",
              })}
            >
              {copy.title}
            </Link>
          }
        >
          {errorMessage("CUSTOMER_NOT_AVAILABLE")}
        </InlineNotice>
      </>
    )
  }

  const [result, bookedIds, freeEntries] = await Promise.all([
    callRpc(await createClient(), "admin_list_customer_bookable_events", {
      p_customer_id: customer.id,
    }),
    loadBookedEventIds(customer.id),
    loadFreeEntries(customer.id),
  ])
  if (!result.ok) throw new Error("bookable sessions failed")
  const listed = parseCustomerBookable(result.data)
  const events = markBooked(toBookableEvents(listed.events), bookedIds)
  const view = bookListView(events.length, listed.hidden)

  return (
    <section aria-labelledby="customer-heading" className="flex flex-col gap-3">
      {/* One heading, her name, without the phone (user decisions
          2026-10-19, story 3.19 phone check). */}
      <h1
        id="customer-heading"
        className="font-heading text-[22px] leading-[1.25] font-light"
      >
        <bdi>{customer.name}</bdi>
      </h1>
      {view === "noSessions" ? (
        <p className="text-base text-muted-foreground">
          {copy.noBookableSessions}
        </p>
      ) : view === "noFundable" ? (
        <InlineNotice
          tone="warning"
          actions={
            <Link
              href={`/admin/payments/new/existing/${customer.id}`}
              className={buttonClass({
                variant: "outline",
                size: "lg",
                className: "h-11 text-base",
              })}
            >
              {copy.addPayment}
            </Link>
          }
        >
          {copy.noFundableSessions}
        </InlineNotice>
      ) : (
        <MultiBooking
          customer={{ id: customer.id, name: customer.name }}
          freeEntries={freeEntries}
          hiddenCount={listed.hidden}
          rows={events.map((event) => {
            const party = event.kind === "couple" ? 2 : 1
            return {
              id: event.id,
              title: adminCopy.payments.eventOptionTitle(event.conceptName),
              details: adminCopy.payments.eventOptionDetails(
                formatSessionDate(event.startsAt),
                event.occupied,
                event.capacity,
                event.occupied + party > event.capacity
              ),
              dateTime: formatLocalDate(event.startsAt),
              booked: event.booked,
            }
          })}
        />
      )}
    </section>
  )
}
