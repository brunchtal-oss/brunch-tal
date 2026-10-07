import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  PhotoConsentFieldset,
  PhotoConsentNote,
  PhotoConsentQuestions,
} from "./photo-consent-fieldset"

const QUESTION = {
  title: "Title",
  question: "Line 1\nLine 2",
  yesLabel: "Yes",
  noLabel: "No",
}

// Story 2.13: one fieldset per consent, its ids from its name.
describe("PhotoConsentFieldset", () => {
  it("names its ids after the field, with nothing checked in advance", () => {
    const html = renderToStaticMarkup(
      <PhotoConsentFieldset name="personalPhotoConsent" {...QUESTION} />
    )
    expect(html).toContain("<legend")
    expect(html).toContain("Title</legend>")
    expect(html).toContain('id="personalPhotoConsent-yes"')
    expect(html).toContain('id="personalPhotoConsent-no"')
    expect(html.match(/name="personalPhotoConsent"/g)).toHaveLength(2)
    expect(html).toContain('<span class="block">Line 1</span>')
    expect(html).toContain('<span class="block">Line 2</span>')
    expect(html).toContain('aria-describedby="personalPhotoConsent-question"')
    expect(html).not.toContain("checked")
    expect(html).not.toContain("aria-invalid")
  })

  it("shows its error and links it", () => {
    const html = renderToStaticMarkup(
      <PhotoConsentFieldset name="photoConsent" {...QUESTION} error="Pick" />
    )
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain(
      'aria-describedby="photoConsent-question photoConsent-error"'
    )
    expect(html).toContain('id="photoConsent-error"')
    expect(html).toContain("Pick")
  })

  it("checks the saved answer", () => {
    const html = renderToStaticMarkup(
      <PhotoConsentFieldset
        name="photoConsent"
        {...QUESTION}
        defaultValue={false}
      />
    )
    expect(html).toMatch(/id="photoConsent-no"[^>]*checked/)
    expect(html).not.toMatch(/id="photoConsent-yes"[^>]*checked/)
  })
})

describe("PhotoConsentNote", () => {
  it("shows one line per line of the note", () => {
    const html = renderToStaticMarkup(<PhotoConsentNote note={"a\nb"} />)
    expect(html).toContain('<span class="block">a</span>')
    expect(html).toContain('<span class="block">b</span>')
  })
})

describe("PhotoConsentQuestions", () => {
  it("shows both questions under their own names, then the note", () => {
    const html = renderToStaticMarkup(
      <PhotoConsentQuestions
        content={{
          atmosphere_title: "AT",
          atmosphere_question: "AQ",
          atmosphere_yes: "AY",
          atmosphere_no: "AN",
          personal_title: "PT",
          personal_question: "PQ",
          personal_yes: "PY",
          personal_no: "PN",
          note: "NOTE",
        }}
        errors={{ personal: "Pick" }}
      />
    )
    expect(html).toContain('name="photoConsent"')
    expect(html).toContain('name="personalPhotoConsent"')
    expect(html.indexOf("AT")).toBeLessThan(html.indexOf("PT"))
    expect(html.indexOf("PN")).toBeLessThan(html.indexOf("NOTE"))
    expect(html).toContain('id="personalPhotoConsent-error"')
    expect(html).not.toContain('id="photoConsent-error"')
  })
})
