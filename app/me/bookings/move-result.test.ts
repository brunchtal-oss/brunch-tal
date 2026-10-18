import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import {
  moveConfirmBlocked,
  moveErrorText,
  moveNeedsContact,
  moveTapAction,
  parseMovePlan,
  parseMoveResult,
} from "./move-result"

describe("move-result (story 3.10)", () => {
  it("parses the plan: funding, can_move and the targets; a malformed target is dropped", () => {
    const plan = parseMovePlan({
      ok: true,
      funding: "pinned",
      can_move: true,
      targets: [
        {
          event_id: "e1",
          starts_at: "2026-11-12T08:00:00+00:00",
          concept_name: "Mothers",
          outside_options: false,
        },
        { event_id: "e2" },
        "junk",
      ],
    })
    expect(plan).toEqual({
      ok: true,
      funding: "pinned",
      canMove: true,
      customerName: null,
      withinWindow: false,
      targets: [
        {
          eventId: "e1",
          startsAt: "2026-11-12T08:00:00+00:00",
          conceptName: "Mothers",
          outsideOptions: false,
        },
      ],
    })
  })

  it("Tal's plan: the customer's name, within the window, a target outside the credit's options", () => {
    const plan = parseMovePlan({
      ok: true,
      funding: "credit",
      customer_name: "Dana",
      within_window: true,
      targets: [
        {
          event_id: "e1",
          starts_at: "2026-11-12T08:00:00+00:00",
          concept_name: "Mothers",
          outside_options: true,
        },
      ],
    })
    expect(plan).toMatchObject({
      ok: true,
      canMove: false,
      customerName: "Dana",
      withinWindow: true,
      targets: [{ outsideOptions: true }],
    })
  })

  it("a refusal keeps its code; an unknown code is a server error", () => {
    expect(
      parseMovePlan({ ok: false, code: "MANUAL_HANDLING_REQUIRED" })
    ).toEqual({ ok: false, code: "MANUAL_HANDLING_REQUIRED" })
    expect(parseMovePlan({ ok: false, code: "WHAT" })).toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
    expect(parseMovePlan(null)).toEqual({ ok: false, code: "SERVER_ERROR" })
  })

  it("parses the result, or null when it is malformed", () => {
    expect(
      parseMoveResult({ booking_id: "b2", from_booking_id: "b1" })
    ).toEqual({ bookingId: "b2", fromBookingId: "b1" })
    expect(parseMoveResult({ booking_id: "b2" })).toBeNull()
  })

  it("'כן, להזיז' waits for a session", () => {
    expect(moveConfirmBlocked(null)).toBe(true)
    expect(moveConfirmBlocked("e1")).toBe(false)
  })

  it("past the window a tap only shows the closed notice (no RPC)", () => {
    expect(moveTapAction(false)).toBe("closed")
    expect(moveTapAction(true)).toBe("preview")
  })

  it("the closed notice names cancel and move, and the success line", () => {
    expect(customerCopy.cancel.closed(48)).toBe(
      "לא ניתן לבטל או להזיז עצמאית פחות מ-48 שעות לפני המפגש."
    )
    expect(customerCopy.move.done("12.11")).toBe("ההרשמה הועברה ל-12.11")
  })

  it("a refused move speaks of moving: the closed notice past the window, its own line for manual handling, both with contact", () => {
    expect(moveErrorText("SELF_CANCEL_CLOSED", 48)).toBe(
      "לא ניתן לבטל או להזיז עצמאית פחות מ-48 שעות לפני המפגש."
    )
    expect(moveErrorText("MANUAL_HANDLING_REQUIRED", 48)).toBe(
      "את ההזזה הזו לא ניתן לעשות כאן."
    )
    expect(moveErrorText("EVENT_FULL", 48)).toBe(
      "הבראנץ׳ מלא. ניתן לבחור תאריך אחר"
    )
    expect(moveNeedsContact("SELF_CANCEL_CLOSED")).toBe(true)
    expect(moveNeedsContact("MANUAL_HANDLING_REQUIRED")).toBe(true)
    expect(moveNeedsContact("EVENT_FULL")).toBe(false)
    expect(moveNeedsContact(null)).toBe(false)
    for (const code of [
      "SELF_CANCEL_CLOSED",
      "MANUAL_HANDLING_REQUIRED",
    ] as const) {
      expect(moveErrorText(code, 48)).not.toMatch(/(^|[\s>"(])טל($|[\s.,)<])/)
    }
  })
})
