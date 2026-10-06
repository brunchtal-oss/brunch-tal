import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { ResultNoticeHost } from "@/components/shared/result-notice"
import { buttonVariants } from "@/components/ui/button"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { isReadOnlySession } from "../load-session"
import { AttendeeList } from "./attendee-list"
import { isFull, loadEventDetails } from "./load-details"
import { SessionHeader } from "./session-header"

const copy = adminCopy.sessions
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BUTTON = "h-12 text-base"

export const metadata: Metadata = {
  title: copy.title,
}

// The session's details (story 3.4, CAP-12): the head, the summary-card,
// the actions and "מי מגיעה". A full session shows "המפגש מלא" and a way to
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

      <div className="flex flex-col gap-3">
        {bookable &&
          (full ? (
            <InlineNotice
              tone="warning"
              actions={
                <Link
                  href={`/admin/sessions/${id}/edit`}
                  className={buttonVariants({
                    variant: "outline",
                    size: "lg",
                    className: "h-11 text-base",
                  })}
                >
                  {copy.raiseCapacity}
                </Link>
              }
            >
              {copy.full(details.occupied, details.capacity)}
            </InlineNotice>
          ) : (
            <Link
              href={`/admin/sessions/${id}/book`}
              className={buttonVariants({
                variant: "default",
                size: "lg",
                className: BUTTON,
              })}
            >
              {copy.manualBooking}
            </Link>
          ))}
        <div className="flex flex-wrap gap-3">
          {!readOnly && (
            <Link
              href={`/admin/sessions/${id}/edit`}
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: `${BUTTON} border-foreground px-4`,
              })}
            >
              {copy.edit}
            </Link>
          )}
          <Link
            href={`/admin/sessions/${id}/day`}
            className={buttonVariants({
              variant: "outline",
              size: "lg",
              className: `${BUTTON} border-foreground px-4`,
            })}
          >
            {copy.morningView}
          </Link>
        </div>
      </div>

      {/* Story 3.6: Tal cancels a booking until the session ends; the
          result stays above the list after the row leaves it. */}
      <ResultNoticeHost className="flex flex-col gap-8">
        <AttendeeList details={details} cancellable={!readOnly} />
      </ResultNoticeHost>
    </>
  )
}
