import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import {
  cancelDoneMessage,
  parseCancelResult,
  parseMyBookings,
  pastBookingStatus,
  returnsText,
} from "./cancel-result"

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

  it("a past booking is cancelled or took place", () => {
    expect(pastBookingStatus("cancelled")).toBe(customerCopy.bookingCancelled)
    expect(pastBookingStatus("completed")).toBe(customerCopy.bookingHeld)
  })
})
