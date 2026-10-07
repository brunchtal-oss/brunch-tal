import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { BabiesSection } from "./babies-section"
import { DetailsSection } from "./details-section"
import { setPersonalPhotoConsent, setPhotoConsent } from "./actions"
import { CONSENT_SAVERS, PhotoConsentSection } from "./photo-consent-form"

vi.mock("./actions", () => ({
  addBaby: vi.fn(),
  deleteBaby: vi.fn(),
  updateBaby: vi.fn(),
  updateDetails: vi.fn(),
  setPhotoConsent: vi.fn(),
  setPersonalPhotoConsent: vi.fn(),
}))

const copy = customerCopy.profile
const TWINS = [
  { id: "a", name: "Ori", birthDate: "2026-07-05" },
  { id: "b", name: "Noa", birthDate: "2026-07-05" },
]

describe("BabiesSection", () => {
  it("shows each baby with the age on the local today (twins)", () => {
    const html = renderToStaticMarkup(
      <BabiesSection babies={TWINS} today="2026-10-05" />
    )
    expect(html).toContain(copy.babyLine("Ori", "3 חודשים"))
    expect(html).toContain(copy.babyLine("Noa", "3 חודשים"))
    expect(html).toContain(copy.bornOn("05.07.2026"))
    // The accessible name starts with the visible word (WCAG 2.5.3).
    expect(html).toContain(
      `${copy.deleteBaby}<span class="sr-only">${copy.babySuffix("Ori")}</span>`
    )
    expect(html).toContain(copy.addBaby)
  })

  it("has no delete button for a single baby", () => {
    const html = renderToStaticMarkup(
      <BabiesSection babies={[TWINS[0]]} today="2026-10-05" />
    )
    expect(html).toContain(
      `${copy.edit}<span class="sr-only">${copy.babySuffix("Ori")}</span>`
    )
    expect(html).not.toContain(copy.deleteBaby)
    expect(html).not.toContain("aria-label=")
  })
})

describe("DetailsSection", () => {
  it("shows phone and email read-only without a contact line, and no empty dietary row", () => {
    const html = renderToStaticMarkup(
      <DetailsSection
        fullName="Dana"
        dietaryNotes={null}
        phone="054-123-4567"
        email="dana@example.test"
      />
    )
    expect(html).toContain("Dana")
    expect(html).toContain(
      `${copy.edit}<span class="sr-only">${copy.detailsSuffix}</span>`
    )
    expect(html).toContain("054-123-4567")
    expect(html).toContain("dana@example.test")
    expect(html).not.toContain(copy.dietaryNotes)
    expect(html).not.toContain("<input")
    expect(html).not.toContain("<a ")
    // Never Tal's name in the customer's wording.
    expect(html).not.toMatch(/ טל|לטל|עם טל/)
  })

  it("shows the dietary notes as written", () => {
    const html = renderToStaticMarkup(
      <DetailsSection
        fullName="Dana"
        dietaryNotes="vegan"
        phone={null}
        email={null}
      />
    )
    expect(html).toContain(copy.dietaryNotes)
    expect(html).toContain("vegan")
  })
})

// Story 2.13: one heading, a form per consent, the note under both.
describe("PhotoConsentSection", () => {
  const content = {
    atmosphere_title: "Atmosphere",
    atmosphere_question: "AQ",
    atmosphere_yes: "Yes",
    atmosphere_no: "No",
    personal_title: "Personal",
    personal_question: "PQ",
    personal_yes: "Yes",
    personal_no: "No",
    note: "Note",
  }

  it("checks each saved answer in its own form", () => {
    const html = renderToStaticMarkup(
      <PhotoConsentSection
        content={content}
        consents={{ atmosphere: true, personal: false }}
      />
    )
    expect(html.match(/<h2/g)).toHaveLength(1)
    expect(html).toContain(copy.photoTitle)
    expect(html.match(/<form/g)).toHaveLength(2)
    expect(html.match(/type="submit"/g)).toHaveLength(2)
    expect(html).toMatch(/id="photoConsent-yes"[^>]*checked/)
    expect(html).not.toMatch(/id="photoConsent-no"[^>]*checked/)
    expect(html).toMatch(/id="personalPhotoConsent-no"[^>]*checked/)
    expect(html).not.toMatch(/id="personalPhotoConsent-yes"[^>]*checked/)
    expect(html.indexOf("Note")).toBeGreaterThan(html.lastIndexOf("</form>"))
  })
})

describe("CONSENT_SAVERS", () => {
  it("saves each answer into its own consent, from its own field", () => {
    expect(CONSENT_SAVERS.personal.save).toBe(setPersonalPhotoConsent)
    expect(CONSENT_SAVERS.personal.field).toBe("personalPhotoConsent")
    expect(CONSENT_SAVERS.atmosphere.save).toBe(setPhotoConsent)
    expect(CONSENT_SAVERS.atmosphere.field).toBe("photoConsent")
  })
})
