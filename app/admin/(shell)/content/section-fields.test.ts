import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { fieldErrors, type SectionRef } from "./content-items"
import {
  addItem,
  fieldId,
  fromContent,
  itemName,
  keptFields,
  moveItem,
  removeItem,
  sectionSpec,
  toContent,
  toggleItemHidden,
  type EditorItem,
  type ListField,
} from "./section-fields"

const TESTIMONIALS: SectionRef = {
  slug: "gallery",
  key: "testimonials",
  kind: "testimonials",
}
const spec = sectionSpec(TESTIMONIALS)
const list = spec.fields.find((f) => f.type === "list") as ListField

const item = (id: string, name: string): EditorItem => ({
  id,
  hidden: false,
  values: { kind: "text", name, text: `${name} text` },
})

describe("section fields", () => {
  it("adds a second add button only to the gallery and the testimonials", () => {
    const addAtTop = (kind: string) =>
      sectionSpec({ slug: "gallery", key: "y", kind }).fields.some(
        (f) => f.type === "list" && f.addAtTop === true
      )
    expect(addAtTop("gallery")).toBe(true)
    expect(addAtTop("testimonials")).toBe(true)
    expect(addAtTop("steps")).toBe(false)
    expect(addAtTop("faq")).toBe(false)
  })

  it("describes each edited kind", () => {
    for (const kind of [
      "hero",
      "text_block",
      "steps",
      "faq",
      "testimonials",
      "gallery",
      "footer",
      "photo_consent",
      "business_details",
    ]) {
      expect(
        sectionSpec({ slug: "home", key: "x", kind }).fields.length
      ).toBeGreaterThan(0)
    }
    expect(sectionSpec({ slug: "home", key: "x", kind: "odd" }).fields).toEqual(
      []
    )
  })

  it("hides only text blocks and lists", () => {
    const hideable = (kind: string) =>
      sectionSpec({ slug: "home", key: "x", kind }).hideable
    expect(hideable("text_block")).toBe(true)
    expect(hideable("testimonials")).toBe(true)
    expect(hideable("hero")).toBe(false)
    expect(hideable("business_details")).toBe(false)
    expect(hideable("photo_consent")).toBe(false)
    expect(hideable("footer")).toBe(false)
  })

  it("leaves the button label and the payment instructions out", () => {
    const names = (kind: string) =>
      sectionSpec({ slug: "home", key: "x", kind }).fields.map((f) => f.name)
    expect(names("hero")).not.toContain("cta_label")
    expect(names("business_details")).not.toContain("payment_instructions")
  })

  it("round-trips content through the form", () => {
    const content = {
      title: "T",
      hidden: true,
      items: [
        { kind: "text", name: "a", text: "1" },
        { kind: "text", name: "b", text: "2", hidden: true },
      ],
    }
    const state = fromContent(spec, content)
    expect(state.items.map((i) => i.hidden)).toEqual([false, true])
    expect(state.hidden).toBe(true)
    expect(toContent(spec, state)).toEqual(content)
  })

  it("reads an old testimonial without a kind as text", () => {
    const state = fromContent(spec, { items: [{ name: "a", text: "1" }] })
    expect(state.items[0].values.kind).toBe("text")
    expect(toContent(spec, state).items).toEqual([
      { kind: "text", name: "a", text: "1" },
    ])
  })

  it("saves an image testimonial with its image only (story 5.4)", () => {
    const media = "3f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
    const state = fromContent(spec, {
      items: [
        {
          kind: "image",
          image: { media_id: media, alt: "great", focus_x: 50, focus_y: 50 },
          name: "",
        },
      ],
    })
    const content = toContent(spec, state)
    expect(content.items).toEqual([
      {
        kind: "image",
        image: { media_id: media, alt: "great", focus_x: 50, focus_y: 50 },
        name: "",
      },
    ])
    expect(fieldErrors(TESTIMONIALS, content)).toBeNull()

    // Without the image: the error is under the image field.
    const empty = {
      ...state,
      items: [{ ...state.items[0], images: { image: null } }],
    }
    expect(fieldErrors(TESTIMONIALS, toContent(spec, empty))).toEqual({
      "items.0.image": { kind: "required" },
    })
  })

  it("keeps a block image, without an empty alt", () => {
    const hero = sectionSpec({ slug: "home", key: "hero", kind: "hero" })
    const media = "3f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
    const state = fromContent(hero, {
      title: "t",
      image: { media_id: media, alt: "", focus_x: 10, focus_y: 90 },
    })
    expect(state.images?.image).toEqual({
      media_id: media,
      alt: "",
      focus_x: 10,
      focus_y: 90,
    })
    expect(toContent(hero, state)).toEqual({
      title: "t",
      description: "",
      image: { media_id: media, focus_x: 10, focus_y: 90 },
    })
    // Removed: no image in the content.
    expect(
      toContent(hero, { ...state, images: { image: null } }).image
    ).toBeUndefined()
  })

  it("offers an image only in about › main among the text blocks", () => {
    const fields = (slug: "about" | "home", key: string) =>
      sectionSpec({ slug, key, kind: "text_block" }).fields.map((f) => f.type)
    expect(fields("about", "main")).toContain("image")
    expect(fields("home", "intro")).not.toContain("image")
  })

  it("drops a hero's old button label when saving", () => {
    const hero = sectionSpec({ slug: "home", key: "hero", kind: "hero" })
    const state = fromContent(hero, { title: "t", cta_label: "c" })
    expect(toContent(hero, state)).toEqual({ title: "t", description: "" })
  })

  it("keeps the payment instructions of the business details", () => {
    const ref: SectionRef = {
      slug: "contact",
      key: "business_details",
      kind: "business_details",
    }
    const saved = { whatsapp_phone: "0544256456", payment_instructions: "p" }
    const business = sectionSpec(ref)
    const content = toContent(
      business,
      fromContent(business, saved),
      keptFields(ref, saved)
    )
    expect(content.payment_instructions).toBe("p")
    expect(keptFields(TESTIMONIALS, saved)).toEqual({})
  })

  it("adds, moves, hides and deletes a testimonial", () => {
    let items = [item("a", "Noa"), item("b", "Dana")]
    items = addItem(items, list, "n1")
    expect(items.map((i) => i.id)).toEqual(["a", "b", "n1"])
    expect(items[2].values).toEqual({ kind: "text", name: "", text: "" })
    expect(items[2].images).toEqual({ image: null })

    items = moveItem(items, 2, -1)
    expect(items.map((i) => i.id)).toEqual(["a", "n1", "b"])
    // Past the ends: nothing moves.
    expect(moveItem(items, 0, -1).map((i) => i.id)).toEqual(["a", "n1", "b"])
    expect(moveItem(items, 2, 1).map((i) => i.id)).toEqual(["a", "n1", "b"])

    items = toggleItemHidden(items, 0)
    expect(items[0].hidden).toBe(true)
    expect(toggleItemHidden(items, 0)[0].hidden).toBe(false)

    items = removeItem(items, 1)
    expect(items.map((i) => i.id)).toEqual(["a", "b"])

    const content = toContent(spec, {
      text: { title: "" },
      items,
      hidden: false,
    })
    expect(content.items).toEqual([
      { kind: "text", name: "Noa", text: "Noa text", hidden: true },
      { kind: "text", name: "Dana", text: "Dana text" },
    ])
  })

  it("refuses a new testimonial without its text, next to the field", () => {
    const items = addItem([item("a", "Noa")], list, "n1")
    items[1] = {
      ...items[1],
      values: { kind: "text", name: "Lea", text: "" },
    }
    const content = toContent(spec, { text: {}, items, hidden: false })
    const errors = fieldErrors(TESTIMONIALS, content)
    expect(errors).toEqual({ "items.1.text": { kind: "required" } })
    expect(fieldId("items.1.text")).toBe("field-items-1-text")
  })

  it("saves a list with no items", () => {
    const content = toContent(spec, { text: {}, items: [], hidden: false })
    expect(fieldErrors(TESTIMONIALS, content)).toBeNull()
  })

  it("names an item by its first field, else by its place", () => {
    expect(itemName(list, item("a", "Noa"), 0)).toBe("Noa")
    expect(itemName(list, item("a", " "), 1)).toBe(list.itemLabel(2))
    expect(itemName(list, item("a", "x".repeat(50)), 0)).toHaveLength(41)
  })
})

