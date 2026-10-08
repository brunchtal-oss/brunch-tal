import { describe, expect, it } from "vitest"

import type { Attendee } from "@/components/admin/attendee-row"
import { whatsappShareHref } from "@/components/admin/link-share"
import { adminCopy } from "@/lib/copy/admin"

import {
  consentMarks,
  dietLines,
  shoppingMessage,
  whatsappBlockedReason,
} from "./shopping-message"
import type { ShoppingItem } from "./work-sheet-data"

const copy = adminCopy.work
// 22.10.2026 10:00 in Jerusalem.
const STARTS = "2026-10-22T07:00:00+00:00"

const item = (
  id: string,
  body: string,
  quantity: string | null = null,
  bought = false
): ShoppingItem => ({ id, body, quantity, bought })

const BASE: Attendee = {
  bookingId: "b",
  partySize: 1,
  pendingJoin: false,
  payerLabel: null,
  name: null,
  phone: null,
  dietaryNotes: null,
  guestDetails: null,
  photoConsent: null,
  personalPhotoConsent: null,
  babies: [],
}

describe("the WhatsApp message of the shopping list (story 4.10)", () => {
  it("the title, then a line per item not bought, with or without a quantity", () => {
    const items = [
      item("1", "פטה כבשים", "1 ק״ג"),
      item("2", "לחם", null, true),
      item("3", "עגבניות שרי"),
    ]
    expect(shoppingMessage("יווני", STARTS, items)).toBe(
      ["רשימת קניות · יווני 22.10", "פטה כבשים · 1 ק״ג", "עגבניות שרי"].join(
        "\n"
      )
    )
    expect(whatsappBlockedReason(items)).toBeNull()
  })

  it("nothing to send: no items, or all bought", () => {
    expect(shoppingMessage("יווני", STARTS, [])).toBeNull()
    expect(whatsappBlockedReason([])).toBe(copy.whatsappEmpty)
    const bought = [item("1", "a", null, true)]
    expect(shoppingMessage("יווני", STARTS, bought)).toBeNull()
    expect(whatsappBlockedReason(bought)).toBe(copy.whatsappAllBought)
  })

  it("the link encodes special characters and the line breaks", () => {
    const message = shoppingMessage("יווני", STARTS, [
      item("1", "מלח & פלפל", "50% #2?"),
    ])
    const href = whatsappShareHref(message!)
    expect(href.startsWith("https://wa.me/?text=")).toBe(true)
    const text = href.slice("https://wa.me/?text=".length)
    expect(text).not.toMatch(/[&#?\n ]/)
    expect(text).toContain("%0A")
    expect(text).toContain("%26")
    expect(decodeURIComponent(text)).toBe(message)
  })
})

describe("the registrants table's cells (story 4.10, round 2)", () => {
  it("diet: what she wrote, then the companion; empty for one who wrote nothing", () => {
    expect(dietLines({ ...BASE, dietaryNotes: "ללא גלוטן" })).toEqual([
      "ללא גלוטן",
    ])
    expect(dietLines({ ...BASE, guestDetails: "צמחונית" })).toEqual([
      adminCopy.sessions.companion("צמחונית"),
    ])
    expect(
      dietLines({
        ...BASE,
        dietaryNotes: "בלי בוטנים",
        guestDetails: "טבעונית",
      })
    ).toEqual(["בלי בוטנים", adminCopy.sessions.companion("טבעונית")])
    expect(dietLines(BASE)).toEqual([])
    expect(dietLines({ ...BASE, dietaryNotes: "  " })).toEqual([])
    // Edges are trimmed: no blank first or last line in the cell.
    expect(
      dietLines({
        ...BASE,
        dietaryNotes: "\nללא גלוטן\n",
        guestDetails: " צמחונית ",
      })
    ).toEqual(["ללא גלוטן", adminCopy.sessions.companion("צמחונית")])
  })

  // Story 2.13: a short mark per consent, the label in full words.
  it("photo consents: a mark each, none for a pending booking", () => {
    const photo = adminCopy.photoConsents
    expect(
      consentMarks({ ...BASE, photoConsent: true, personalPhotoConsent: false })
    ).toEqual([
      {
        text: "אווירה ✓",
        rowText: "תמונות אווירה ✓",
        label: photo.atmosphere.yes,
        declined: false,
      },
      {
        text: "אישיות ✗",
        rowText: "תמונות אישיות ✗",
        label: photo.personal.no,
        declined: true,
      },
    ])
    expect(
      consentMarks({ ...BASE, photoConsent: false, personalPhotoConsent: true })
    ).toEqual([
      {
        text: "אווירה ✗",
        rowText: "תמונות אווירה ✗",
        label: photo.atmosphere.no,
        declined: true,
      },
      {
        text: "אישיות ✓",
        rowText: "תמונות אישיות ✓",
        label: photo.personal.yes,
        declined: false,
      },
    ])
    expect(consentMarks({ ...BASE, pendingJoin: true })).toEqual([])
  })
})
