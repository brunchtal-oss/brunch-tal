import { describe, expect, it } from "vitest"

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
  values: { name, text: `${name} text` },
})

describe("section fields", () => {
  it("describes each edited kind", () => {
    for (const kind of [
      "hero",
      "text_block",
      "steps",
      "faq",
      "testimonials",
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
        { name: "a", text: "1" },
        { name: "b", text: "2", hidden: true },
      ],
    }
    const state = fromContent(spec, content)
    expect(state.items.map((i) => i.hidden)).toEqual([false, true])
    expect(state.hidden).toBe(true)
    expect(toContent(spec, state)).toEqual(content)
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
    expect(items[2].values).toEqual({ name: "", text: "" })

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
      { name: "Noa", text: "Noa text", hidden: true },
      { name: "Dana", text: "Dana text" },
    ])
  })

  it("refuses a new testimonial without its text, next to the field", () => {
    const items = addItem([item("a", "Noa")], list, "n1")
    items[1] = { ...items[1], values: { name: "Lea", text: "" } }
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