// Story 5.5: the legal pages (one text field each, user decision
// 2026-10-06).
describe("legal fields", () => {
  const LEGAL: SectionRef = {
    slug: "privacy",
    key: "body",
    kind: "legal_text",
  }
  const STATEMENT: SectionRef = {
    slug: "accessibility",
    key: "statement",
    kind: "accessibility_statement",
  }

  it("never hides a legal page", () => {
    expect(sectionSpec(LEGAL).hideable).toBe(false)
    expect(sectionSpec(STATEMENT).hideable).toBe(false)
  })

  it("edits a legal text as one large field with the formatting hint", () => {
    const legalSpec = sectionSpec(LEGAL)
    expect(legalSpec.fields).toEqual([
      expect.objectContaining({
        type: "text",
        name: "body",
        multiline: true,
        large: true,
        maxLength: 50000,
        hint: adminCopy.content.legal.hint,
      }),
    ])
    const state = fromContent(legalSpec, { hidden: true, body: "## a\n\nb" })
    expect(toContent(legalSpec, state)).toEqual({ body: "## a\n\nb" })
    expect(fieldErrors(LEGAL, { body: "" })).toEqual({
      body: { kind: "required" },
    })
  })

  it("edits the statement as one large text, then the three contact fields", () => {
    const statementSpec = sectionSpec(STATEMENT)
    expect(statementSpec.fields.map((field) => field.name)).toEqual([
      "body",
      "contact_name",
      "contact_phone",
      "contact_email",
    ])
    expect(statementSpec.fields[0]).toMatchObject({
      type: "text",
      multiline: true,
      large: true,
      maxLength: 50000,
      hint: adminCopy.content.legal.hint,
    })
    const content = {
      body: "## a\n\n1",
      contact_name: "n",
      contact_phone: "054-4256456",
      contact_email: "a@example.com",
    }
    const state = fromContent(statementSpec, content)
    expect(toContent(statementSpec, state)).toEqual(content)
    expect(fieldErrors(STATEMENT, toContent(statementSpec, state))).toBeNull()
  })

  it("names the missing required fields of the statement", () => {
    const base = {
      body: "b",
      contact_name: "n",
      contact_phone: "054-4256456",
    }
    expect(fieldErrors(STATEMENT, { ...base, contact_email: "" })).toEqual({
      contact_email: { kind: "required" },
    })
    expect(fieldErrors(STATEMENT, { ...base, contact_email: "nope" })).toEqual({
      contact_email: { kind: "email" },
    })
  })
})
