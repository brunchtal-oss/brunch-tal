import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { AttendeeRow, type Attendee } from "./attendee-row"
import { SummaryCard } from "./summary-card"

const copy = adminCopy.sessions

const BASE: Attendee = {
  bookingId: "b1",
  partySize: 1,
  pendingJoin: false,
  payerLabel: null,
  name: "Dana",
  phone: "050-123-4567",
  dietaryNotes: null,
  guestDetails: null,
  photoConsent: null,
  personalPhotoConsent: null,
  babies: [],
}

// The visible text without the tags (each name is its own <bdi>).
function text(html: string): string {
  return html.replace(/<[^>]*>/g, "")
}

function row(attendee: Partial<Attendee>) {
  return renderToStaticMarkup(
    <ul>
      <AttendeeRow attendee={{ ...BASE, ...attendee }} onDay="2026-10-12" />
    </ul>
  )
}

describe("AttendeeRow", () => {
  it("a couple booking: the name with ×2, babies with their age, the notes and the companion's", () => {
    const html = row({
      partySize: 2,
      dietaryNotes: "gluten free",
      guestDetails: "vegan",
      babies: [{ name: "Ori", birthDate: "2026-07-12" }],
    })
    expect(html).toContain("Dana")
    expect(html).toContain(copy.couple)
    // No phone on the row (user decision 2026-10-08).
    expect(html).not.toContain("050-123-4567")
    // Line 1: "{name} ×2 - {baby} ({age})" (user decision 2026-10-08): ×2
    // right after the mother's name, each name its own <bdi>.
    expect(text(html)).toContain(`Dana ${copy.couple} - Ori (3 חודשים)`)
    expect(html).toContain(">Dana</bdi>")
    expect(html).toContain(">Ori</bdi> (3 חודשים)")
    expect(html).toContain("gluten free")
    expect(html).toContain(copy.companion("vegan"))
    expect(html).not.toContain("<button")
    expect(html).not.toContain("<a ")
  })

  // Story 2.13: both consents in words, only for an active customer.
  it("an active customer's two photo consents on one line, read in full words", () => {
    const html = row({ photoConsent: false, personalPhotoConsent: true })
    expect(html).toContain(adminCopy.photoConsents.atmosphere.no)
    expect(html).toContain(adminCopy.photoConsents.personal.yes)
    const visible = html.replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    expect(visible.replace(/<[^>]*>/g, "")).toContain(
      "תמונות אווירה ✗ - תמונות אישיות ✓"
    )
    // The declined one in warning.
    expect(html).toMatch(/text-warning[^>]*>תמונות אווירה ✗</)
    const none = row({ pendingJoin: true, name: null })
    expect(none).not.toContain(adminCopy.photoConsents.atmosphere.no)
    expect(none).not.toContain(adminCopy.photoConsents.atmosphere.yes)
  })

  it("an empty field shows nothing (no placeholder)", () => {
    const html = row({ phone: null })
    expect(html).not.toContain("bg-warning-tint")
    expect(html).not.toContain(copy.couple)
    expect(html).not.toContain("טרם נמסר")
    expect(html).not.toContain(copy.companion(""))
  })

  it("a pending booking: the pending line and the payer label", () => {
    const html = row({
      pendingJoin: true,
      payerLabel: "Noa",
      name: null,
      phone: null,
      partySize: 2,
    })
    expect(html).toContain(copy.pendingJoin)
    expect(html).toContain("Noa")
    expect(html).toContain(copy.couple)
  })

  it("removed details: the removed line only", () => {
    const html = row({ name: null, phone: null })
    expect(html).toContain(copy.detailsRemoved)
    expect(html).not.toContain(copy.pendingJoin)
  })

  it("story 3.6: the optional action slot at the row's end; none without it", () => {
    const withAction = renderToStaticMarkup(
      <ul>
        <AttendeeRow
          attendee={BASE}
          onDay="2026-10-12"
          action={<button type="button">cancel-slot</button>}
        />
      </ul>
    )
    expect(withAction).toContain("cancel-slot")
    expect(row({})).not.toContain("<button")
  })
})

describe("AttendeeRow lines (user decision 2026-10-08)", () => {
  it("several babies with a comma, each with its age", () => {
    const html = row({
      babies: [
        { name: "Ori", birthDate: "2026-07-12" },
        { name: "Noa", birthDate: "2026-07-12" },
      ],
      dietaryNotes: "gluten free",
    })
    expect(text(html)).toContain("Dana - Ori (3 חודשים), Noa (3 חודשים)")
    expect(html).toContain(">Noa</bdi>")
    expect(html).toContain("gluten free")
  })

  it("no babies: just the name", () => {
    const html = row({})
    expect(html).toContain(">Dana</bdi>")
    expect(text(html)).not.toContain("Dana -")
  })
})

describe("SummaryCard", () => {
  it("each number with its label; places as occupied/capacity", () => {
    const html = renderToStaticMarkup(
      <SummaryCard
        summary={{
          occupied: 10,
          capacity: 12,
          bookings: 5,
          babies: 6,
          allergies: 2,
        }}
      />
    )
    expect(html).toContain("10/12")
    for (const label of Object.values(copy.summary)) {
      expect(html).toContain(label)
    }
    expect(html).toMatch(/text-warning[^>]*><bdi dir="ltr">2<\/bdi>/)
  })
})
