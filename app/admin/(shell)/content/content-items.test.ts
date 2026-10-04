import { describe, expect, it } from "vitest"

import {
  editorContent,
  fieldErrorMessage,
  fieldErrors,
  hasPendingDraft,
  isEditableSlug,
  pageStatus,
  sameContent,
  type ContentSection,
} from "./content-items"

function section(values: Partial<ContentSection>): ContentSection {
  return {
    id: "1",
    key: "hero",
    kind: "hero",
    sort_order: 1,
    hidden: false,
    draft_content: null,
    published_content: null,
    published_at: null,
    updated_at: "2026-10-04T10:00:00+00:00",
    ...values,
  }
}

describe("content items", () => {
  it("edits home and contact only", () => {
    expect(isEditableSlug("home")).toBe(true)
    expect(isEditableSlug("contact")).toBe(true)
    expect(isEditableSlug("privacy")).toBe(false)
    expect(isEditableSlug("toString")).toBe(false)
  })

  it("compares content by value, not key order", () => {
    expect(sameContent({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true)
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameContent(null, undefined)).toBe(true)
  })

  it.each([
    ["no draft", null, null, false],
    ["an empty draft", {}, null, false],
    ["a new draft", { a: 1 }, null, true],
    ["a changed draft", { a: 2 }, { a: 1 }, true],
    ["a published draft", { a: 1 }, { a: 1 }, false],
  ])("%s is pending: %s", (_label, draft, published, expected) => {
    expect(
      hasPendingDraft({ draft_content: draft, published_content: published })
    ).toBe(expected)
  })

  it("gives each page its chip", () => {
    expect(pageStatus({ published_at: null, sections: [section({})] })).toBe(
      "draft"
    )
    expect(
      pageStatus({
        published_at: null,
        sections: [section({ draft_content: { a: 1 } })],
      })
    ).toBe("draft")
    expect(
      pageStatus({
        published_at: "2026-10-04T10:00:00+00:00",
        sections: [
          section({ draft_content: { a: 1 }, published_content: { a: 1 } }),
        ],
      })
    ).toBe("published")
    expect(
      pageStatus({
        published_at: "2026-10-04T10:00:00+00:00",
        sections: [
          section({ draft_content: { a: 2 }, published_content: { a: 1 } }),
        ],
      })
    ).toBe("changed")
  })

  it("starts the editor from the draft, else the published content", () => {
    expect(editorContent(null)).toEqual({})
    expect(editorContent(section({ published_content: { a: 1 } }))).toEqual({
      a: 1,
    })
    expect(
      editorContent(
        section({ draft_content: { a: 2 }, published_content: { a: 1 } })
      )
    ).toEqual({ a: 2 })
  })

  it("names the first error of each field", () => {
    expect(fieldErrors("hero", { title: "t", cta_label: "c" })).toBeNull()
    expect(
      fieldErrors("hero", { title: "", cta_label: "x".repeat(41) })
    ).toEqual({
      title: { kind: "required" },
      cta_label: { kind: "tooLong", max: 40 },
    })
    expect(fieldErrors("hero", {})).toMatchObject({
      title: { kind: "required" },
    })
    expect(
      fieldErrors("business_details", {
        whatsapp_phone: "abc",
        navigation_url: "http://x.example",
      })
    ).toEqual({
      whatsapp_phone: { kind: "phone" },
      navigation_url: { kind: "url" },
    })
  })

  it("has a message for each error", () => {
    for (const error of [
      { kind: "required" },
      { kind: "tooLong", max: 40 },
      { kind: "phone" },
      { kind: "url" },
      { kind: "invalid" },
    ] as const) {
      expect(fieldErrorMessage(error)).toBeTruthy()
    }
    expect(fieldErrorMessage({ kind: "tooLong", max: 40 })).toContain("40")
  })
})
