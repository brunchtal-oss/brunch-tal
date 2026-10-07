import { adminCopy } from "@/lib/copy/admin"

import { babyAge } from "./baby-age"

const copy = adminCopy.sessions

export type AttendeeBaby = { name: string; birthDate: string }

// One real booking of a session (admin_get_event_details). name, phone,
// dietary notes and babies only for an active customer; a booking without a
// customer is pendingJoin (AD-23); a customer whose details were removed has
// none of them.
export type Attendee = {
  bookingId: string
  partySize: number
  pendingJoin: boolean
  payerLabel: string | null
  name: string | null
  // Formatted for display (lib/phone).
  phone: string | null
  dietaryNotes: string | null
  guestDetails: string | null
  // The photo consent (CAP-40), shown only on the work sheet (story 4.10);
  // null for a pending booking or removed details.
  photoConsent: boolean | null
  babies: readonly AttendeeBaby[]
}

// The name a booking shows: the customer's, or "לקוחה חדשה · ממתינה
// להצטרפות" for a pending booking, or "פרטי הלקוחה הוסרו" for removed
// details. Shared with the work sheet (story 4.10).
export function attendeeTitle(attendee: Attendee): string {
  if (attendee.pendingJoin) return copy.pendingJoin
  return attendee.name ?? copy.detailsRemoved
}

// DESIGN.md › attendee-row (story 3.4): the name in body-strong with "×2" for
// a couple booking, the phone, a line per baby with the age on the session's
// day, the dietary notes as written on a warning tint, and the companion's
// note the same way with "מלווה:". An empty field shows nothing. A pending
// booking: "לקוחה חדשה · ממתינה להצטרפות" and the payer label; removed
// details: "פרטי הלקוחה הוסרו". onDay: the session's local date
// ("YYYY-MM-DD"). action: an optional slot at the row's end (the cancel of
// story 3.6, on the session's details only); without it the row has no
// buttons.
export function AttendeeRow({
  attendee,
  onDay,
  action,
}: {
  attendee: Attendee
  onDay: string
  action?: React.ReactNode
}) {
  const title = attendeeTitle(attendee)
  const muted = !attendee.pendingJoin && attendee.name === null

  return (
    <li className="flex items-start gap-3 border-b border-border py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p
          className={
            muted
              ? "text-base text-muted-foreground"
              : "text-base leading-[1.35] font-semibold"
          }
        >
          <bdi className="break-words">{title}</bdi>
          {attendee.partySize === 2 && (
            <span className="ms-2 font-semibold text-foreground">
              {copy.couple}
            </span>
          )}
        </p>
        {attendee.pendingJoin && attendee.payerLabel && (
          <p className="text-[15px] text-muted-foreground">
            <bdi>{attendee.payerLabel}</bdi>
          </p>
        )}
        {attendee.phone && (
          <p className="text-[15px] text-muted-foreground">
            <bdi dir="ltr">{attendee.phone}</bdi>
          </p>
        )}
        {attendee.babies.map((baby, index) => (
          <p key={index} className="text-[15px]">
            <bdi>
              {copy.babyLine(baby.name, babyAge(baby.birthDate, onDay))}
            </bdi>
          </p>
        ))}
        {attendee.dietaryNotes && (
          <p className="mt-1 rounded-md bg-warning-tint px-3 py-2 text-[15px] whitespace-pre-line text-warning">
            <bdi>{attendee.dietaryNotes}</bdi>
          </p>
        )}
        {attendee.guestDetails && (
          <p className="mt-1 rounded-md bg-warning-tint px-3 py-2 text-[15px] whitespace-pre-line text-warning">
            <bdi>{copy.companion(attendee.guestDetails)}</bdi>
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  )
}
