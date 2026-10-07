import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { consentLines, consentMarks } from "./photo-consents"

const copy = adminCopy.photoConsents

// Story 2.13: the two consents as Tal reads them.
describe("photo consents", () => {
  it("a line per consent, in words", () => {
    expect(consentLines({ atmosphere: true, personal: false })).toEqual([
      copy.atmosphere.yes,
      copy.personal.no,
    ])
    expect(consentLines({ atmosphere: false, personal: true })).toEqual([
      copy.atmosphere.no,
      copy.personal.yes,
    ])
  })

  it("a short mark per consent, the declined one flagged", () => {
    expect(consentMarks({ atmosphere: false, personal: true })).toEqual([
      { text: "אווירה ✗", label: copy.atmosphere.no, declined: true },
      { text: "אישיות ✓", label: copy.personal.yes, declined: false },
    ])
  })
})
