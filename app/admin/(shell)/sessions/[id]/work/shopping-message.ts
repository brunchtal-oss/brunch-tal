import { adminCopy } from "@/lib/copy/admin"
import { formatDayMonth } from "@/lib/time"

import type { Attendee } from "@/components/admin/attendee-row"

import type { ShoppingItem } from "./work-sheet-data"

// Pure helpers of story 4.10 (no server and no browser API): the WhatsApp
// message of the shopping list and the registrants table's cells.

const copy = adminCopy.work
const sessions = adminCopy.sessions

// The items the WhatsApp message carries: those not bought yet (user
// decision 2026-10-07, EXPERIENCE.md:159), in the list's order.
export function itemsToSend(items: readonly ShoppingItem[]): ShoppingItem[] {
  return items.filter((item) => !item.bought)
}

// "רשימת קניות · {קונספט} {DD.MM}" and a line per item not bought
// ("{מה} · {כמות}", or only "{מה}"). null when there is nothing to send (no
// items, or all bought). The link is whatsappShareHref(message).
export function shoppingMessage(
  conceptName: string,
  startsAt: string,
  items: readonly ShoppingItem[]
): string | null {
  const lines = itemsToSend(items).map((item) =>
    copy.itemLine(item.body, item.quantity)
  )
  if (lines.length === 0) return null
  return [
    copy.shoppingMessageTitle(conceptName, formatDayMonth(startsAt)),
    ...lines,
  ].join("\n")
}

// Why the WhatsApp button cannot be used, or null when it can.
export function whatsappBlockedReason(
  items: readonly ShoppingItem[]
): string | null {
  if (items.length === 0) return copy.whatsappEmpty
  if (itemsToSend(items).length === 0) return copy.whatsappAllBought
  return null
}

// The registrants table's "תזונה ואלרגיות" cell (round 2): what the
// customer wrote, then "מלווה: …" from guest_details (the only field a
// companion has). Empty (an empty cell) when neither was written.
export function dietLines(attendee: Attendee): string[] {
  const lines: string[] = []
  const notes = attendee.dietaryNotes?.trim()
  const guest = attendee.guestDetails?.trim()
  if (notes) lines.push(notes)
  if (guest) lines.push(sessions.companion(guest))
  return lines
}

// The photo consent cell: "אישרה" / "לא אישרה", or null (an empty cell) for
// a pending booking or removed details.
export function consentText(attendee: Attendee): string | null {
  if (attendee.photoConsent === null) return null
  return attendee.photoConsent
    ? copy.photoConsentShort
    : copy.noPhotoConsentShort
}
