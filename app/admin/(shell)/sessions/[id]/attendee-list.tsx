import { AttendeeRow } from "@/components/admin/attendee-row"
import { SummaryCard } from "@/components/admin/summary-card"
import { adminCopy } from "@/lib/copy/admin"
import { formatLocalDate } from "@/lib/time"

import { detailsSummary, type EventDetails } from "./load-details"

const copy = adminCopy.sessions

// The summary-card and "מי מגיעה" (story 3.4), shared by the session's
// details and the session-morning view. Bookings by confirmation time.
export function AttendeeList({ details }: { details: EventDetails }) {
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
              />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
