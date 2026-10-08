import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { SummaryCard } from "@/components/admin/summary-card"
import { InlineNotice } from "@/components/shared/inline-notice"
import { ResultNoticeHost } from "@/components/shared/result-notice"
import { buttonClass } from "@/components/shared/button-class"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { isReadOnlySession } from "../load-session"
import { AttendeeList } from "./attendee-list"
import { detailsSummary, isFull, loadEventDetails } from "./load-details"
import { SessionHeader } from "./session-header"

const copy = adminCopy.sessions
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The two small actions: button-secondary, the same size, 44px high.
const SMALL = "h-11 rounded-lg px-4 text-base font-semibold"
const SECONDARY = `${SMALL} min-w-32 border border-foreground bg-transparent text-foreground`

export const metadata: Metadata = {
  title: copy.title,
}

// The session's details (story 3.4, CAP-12): the head, the summary-card,
// the actions and "מי מגיעה" (order: user decision 2026-10-08). A full session shows "המפגש מלא" and a way to
// raise the capacity instead of the manual booking (no silent overbooking).
// A cancelled, completed or ended session is read-only: no booking, no
// editing. A draft has no manual booking yet. Rendered inside the admin
// shell's <Suspense> gate.
export default function SessionDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <SessionDetailsContent params={params} />
    </Suspense>
  )
}

async function SessionDetailsContent({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const details = await loadEventDetails(id)
  if (!details) notFound()

  const readOnly = isReadOnlySession(
    { status: details.status, ends_at: details.endsAt },
    new Date()
  )
  const full = isFull(details)
  // Only a published session takes a booking (a draft: EVENT_NOT_BOOKABLE).
  const bookable = !readOnly && details.status === "published"

  return (
    <>
      <SessionHeader
        conceptName={details.conceptName}
        status={details.status}
        startsAt={details.startsAt}
        endsAt={details.endsAt}
      />

      {/* The figures right under the title, then the work sheet (its only
          link on this page) as the big action, then the manual booking at
          inline-start and editing at inline-end (user decision
          2026-10-08). */}
      <div className="flex flex-col gap-3">
        <SummaryCard summary={detailsSummary(details)} />
        <Link
          href={`/admin/sessions/${id}/work`}
          className={buttonClass({
            variant: "default",
            size: "lg",
            className: "h-12 w-full rounded-lg text-base font-semibold",
          })}
        >
          {copy.morningView}
        </Link>
        {bookable && full && (
          <InlineNotice
            tone="warning"
            actions={
              <Link
                href={`/admin/sessions/${id}/edit`}
                className={buttonClass({
                  variant: "outline",
                  size: "lg",
                  className: `${SMALL} border-foreground`,
                })}
              >
                {copy.raiseCapacity}
              </Link>
            }
          >
            {copy.full(details.occupied, details.capacity)}
          </InlineNotice>
        )}
        {((bookable && !full) || !readOnly) && (
          <div className="flex items-center justify-between gap-2">
            {bookable && !full ? (
              <Link
                href={`/admin/sessions/${id}/book`}
                className={buttonClass({
                  variant: "outline",
                  size: "lg",
                  className: SECONDARY,
                })}
              >
                {copy.manualBooking}
              </Link>
            ) : (
              <span />
            )}
            {!readOnly && (
              <Link
                href={`/admin/sessions/${id}/edit`}
                className={buttonClass({
                  variant: "outline",
                  size: "lg",
                  className: SECONDARY,
                })}
              >
                {copy.edit}
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Story 3.6: Tal cancels a booking until the session ends; the
          result stays above the list after the row leaves it. */}
      {/* 48 above "מי מגיעה" (the main's 32 + 16; user decision
          2026-10-08). */}
      <ResultNoticeHost className="mt-4 flex flex-col gap-8">
        <AttendeeList details={details} cancellable={!readOnly} />
      </ResultNoticeHost>
    </>
  )
}
