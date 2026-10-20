import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { customerCopy } from "@/lib/copy/customer"
import { ERROR_MESSAGES } from "@/lib/errors"

import { MOVE_REFUSAL_CODES, moveRefusal, moveTargetOption } from "./move-plan"

describe("Tal's move (story 3.10)", () => {
  it("every move refusal has Tal's own wording: not the customer's, no contact phrase, no 'טל'", () => {
    for (const code of MOVE_REFUSAL_CODES) {
      const text = adminCopy.sessions.moveRefusal[code]
      expect(text, code).toBeTruthy()
      expect(moveRefusal(code)).toBe(text)
      expect(text).not.toBe(ERROR_MESSAGES[code])
      expect(text).not.toContain(customerCopy.contactPhrase)
      expect(text).not.toMatch(/(^|[\s>"(])טל($|[\s.,)<])/)
    }
  })

  it("story 3.18: an excluded product is worded for Tal", () => {
    expect(MOVE_REFUSAL_CODES).toContain("PRODUCT_NOT_VALID_FOR_EVENT")
    expect(moveRefusal("PRODUCT_NOT_VALID_FOR_EVENT")).toBe(
      "המפגש הזה לא מקבל את המוצר שלה."
    )
  })

  it("any other code keeps the shared message", () => {
    expect(moveRefusal("SERVER_ERROR")).toBe(ERROR_MESSAGES.SERVER_ERROR)
  })

  it("a target outside the credit's options says so", () => {
    const option = moveTargetOption({
      eventId: "e1",
      startsAt: "2026-11-12T08:00:00+00:00",
      conceptName: "אמהות",
      outsideOptions: true,
    })
    expect(option.value).toBe("e1")
    expect(option.description).toBe(
      `בראנץ׳ אמהות · ${adminCopy.sessions.move.outsideOptions}`
    )
  })
})
