import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { cubeTitleClass } from "@/components/shared/section-title"
import { customerCopy } from "@/lib/copy/customer"
import { SPECIAL_BRUNCH_FALLBACK } from "@/lib/special-brunch"

import { BabiesSection } from "./babies-section"
import { DetailsSection, detailsInput, emailDiffers } from "./details-section"
import { setPersonalPhotoConsent, setPhotoConsent } from "./actions"
import { CONSENT_SAVERS, PhotoConsentSection } from "./photo-consent-form"

// Story 6.11: the email row's resend notice refreshes the page.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/(auth)/verify-email/actions", () => ({
  resendVerificationAction: vi.fn(),
}))
vi.mock("./actions", () => ({
  addBaby: vi.fn(),
  deleteBaby: vi.fn(),
  updateBaby: vi.fn(),
  updateDetails: vi.fn(),
  updateDetailsWithEmailAction: vi.fn(),
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
  it("shows phone and email read-only without a contact line, and the empty dietary row with its hint", () => {
    const html = renderToStaticMarkup(
      <DetailsSection
        fullName="Dana"
        dietaryNotes={null}
        specialBrunch={SPECIAL_BRUNCH_FALLBACK}
        specialBrunchInterests={[]}
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
    expect(html).toContain(copy.dietaryNotes)
    expect(html).toContain(copy.dietaryNotesEmpty)
    // Story 2.16: nothing chosen yet.
    expect(html).toContain(copy.specialBrunch)
    expect(html).toContain(copy.specialBrunchEmpty)
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
        specialBrunch={SPECIAL_BRUNCH_FALLBACK}
        specialBrunchInterests={[]}
        phone={null}
        email={null}
      />
    )
    expect(html).toContain(copy.dietaryNotes)
    expect(html).toContain("vegan")
    expect(html).not.toContain(copy.dietaryNotesEmpty)
  })

  // Story 2.16: her answers, by their titles (content), in code order.
  it("shows the chosen special brunches by their titles", () => {
    const html = renderToStaticMarkup(
      <DetailsSection
        fullName="Dana"
        dietaryNotes={null}
        specialBrunch={{ ...SPECIAL_BRUNCH_FALLBACK, couples_title: "X" }}
        specialBrunchInterests={["couples", "grandpa"]}
        phone={null}
        email={null}
      />
    )
    expect(html).toContain(`X · ${SPECIAL_BRUNCH_FALLBACK.grandpa_title}`)
    expect(html).not.toContain(copy.specialBrunchEmpty)
  })

  it("the edit form shows her saved answers checked", () => {
    const html = renderToStaticMarkup(
      <DetailsSection
        fullName="Dana"
        dietaryNotes={null}
        specialBrunch={SPECIAL_BRUNCH_FALLBACK}
        specialBrunchInterests={["grandma"]}
        phone={null}
        email={null}
        defaultEditing
      />
    )
    const box = (code: string) =>
      new RegExp(`<input id="specialBrunchInterests-${code}"[^>]*>`).exec(
        html
      )?.[0]
    expect(box("grandma")).toContain('checked=""')
    expect(box("couples")).not.toContain("checked")
    expect(box("grandpa")).not.toContain("checked")
  })

  // Story 6.11 (user decision 2026-11-12): the email and the phone in the
  // edit form; the separate "שינוי מייל" is gone.
  it("the edit form: her email as a field, the phone read only with the WhatsApp note", () => {
    const html = renderToStaticMarkup(
      <DetailsSection
        fullName="Dana"
        dietaryNotes={null}
        specialBrunch={SPECIAL_BRUNCH_FALLBACK}
        specialBrunchInterests={[]}
        phone="054-123-4567"
        email="dana@example.test"
        contactHref="https://wa.me/972500000000"
        defaultEditing
      />
    )
    const emailInput = /<input[^>]*id="email"[^>]*>/.exec(html)?.[0]
    expect(emailInput).toContain('value="dana@example.test"')
    // The phone is text, never a field.
    expect(html).toContain("054-123-4567")
    expect(html).not.toMatch(/<input[^>]*value="054-123-4567"/)
    expect(html).toContain(`לשינוי הטלפון <a href="https://wa.me/972500000000"`)
    expect(html).toContain(`>${copy.contactPhrase}</a>`)
    // The new address again and the password open only once it differs.
    expect(html).not.toContain('id="confirmEmail"')
    expect(html).not.toContain('id="currentPassword"')
    expect(html).not.toContain("שינוי מייל")
    expect(html).not.toMatch(/ טל|לטל|עם טל/)
  })

  it("no business details: the phone's note stays plain text", () => {
    const html = renderToStaticMarkup(
      <DetailsSection
        fullName="Dana"
        dietaryNotes={null}
        specialBrunch={SPECIAL_BRUNCH_FALLBACK}
        specialBrunchInterests={[]}
        phone="054-123-4567"
        email="dana@example.test"
        defaultEditing
      />
    )
    expect(html).toContain(copy.phoneChangeNote)
    expect(html).not.toContain("wa.me")
  })

  it("emailDiffers ignores case and spaces, as the server does", () => {
    expect(emailDiffers(" Dana@Example.test ", "dana@example.test")).toBe(false)
    expect(emailDiffers("dana2@example.test", "dana@example.test")).toBe(true)
  })

  it("the save sends every checked code, or [] for none", () => {
    const data = new FormData()
    data.append("fullName", "Dana")
    data.append("dietaryNotes", "")
    expect(detailsInput(data)).toEqual({
      fullName: "Dana",
      dietaryNotes: "",
      specialBrunchInterests: [],
    })
    data.append("specialBrunchInterests", "couples")
    data.append("specialBrunchInterests", "grandpa")
    expect(detailsInput(data).specialBrunchInterests).toEqual([
      "couples",
      "grandpa",
    ])
  })
})

// Fix 11 (user decision 2026-10-20): details and babies, each its own
// cube (DESIGN › card) with the cube title.
describe("the profile's cubes", () => {
  it("details and babies are separate cubes with the cube title", () => {
    const details = renderToStaticMarkup(
      <DetailsSection
        fullName="Dana"
        dietaryNotes={null}
        specialBrunch={SPECIAL_BRUNCH_FALLBACK}
        specialBrunchInterests={[]}
        phone={null}
        email={null}
      />
    )
    const babies = renderToStaticMarkup(
      <BabiesSection babies={TWINS} today="2026-10-05" />
    )
    for (const html of [details, babies]) {
      expect(html).toMatch(
        /^<section [^>]*class="[^"]*rounded-xl border border-border bg-card p-4/
      )
      expect(html).toContain(`class="${cubeTitleClass}"`)
      expect(html.match(/<section/g)).toHaveLength(1)
    }
    expect(details).toContain(copy.detailsTitle)
    expect(details).not.toContain(copy.babiesTitle)
    expect(babies).toContain(copy.babiesTitle)
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

describe("PhotoConsentSection on its own page", () => {
  it("leaves its h2 out (the page's h1 is the title), same forms and note", () => {
    const html = renderToStaticMarkup(
      <PhotoConsentSection
        content={{
          atmosphere_title: "Atmosphere",
          atmosphere_question: "AQ",
          atmosphere_yes: "Yes",
          atmosphere_no: "No",
          personal_title: "Personal",
          personal_question: "PQ",
          personal_yes: "Yes",
          personal_no: "No",
          note: "Note",
        }}
        consents={{ atmosphere: true, personal: false }}
        titled={false}
      />
    )
    expect(html).not.toContain("<h2")
    expect(html).toContain(`aria-label="${copy.photoTitle}"`)
    expect(html.match(/<form/g)).toHaveLength(2)
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
