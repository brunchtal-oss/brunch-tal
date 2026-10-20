import Link from "next/link"

import { ResultNoticeHost } from "@/components/shared/result-notice"
import { SessionCard } from "@/components/shared/session-card"
import { StatusChip } from "@/components/shared/status-chip"
import { buttonClass } from "@/components/shared/button-class"
import { customerCopy } from "@/lib/copy/customer"
import { getWhatsappHref } from "@/lib/content/business-details"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { formatDayMonth, formatWeekday } from "@/lib/time"

import { WaitlistButton } from "../sessions/[id]/waitlist-panel"
import { sessionPhotos } from "../sessions/load-sessions"
import {
  needsContact,
  parseMyBookings,
  pastBookingStatus,
} from "./cancel-result"
import {
  CreditCard,
  ExhaustedCreditCard,
  RefundCard,
  RefundedCard,
} from "./credit-cards"
import {
  activeOptions,
  isBookableCredit,
  isExhaustedCredit,
  isOpenRefund,
  isPendingChoice,
  isRefunded,
  parseMyCredits,
  pendingChoiceStartsAt,
} from "./credits"
import { PendingChoiceCard } from "./pending-choice"
import { parseMyWaitlist } from "./waitlist"

// The content of /me/bookings (see page.tsx), its own module so a test
// can render it.
export async function Bookings() {
  const supabase = await createClient()
  // The credits first: get_my_credits refreshes the options, so the
  // bookings read after it agree with them.
  // Story 5.6: her waitlist entries (a section after the upcoming
  // bookings) are read alongside.
  const [[creditsResult, result], waitlistResult] = await Promise.all([
    callRpc(supabase, "get_my_credits").then(
      async (credits) =>
        [credits, await callRpc(supabase, "get_my_bookings")] as const
    ),
    callRpc(supabase, "get_my_waitlist"),
  ])
  if (!creditsResult.ok) throw new Error("get_my_credits failed")
  if (!result.ok) throw new Error("get_my_bookings failed")
  const { upcoming, past } = parseMyBookings(result.data)
  if (!waitlistResult.ok) throw new Error("get_my_waitlist failed")
  const waitlist = parseMyWaitlist(waitlistResult.data)
  const allCredits = parseMyCredits(creditsResult.data)
  // Story 3.8: a business cancel waiting for her choice, at the top.
  const pending = allCredits.filter(isPendingChoice)
  const credits = allCredits.filter(
    (c) =>
      isBookableCredit(c) ||
      isExhaustedCredit(c) ||
      isOpenRefund(c) ||
      isRefunded(c)
  )
  // The contact button of an exhausted credit (WhatsApp). The companion's
  // note of a couple booking is on its session page (story 5.21, fix 7).
  const contactHref = needsContact(credits) ? await getWhatsappHref() : null
  // The cards' photos (user decision 2026-10-08), read like the session
  // screens; no RPC change.
  const photos = await sessionPhotos(supabase, [
    ...upcoming.map((b) => b.eventId),
    ...waitlist.map((w) => w.eventId),
    ...credits.flatMap((c) => activeOptions(c).map((o) => o.eventId)),
  ])

  if (
    upcoming.length === 0 &&
    past.length === 0 &&
    credits.length === 0 &&
    pending.length === 0 &&
    waitlist.length === 0
  ) {
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
      {pending.map((credit) => (
        <PendingChoiceCard
          key={credit.creditId}
          creditId={credit.creditId}
          startsAt={pendingChoiceStartsAt(credit)}
          optionsCount={credit.optionsCount}
        />
      ))}
      {credits.map((credit) =>
        isOpenRefund(credit) ? (
          <RefundCard key={credit.creditId} credit={credit} />
        ) : isRefunded(credit) ? (
          <RefundedCard key={credit.creditId} credit={credit} />
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

      {/* Story 5.6: one card per session she waits for, each with its own
          leave (EXPERIENCE › מצבי הרשמה ורשימת המתנה). */}
      {waitlist.length > 0 && (
        <section
          aria-labelledby="waitlist-title"
          className="flex flex-col gap-3"
        >
          <h2
            id="waitlist-title"
            className="font-heading text-[22px] leading-[1.25] font-light"
          >
            {customerCopy.waitlist.sectionTitle}
          </h2>
          <ul className="flex flex-col gap-6">
            {waitlist.map((w) => (
              <li key={w.eventId} className="flex flex-col gap-3">
                <SessionCard
                  href={`/me/sessions/${w.eventId}`}
                  conceptName={w.conceptName}
                  photo={photos.get(w.eventId) ?? null}
                  startsAt={w.startsAt}
                  headingLevel={3}
                  layout="horizontal"
                  showTime
                  statusText={customerCopy.waitlist.chip}
                  status={
                    <StatusChip tone="pending">
                      {customerCopy.waitlist.chip}
                    </StatusChip>
                  }
                />
                <WaitlistButton
                  action="leave"
                  eventId={w.eventId}
                  startsAt={w.startsAt}
                  className="h-11 rounded-[4px] border-foreground px-4 text-base font-semibold"
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
                  {pastBookingStatus(b.status, b.movedToStartsAt)}
                </StatusChip>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ResultNoticeHost>
  )
}
