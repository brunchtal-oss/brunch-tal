import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import {
  cancelDoneMessage,
  isCoupleBooking,
  needsContact,
  parseCancelResult,
  parseMyBookings,
  pastBookingStatus,
  returnsText,
  type MyBooking,
} from "./cancel-result"
import type { MyCredit } from "./credits"

const copy = customerCopy.cancel

describe("cancelDoneMessage", () => {
  it("a card, a credit and a refund request", () => {
    expect(
      cancelDoneMessage(
        parseCancelResult({ outcome: "card", entitlement_id: "e1" })
      )
    ).toBe(copy.doneCard)
    expect(
      cancelDoneMessage(
        parseCancelResult({ outcome: "credit", credit_id: "c1" })
      )
    ).toBe("ההרשמה בוטלה. הזיכוי מחכה לך בהרשמות שלך")
    expect(
      cancelDoneMessage(
        parseCancelResult({ outcome: "refund", refund_request_id: "r1" })
      )
    ).toBe("ההרשמה בוטלה. בקשת ההחזר התקבלה")
    expect(parseCancelResult({ outcome: "pinned" })).toEqual({
      outcome: "card",
    })
  })

  it("never names Tal or a deadline", () => {
    for (const text of [
      copy.doneCard,
      copy.doneCredit,
      copy.doneRefund,
      copy.choiceCredit,
      copy.choiceCreditNote(2),
      copy.choiceRefund,
      copy.choiceRefundNote,
      copy.returnsCredit,
      copy.closed(48),
      copy.closed(null),
    ]) {
      expect(text).not.toMatch(/(^|[\s"(])טל($|[\s.,)])/)
    }
  })
})

describe("returnsText", () => {
  it("by the funding; a pinned booking shows the choice instead", () => {
    expect(returnsText("card", "כרטיסייה")).toBe(copy.returnsCard("כרטיסייה"))
    expect(returnsText("credit", "x")).toBe("הזיכוי יחזור אלייך עם אותן חלופות")
    expect(returnsText("pinned", "x")).toBeNull()
    expect(copy.choiceCreditNote(2)).toBe(
      "אפשר להירשם לאחד מ-2 המפגשים המתאימים הבאים"
    )
  })
})

describe("parseMyBookings", () => {
  it("maps the rows and leaves out a malformed one", () => {
    const parsed = parseMyBookings({
      upcoming: [
        {
          booking_id: "b1",
          event_id: "e1",
          status: "confirmed",
          starts_at: "2026-10-12T07:00:00+00:00",
          concept_name: "Mothers",
          can_self_cancel: true,
          funding: "pinned",
          product_name: "Single",
        },
        { booking_id: null },
      ],
      past: [
        {
          booking_id: "b2",
          event_id: "e2",
          status: "cancelled",
          starts_at: "2026-10-01T07:00:00+00:00",
          concept_name: "Mothers",
          funding: "returned",
        },
      ],
      options_count: 2,
    })
    expect(parsed.upcoming).toEqual([
      {
        bookingId: "b1",
        eventId: "e1",
        status: "confirmed",
        startsAt: "2026-10-12T07:00:00+00:00",
        conceptName: "Mothers",
        canSelfCancel: true,
        funding: "pinned",
        productName: "Single",
        partySize: 1,
        guestDetails: null,
        guestDetailsEditable: false,
        movedToStartsAt: null,
      },
    ])
    expect(parsed.past[0]).toMatchObject({
      funding: "card",
      canSelfCancel: false,
    })
    expect(parsed.optionsCount).toBe(2)
    expect(parseMyBookings(null)).toEqual({
      upcoming: [],
      past: [],
      optionsCount: 1,
    })
  })

  it("story 3.5: a couple booking's companion note and whether it can be edited", () => {
    const row = {
      booking_id: "b1",
      event_id: "e1",
      status: "confirmed",
      starts_at: "2026-10-12T07:00:00+00:00",
    }
    const [couple, blank, odd] = parseMyBookings({
      upcoming: [
        {
          ...row,
          party_size: 2,
          guest_details: "צמחונית",
          guest_details_editable: true,
        },
        { ...row, party_size: 2, guest_details: "  " },
        { ...row, party_size: "2", guest_details_editable: "yes" },
      ],
    }).upcoming
    expect(couple).toMatchObject({
      partySize: 2,
      guestDetails: "צמחונית",
      guestDetailsEditable: true,
    })
    expect(blank).toMatchObject({
      partySize: 2,
      guestDetails: null,
      guestDetailsEditable: false,
    })
    expect(odd).toMatchObject({ partySize: 1, guestDetailsEditable: false })
  })

  it("story 3.5: only a confirmed couple booking has a companion note", () => {
    expect(isCoupleBooking({ partySize: 2, status: "confirmed" })).toBe(true)
    // A single booking: no note.
    expect(isCoupleBooking({ partySize: 1, status: "confirmed" })).toBe(false)
    expect(isCoupleBooking({ partySize: 2, status: "cancelled" })).toBe(false)
  })

  it("story 3.5: the contact link is needed for an exhausted credit or a read-only couple note", () => {
    const booking = (
      partySize: number,
      guestDetailsEditable: boolean
    ): MyBooking => ({
      bookingId: "b1",
      eventId: "e1",
      status: "confirmed",
      startsAt: "2026-10-12T07:00:00+00:00",
      conceptName: "Mothers",
      canSelfCancel: true,
      funding: "pinned",
      productName: "",
      partySize,
      guestDetails: null,
      guestDetailsEditable,
      movedToStartsAt: null,
    })
    const credit = (exhausted: boolean): MyCredit => ({
      creditId: "c1",
      status: "active",
      partySize: 1,
      originStartsAt: "2026-10-01T07:00:00+00:00",
      originConceptName: "Mothers",
      reserved: null,
      options: [],
      waiting: false,
      exhausted,
      refund: null,
      choicePending: false,
      cancelledStartsAt: null,
      optionsCount: 2,
    })
    // A read-only couple note, no exhausted credit: needs contact.
    expect(needsContact([], [booking(2, false)])).toBe(true)
    expect(needsContact([credit(true)], [])).toBe(true)
    expect(needsContact([credit(false)], [booking(2, true)])).toBe(false)
    // A single booking has no note, editable or not.
    expect(needsContact([], [booking(1, false)])).toBe(false)
    expect(needsContact([], [])).toBe(false)
  })

  it("a past booking is cancelled or took place", () => {
    expect(pastBookingStatus("cancelled")).toBe(customerCopy.bookingCancelled)
    expect(pastBookingStatus("completed")).toBe(customerCopy.bookingHeld)
    // The brunch, masculine (user decision 2026-10-13).
    expect(pastBookingStatus("cancelled")).toBe("בוטל")
    expect(pastBookingStatus("completed")).toBe("התקיים")
  })

  it("story 3.10: a moved booking reads 'הועברה ל-{date}', not cancelled", () => {
    // 2026-11-12 10:00 in Jerusalem.
    const moved = "2026-11-12T08:00:00+00:00"
    expect(pastBookingStatus("cancelled", moved)).toBe("הועברה ל-12.11")
    expect(pastBookingStatus("cancelled", null)).toBe("בוטל")
    const [row] = parseMyBookings({
      past: [
        {
          booking_id: "b1",
          event_id: "e1",
          status: "cancelled",
          starts_at: "2026-11-05T08:00:00+00:00",
          moved_to_starts_at: moved,
        },
      ],
    }).past
    expect(row.movedToStartsAt).toBe(moved)
  })
})
