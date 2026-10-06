import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeading } from "@/components/shared/page-heading"
import { ResultNoticeHost } from "@/components/shared/result-notice"
import { SessionCard } from "@/components/shared/session-card"
import { StatusChip } from "@/components/shared/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { getWhatsappHref } from "@/lib/content/business-details"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { formatDayMonth, formatWeekday } from "@/lib/time"

import { CancelBooking } from "./cancel-booking"
import { parseMyBookings, pastBookingStatus } from "./cancel-result"

export const metadata: Metadata = {
  title: customerCopy.bookingsTitle,
}

// Her bookings (story 3.6), opened from "לכל ההרשמות שלי" on home (no tab
// in the bottom bar, user decision 2026-10-06). The upcoming ones, each a
// session-card with the cancel under it (outside the card's link), or the
// contact phrase past the self-cancel boundary; then the past ones
// (cancelled / took place). Empty: a link to the schedule. Every value comes
// from get_my_bookings. Rendered inside the layout's customer gate.
export default function BookingsPage() {
  return (
    <>
      <PageHeading>{customerCopy.bookingsTitle}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <Bookings />
      </Suspense>
    </>
  )
}

async function Bookings() {
  const supabase = await createClient()
  const result = await callRpc(supabase, "get_my_bookings")
  if (!result.ok) throw new Error("get_my_bookings failed")
  const { upcoming, past, optionsCount } = parseMyBookings(result.data)

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <section className="flex flex-col items-start gap-4 py-6">
        <p className="text-[17px]">{customerCopy.bookingsEmpty}</p>
        <Link
          href="/me/sessions"
          className={buttonVariants({
            size: "lg",
            className: "h-12 w-full max-w-xs text-base",
          })}
        >
          {customerCopy.toSchedule}
        </Link>
      </section>
    )
  }

  // The contact phrase also follows a refusal inside the sheet.
  const contactHref = upcoming.length > 0 ? await getWhatsappHref() : null

  return (
    <ResultNoticeHost className="flex flex-col gap-10 pb-8">
      {upcoming.length > 0 && (
        <section
          aria-labelledby="upcoming-title"
          className="flex flex-col gap-3"
        >
          <h2
            id="upcoming-title"
            className="font-heading text-xl leading-tight font-light"
          >
            {customerCopy.upcomingBookings}
          </h2>
          <ul className="flex flex-col gap-6">
            {upcoming.map((b) => (
              <li key={b.bookingId} className="flex flex-col gap-3">
                <SessionCard
                  href={`/me/sessions/${b.eventId}`}
                  conceptName={b.conceptName}
                  startsAt={b.startsAt}
                  headingLevel={3}
                  layout="horizontal"
                  statusText={customerCopy.booked}
                  status={
                    <StatusChip tone="success">
                      {customerCopy.booked}
                    </StatusChip>
                  }
                />
                <CancelBooking
                  bookingId={b.bookingId}
                  title={customerCopy.sessionTitle(b.conceptName)}
                  startsAt={b.startsAt}
                  funding={b.funding}
                  productName={b.productName}
                  optionsCount={optionsCount}
                  canSelfCancel={b.canSelfCancel}
                  contactHref={contactHref}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section aria-labelledby="past-title" className="flex flex-col gap-3">
          <h2
            id="past-title"
            className="font-heading text-xl leading-tight font-light"
          >
            {customerCopy.pastBookings}
          </h2>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {past.map((b) => (
              <li
                key={b.bookingId}
                className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3"
              >
                <span className="flex flex-col">
                  <bdi className="text-base font-semibold">
                    {customerCopy.sessionTitle(b.conceptName)}
                  </bdi>
                  <time
                    dateTime={b.startsAt}
                    className="text-[15px] text-muted-foreground"
                  >
                    {formatWeekday(b.startsAt)}{" "}
                    <bdi>{formatDayMonth(b.startsAt)}</bdi>
                  </time>
                </span>
                <StatusChip tone="expired">
                  {pastBookingStatus(b.status)}
                </StatusChip>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ResultNoticeHost>
  )
}
