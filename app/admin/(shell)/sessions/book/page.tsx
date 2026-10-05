import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { PageHeading } from "@/components/shared/page-heading"
import { buttonVariants } from "@/components/ui/button"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { errorMessage } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { formatDayMonth, formatLocalDate, formatWeekday } from "@/lib/time"

import { toBookableEvents } from "../../payments/new/event-options"
import { loadBookingCustomer } from "./load-customer"

const copy = adminCopy.sessions

export const metadata: Metadata = {
  title: copy.manualBooking,
}

// Manual booking from the customer's side (story 3.4): after a card is
// approved ("לרישום לתאריך"), or later from her card (4.2). The open
// sessions (admin_list_bookable_events) with {occupied}/{capacity}; a row
// leads to /admin/sessions/[id]/book?customer=<id>, where the preview and
// the confirm are. Rendered inside the admin shell's <Suspense> gate.
export default function BookCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string | string[] }>
}) {
  return (
    <>
      <PageHeading>{copy.manualBooking}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <BookCustomerContent searchParams={searchParams} />
      </Suspense>
    </>
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
      <InlineNotice
        tone="error"
        actions={
          <Link
            href="/admin/sessions"
            className={buttonVariants({
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
    )
  }

  const result = await callRpc(
    await createClient(),
    "admin_list_bookable_events"
  )
  if (!result.ok) throw new Error("bookable sessions failed")
  const events = toBookableEvents(result.data)

  return (
    <section aria-labelledby="choose-heading" className="flex flex-col gap-3">
      <p className="text-base font-semibold">
        <bdi>
          {adminCopy.payments.customerHead(customer.name, customer.phone)}
        </bdi>
      </p>
      <h2
        id="choose-heading"
        className="font-heading text-[22px] leading-[1.25] font-light"
      >
        {copy.chooseSession}
      </h2>
      {events.length === 0 ? (
        <p className="text-base text-muted-foreground">
          {copy.noBookableSessions}
        </p>
      ) : (
        <ul className="flex flex-col border-t border-border">
          {events.map((event) => {
            const party = event.kind === "couple" ? 2 : 1
            const full = event.occupied + party > event.capacity
            const day = `${formatWeekday(event.startsAt)} ${formatDayMonth(event.startsAt)}`
            return (
              <li key={event.id} className="border-b border-border">
                <Link
                  href={`/admin/sessions/${event.id}/book?customer=${customer.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 py-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-base font-semibold break-words">
                      <bdi>
                        {adminCopy.payments.eventOptionTitle(event.conceptName)}
                      </bdi>
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      <time dateTime={formatLocalDate(event.startsAt)}>
                        <bdi>
                          {adminCopy.payments.eventOptionDetails(
                            day,
                            event.occupied,
                            event.capacity,
                            full
                          )}
                        </bdi>
                      </time>
                    </span>
                  </span>
                  <ChevronLeftIcon
                    aria-hidden
                    strokeWidth={1.5}
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
