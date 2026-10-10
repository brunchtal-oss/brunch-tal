import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeading } from "@/components/shared/page-heading"
import { ResultNoticeHost } from "@/components/shared/result-notice"
import { SessionCard } from "@/components/shared/session-card"
import { StatusChip } from "@/components/shared/status-chip"
import { buttonClass } from "@/components/shared/button-class"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { getWhatsappHref } from "@/lib/content/business-details"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { formatDayMonth, formatWeekday } from "@/lib/time"

import { sessionPhotos } from "../sessions/load-sessions"
import { parseMyBookings, pastBookingStatus } from "./cancel-result"
import { CreditCard, ExhaustedCreditCard, RefundCard } from "./credit-cards"
import {
  activeOptions,
  isBookableCredit,
  isExhaustedCredit,
  isOpenRefund,
  parseMyCredits,
} from "./credits"

export const metadata: Metadata = {
  title: customerCopy.bookingsTitle,
}

// Her bookings (story 3.6), opened from "לכל ההרשמות שלי" on home (no tab
// in the bottom bar, user decision 2026-10-06). First her credits she can
// still book with (story 3.7: "זיכוי מהמפגש ב-{date}" and its options, each
// a session-card to its page, or the waiting line; an exhausted credit with
// "צרי קשר") and her open refund requests (from get_my_credits, which refreshes the options first). Then
// the upcoming ones, each a
// session-card (the cancel is only on the session page, user decision
// 2026-10-06); then the past ones (cancelled / took place). Empty: a link to the schedule. Every value comes
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
  // The credits first: get_my_credits refreshes the options, so the
  // bookings read after it agree with them.
  const creditsResult = await callRpc(supabase, "get_my_credits")
  if (!creditsResult.ok) throw new Error("get_my_credits failed")
  const result = await callRpc(supabase, "get_my_bookings")
  if (!result.ok) throw new Error("get_my_bookings failed")
  const { upcoming, past } = parseMyBookings(result.data)
  const credits = parseMyCredits(creditsResult.data).filter(
    (c) => isBookableCredit(c) || isExhaustedCredit(c) || isOpenRefund(c)
  )
  // The contact button of an exhausted credit (WhatsApp).
  const contactHref = credits.some(isExhaustedCredit)
    ? await getWhatsappHref()
    : null
  // The cards' photos (user decision 2026-10-08), read like the session
  // screens; no RPC change.
  const photos = await sessionPhotos(supabase, [
    ...upcoming.map((b) => b.eventId),
    ...credits.flatMap((c) => activeOptions(c).map((o) => o.eventId)),
  ])

  if (upcoming.length === 0 && past.length === 0 && credits.length === 0) {
    return (
      <section className="flex flex-col items-start gap-4 py-6">
        <p className="text-[17px]">{customerCopy.bookingsEmpty}</p>
        <Link
          href="/me/sessions"
          className={buttonClass({
            size: "lg",
            className: "h-12 w-full max-w-xs text-base",
          })}
        >
          {customerCopy.toSchedule}
        </Link>
      </section>
    )
  }

  return (
    <ResultNoticeHost className="flex flex-col gap-8 pb-8">
      {credits.map((credit) =>
        isOpenRefund(credit) ? (
          <RefundCard key={credit.creditId} credit={credit} />
        ) : isExhaustedCredit(credit) ? (
          <ExhaustedCreditCard
            key={credit.creditId}
            credit={credit}
            contactHref={contactHref}
          />
        ) : (
          <CreditCard key={credit.creditId} credit={credit} photos={photos} />
        )
      )}
      {upcoming.length > 0 && (
        <section
          aria-labelledby="upcoming-title"
          className="flex flex-col gap-3"
        >
          <h2
            id="upcoming-title"
            className="font-heading text-[22px] leading-[1.25] font-light"
          >
            {customerCopy.upcomingBookings}
          </h2>
          <ul className="flex flex-col gap-6">
            {upcoming.map((b) => (
              <li key={b.bookingId} className="flex flex-col gap-3">
                <SessionCard
                  href={`/me/sessions/${b.eventId}`}
                  conceptName={b.conceptName}
                  photo={photos.get(b.eventId) ?? null}
                  startsAt={b.startsAt}
                  headingLevel={3}
                  layout="horizontal"
                  showTime
                  statusText={customerCopy.booked}
                  status={
                    <StatusChip tone="booked">{customerCopy.booked}</StatusChip>
                  }
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
            className="font-heading text-[22px] leading-[1.25] font-light"
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
