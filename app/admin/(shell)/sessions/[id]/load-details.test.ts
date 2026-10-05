import { describe, expect, it, vi } from "vitest"

import { detailsSummary, isFull, parseEventDetails } from "./load-details"

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

const EVENT = {
  id: "e1",
  concept_name: "Grandma",
  kind: "couple",
  status: "published",
  starts_at: "2026-10-12T07:00:00Z",
  ends_at: "2026-10-12T09:00:00Z",
  registration_closes_at: "2026-10-11T17:00:00Z",
  capacity_adults: 14,
  occupied: 6,
}

const RAW = {
  event: EVENT,
  bookings: [
    {
      booking_id: "b1",
      party_size: 2,
      booked_by: "admin",
      customer_id: "c1",
      pending_join: false,
      full_name: "Dana",
      phone_e164: "+972501234567",
      dietary_notes: "gluten free",
      guest_details: "vegan",
      babies: [
        { name: "Ori", birth_date: "2026-07-01" },
        { name: "Maya", birth_date: "2026-08-01" },
      ],
    },
    {
      booking_id: "b2",
      party_size: 2,
      booked_by: "admin",
      pending_join: true,
      payer_label: "Noa",
    },
    {
      booking_id: "b3",
      party_size: 2,
      booked_by: "customer",
      customer_id: "c3",
      pending_join: false,
    },
  ],
}

describe("parseEventDetails", () => {
  it("maps a couple booking, a pending one and removed details", () => {
    const details = parseEventDetails(RAW)
    expect(details).toMatchObject({
      id: "e1",
      conceptName: "Grandma",
      kind: "couple",
      capacity: 14,
      occupied: 6,
    })
    expect(details.attendees).toEqual([
      {
        bookingId: "b1",
        partySize: 2,
        pendingJoin: false,
        payerLabel: null,
        name: "Dana",
        phone: expect.stringContaining("050"),
        dietaryNotes: "gluten free",
        guestDetails: "vegan",
        babies: [
          { name: "Ori", birthDate: "2026-07-01" },
          { name: "Maya", birthDate: "2026-08-01" },
        ],
      },
      {
        bookingId: "b2",
        partySize: 2,
        pendingJoin: true,
        payerLabel: "Noa",
        name: null,
        phone: null,
        dietaryNotes: null,
        guestDetails: null,
        babies: [],
      },
      {
        bookingId: "b3",
        partySize: 2,
        pendingJoin: false,
        payerLabel: null,
        name: null,
        phone: null,
        dietaryNotes: null,
        guestDetails: null,
        babies: [],
      },
    ])
  })

  it("trims a note, keeping its inner lines", () => {
    const details = parseEventDetails({
      event: EVENT,
      bookings: [
        {
          ...RAW.bookings[0],
          dietary_notes: "\n  nuts\nsoy  \n\n",
          full_name: " Dana ",
        },
      ],
    })
    expect(details.attendees[0]).toMatchObject({
      dietaryNotes: "nuts\nsoy",
      name: "Dana",
    })
  })

  it("drops a blank companion's note", () => {
    const details = parseEventDetails({
      event: EVENT,
      bookings: [{ ...RAW.bookings[1], guest_details: "  " }],
    })
    expect(details.attendees[0].guestDetails).toBeNull()
  })
})

describe("detailsSummary", () => {
  it("counts bookings (the pending one too), babies and allergies; places from the server", () => {
    expect(detailsSummary(parseEventDetails(RAW))).toEqual({
      occupied: 6,
      capacity: 14,
      bookings: 3,
      babies: 2,
      allergies: 1,
    })
  })

  it("counts a companion's note alone as an allergy", () => {
    const details = parseEventDetails({
      event: EVENT,
      bookings: [{ ...RAW.bookings[1], guest_details: "nuts" }],
    })
    expect(detailsSummary(details).allergies).toBe(1)
  })
})

describe("isFull", () => {
  it.each([
    ["regular", 11, 12, false],
    ["regular", 12, 12, true],
    ["couple", 12, 14, false],
    ["couple", 13, 14, true],
  ] as const)("%s %i/%i -> %s", (kind, occupied, capacity, expected) => {
    const details = parseEventDetails({
      event: { ...EVENT, kind, occupied, capacity_adults: capacity },
      bookings: [],
    })
    expect(isFull(details)).toBe(expected)
  })
})
