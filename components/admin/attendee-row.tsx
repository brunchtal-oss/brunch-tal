import { Fragment } from "react"

import { consentMarks, type PhotoConsents } from "@/lib/admin/photo-consents"
import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

import { babyAge } from "./baby-age"

const copy = adminCopy.sessions
const photoCopy = adminCopy.photoConsents

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
  // The two photo consents (CAP-40; atmosphere and personal from story
  // 2.13); null for a pending booking or removed details.
  photoConsent: boolean | null
  personalPhotoConsent: boolean | null
  babies: readonly AttendeeBaby[]
}

// Both consents of an active customer; null: nothing to show.
export function attendeeConsents(attendee: Attendee): PhotoConsents | null {
  if (
    attendee.photoConsent === null ||
    attendee.personalPhotoConsent === null
  ) {
    return null
  }
  return {
    atmosphere: attendee.photoConsent,
    personal: attendee.personalPhotoConsent,
  }
}

// The name a booking shows: the customer's, or "לקוחה חדשה · ממתינה
// להצטרפות" for a pending booking, or "פרטי הלקוחה הוסרו" for removed
// details. Shared with the work sheet (story 4.10).
export function attendeeTitle(attendee: Attendee): string {
  if (attendee.pendingJoin) return copy.pendingJoin
  return attendee.name ?? copy.detailsRemoved
}

// "{אמא} - {תינוק} ({גיל})", several babies with a comma, each with its age
// on the session's day; without babies just the name (user decision
// 2026-10-08).
export function attendeeLine(attendee: Attendee, onDay: string): string {
  const title = attendeeTitle(attendee)
  if (attendee.babies.length === 0) return title
  const babies = attendee.babies
    .map((baby) => copy.babyWithAge(baby.name, babyAge(baby.birthDate, onDay)))
    .join(copy.babiesSeparator)
  return copy.nameWithBabies(title, babies)
}

// DESIGN.md › attendee-row (story 3.4; lines by the user's decision
// 2026-10-08): line 1 the name and the babies with their ages ("×2" for a
// couple booking); line 2 the two photo consents as "תמונות אווירה ✓ -
// תמונות אישיות ✗" (each read in full words; a "not approved" in warning, as
// on the work sheet); line 3 the dietary notes as written on a warning tint,
// and the companion's note the same way with "מלווה:". No phone (user
// decision 2026-10-08: it stays on the customer card). An empty field shows nothing. A pending booking: "לקוחה חדשה ·
// ממתינה להצטרפות" and the payer label; removed details: "פרטי הלקוחה
// הוסרו". onDay: the session's local date ("YYYY-MM-DD"). action: an
// optional slot at the row's end (the cancel of story 3.6, on the session's
// details only); without it the row has no buttons.
export function AttendeeRow({
  attendee,
  onDay,
  action,
}: {
  attendee: Attendee
  onDay: string
  action?: React.ReactNode
}) {
  const consents = attendeeConsents(attendee)
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
          <bdi className="break-words">{attendeeLine(attendee, onDay)}</bdi>
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
        {consents && (
          <p className="text-[15px]">
            {consentMarks(consents).map((mark, index) => (
              <Fragment key={mark.label}>
                {index > 0 && <span aria-hidden>{photoCopy.rowSeparator}</span>}
                <span
                  aria-hidden
                  className={cn(mark.declined && "font-semibold text-warning")}
                >
                  {mark.rowText}
                </span>
                <span className="sr-only">{mark.label}</span>
              </Fragment>
            ))}
          </p>
        )}
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
