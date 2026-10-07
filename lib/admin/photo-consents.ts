import { adminCopy } from "@/lib/copy/admin"

// How Tal reads a customer's two photo consents (story 2.13): the
// atmosphere photos (published) and the personal photos (the WhatsApp
// group). Pure, shared by the customer card, the session's registrant row
// and the work sheet.

const copy = adminCopy.photoConsents

export type PhotoConsents = { atmosphere: boolean; personal: boolean }

const KINDS = ["atmosphere", "personal"] as const

// "אישרה / לא אישרה תמונות אווירה", then the same for the personal photos.
export function consentLines(consents: PhotoConsents): string[] {
  return KINDS.map((kind) => (consents[kind] ? copy[kind].yes : copy[kind].no))
}

// One mark of the work sheet: "אווירה ✓", its full label, and whether it is
// a "not approved" (the warning style).
export type ConsentMark = { text: string; label: string; declined: boolean }

export function consentMarks(consents: PhotoConsents): ConsentMark[] {
  return KINDS.map((kind) => ({
    text: `${copy[kind].short} ${consents[kind] ? copy.yesMark : copy.noMark}`,
    label: consents[kind] ? copy[kind].yes : copy[kind].no,
    declined: !consents[kind],
  }))
}
