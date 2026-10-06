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
  babies: [],
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
    expect(html).toContain("050-123-4567")
    expect(html).toContain(copy.babyLine("Ori", "3 חודשים"))
    expect(html).toContain("gluten free")
    expect(html).toContain(copy.companion("vegan"))
    expect(html).not.toContain("<button")
    expect(html).not.toContain("<a ")
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
