import { attendeeTitle, type Attendee } from "@/components/admin/attendee-row"
import { babyAge } from "@/components/admin/baby-age"
import { adminCopy } from "@/lib/copy/admin"
import { formatLocalDate } from "@/lib/time"
import { cn } from "@/lib/utils"

import { consentText, dietLines } from "./shopping-message"

// "נרשמות, תמונות ותזונה" (story 4.10, round 2; user decisions 2026-10-07,
// phone check): one table on the phone, on desktop and in print, in place
// of attendee-row and of a separate diet section. Columns: name, with the
// babies small under it (name and age on the session's day, as attendee-row
// did; second phone check: no babies column) · photo consent ("אישרה" /
// "לא אישרה"; empty for a pending booking or removed details) · diet and
// allergies (what she wrote, and "מלווה: …"; empty when nothing). No phone
// (it stays in the session's details) and no "×2". The heading carries the
// number of bookings. Printed the same way; not printed when there are none.

const copy = adminCopy.work
const sessions = adminCopy.sessions

const CELL = "border-b border-border px-2 py-2.5 text-start align-top"
const HEAD = cn(
  CELL,
  "border-t bg-muted text-[13px] leading-[1.4] font-semibold text-muted-foreground"
)

export function RegistrantsTable({
  attendees,
  startsAt,
}: {
  attendees: readonly Attendee[]
  startsAt: string
}) {
  const onDay = formatLocalDate(startsAt)
  return (
    <section
      aria-labelledby="work-attendees"
      className={cn(
        "flex break-inside-avoid flex-col gap-3",
        attendees.length === 0 && "print:hidden"
      )}
    >
      <h2
        id="work-attendees"
        className="font-heading text-[22px] leading-[1.25] font-light print:text-[15px] print:font-semibold"
      >
        {copy.attendees(attendees.length)}
      </h2>
      {attendees.length === 0 ? (
        <p className="text-base text-muted-foreground">
          {sessions.noAttendees}
        </p>
      ) : (
        // A safety net only: the three columns wrap to fit a phone.
        <div className="-mx-1 overflow-x-auto px-1 print:overflow-visible">
          <table className="w-full border-collapse text-[15px] leading-[1.4] print:text-[12px]">
            <caption className="sr-only">{copy.attendeesCaption}</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(HEAD, "w-[36%]")}>
                  {copy.colName}
                </th>
                <th scope="col" className={cn(HEAD, "w-[22%]")}>
                  {copy.colConsent}
                </th>
                <th scope="col" className={HEAD}>
                  {copy.diet}
                </th>
              </tr>
            </thead>
            <tbody>
              {attendees.map((attendee) => (
                <RegistrantRow
                  key={attendee.bookingId}
                  attendee={attendee}
                  onDay={onDay}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function RegistrantRow({
  attendee,
  onDay,
}: {
  attendee: Attendee
  onDay: string
}) {
  const removed = !attendee.pendingJoin && attendee.name === null
  const consent = consentText(attendee)
  const diet = dietLines(attendee)
  return (
    <tr>
      <th
        scope="row"
        className={cn(
          CELL,
          "font-semibold break-words",
          removed && "font-normal text-muted-foreground"
        )}
      >
        <bdi>{attendeeTitle(attendee)}</bdi>
        {attendee.pendingJoin && attendee.payerLabel && (
          <span className="block text-[13px] font-normal text-muted-foreground">
            <bdi>{attendee.payerLabel}</bdi>
          </span>
        )}
        {attendee.babies.map((baby, index) => (
          <span
            key={index}
            className="block text-[13px] leading-[1.4] font-normal text-muted-foreground"
          >
            <bdi>
              {sessions.babyLine(baby.name, babyAge(baby.birthDate, onDay))}
            </bdi>
          </span>
        ))}
      </th>
      <td
        className={cn(
          CELL,
          attendee.photoConsent === false && "font-semibold text-warning"
        )}
      >
        {consent}
      </td>
      <td className={cn(CELL, "break-words whitespace-pre-line")}>
        {diet.map((line, index) => (
          <span key={index} className="block">
            <bdi>{line}</bdi>
          </span>
        ))}
      </td>
    </tr>
  )
}
