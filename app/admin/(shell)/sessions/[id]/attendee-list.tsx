import { AttendeeRow } from "@/components/admin/attendee-row"
import { SummaryCard } from "@/components/admin/summary-card"
import { adminCopy } from "@/lib/copy/admin"
import { formatLocalDate } from "@/lib/time"

import { AttendeeCancel } from "./attendee-cancel"
import { detailsSummary, type EventDetails } from "./load-details"

const copy = adminCopy.sessions

// The summary-card and "מי מגיעה" (story 3.4), shared by the session's
// details and the session-morning view. Bookings by confirmation time.
// cancellable: each row gets Tal's cancel (story 3.6; the session's details
// while it has not ended, never the morning view).
export function AttendeeList({
  details,
  cancellable = false,
}: {
  details: EventDetails
  cancellable?: boolean
}) {
  const onDay = formatLocalDate(details.startsAt)
  return (
    <>
      <SummaryCard summary={detailsSummary(details)} />
      <section aria-labelledby="attendees-heading" className="flex flex-col">
        <h2
          id="attendees-heading"
          className="mb-2 font-heading text-[22px] leading-[1.25] font-light"
        >
          {copy.attendees}
        </h2>
        {details.attendees.length === 0 ? (
          <p className="text-base text-muted-foreground">{copy.noAttendees}</p>
        ) : (
          <ul className="flex flex-col border-t border-border">
            {details.attendees.map((attendee) => (
              <AttendeeRow
                key={attendee.bookingId}
                attendee={attendee}
                onDay={onDay}
                action={
                  cancellable ? (
                    <AttendeeCancel
                      bookingId={attendee.bookingId}
                      name={
                        attendee.pendingJoin
                          ? copy.pendingJoin
                          : (attendee.name ?? copy.detailsRemoved)
                      }
                      conceptName={details.conceptName}
                      startsAt={details.startsAt}
                    />
                  ) : undefined
                }
              />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
