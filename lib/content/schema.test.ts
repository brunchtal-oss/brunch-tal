import { describe, expect, it } from "vitest"

import {
  businessDetailsSchema,
  faqSchema,
  footerSchema,
  heroSchema,
  photoConsentSchema,
  schemaForKind,
  stepsSchema,
  testimonialsSchema,
  textBlockSchema,
} from "./schema"

// The shapes the migrations seed (create_join_flow) and the editor saves.
describe("content schemas", () => {
  it("parses the seeded business details", () => {
    expect(
      businessDetailsSchema.safeParse({ whatsapp_phone: "0544256456" }).success
    ).toBe(true)
    expect(
      businessDetailsSchema.safeParse({ whatsapp_phone: " " }).success
    ).toBe(false)
    expect(businessDetailsSchema.safeParse({}).success).toBe(false)
  })

  it("parses the seeded photo consent and refuses a missing answer", () => {
    const seed = { question: "a\nb", yes_label: "yes", no_label: "no" }
    expect(photoConsentSchema.safeParse(seed).success).toBe(true)
    expect(
      photoConsentSchema.safeParse({ ...seed, no_label: "" }).success
    ).toBe(false)
  })
})

describe("heroSchema", () => {
  const hero = { title: "t", description: "d", cta_label: "c" }

  it("trims and keeps a valid hero", () => {
    expect(
      heroSchema.parse({ title: " t ", description: " d ", cta_label: " c " })
    ).toEqual(hero)
  })

  it("treats an empty description as missing", () => {
    const parsed = heroSchema.parse({ ...hero, description: "  " })
    expect(parsed.description).toBeUndefined()
    expect(JSON.parse(JSON.stringify(parsed))).toEqual({
      title: "t",
      cta_label: "c",
    })
  })

  it.each([
    ["no title", { ...hero, title: undefined }],
    ["an empty title", { ...hero, title: " " }],
    ["an empty button label", { ...hero, cta_label: "" }],
    ["a title over 80", { ...hero, title: "x".repeat(81) }],
    ["a description over 300", { ...hero, description: "x".repeat(301) }],
    ["a button label over 40", { ...hero, cta_label: "x".repeat(41) }],
  ])("refuses %s", (_label, value) => {
    expect(heroSchema.safeParse(value).success).toBe(false)
  })

  it("accepts the limits", () => {
    expect(
      heroSchema.safeParse({
        title: "x".repeat(80),
        description: "x".repeat(300),
        cta_label: "x".repeat(40),
      }).success
    ).toBe(true)
  })
})

describe("businessDetailsSchema", () => {
  const full = {
    whatsapp_phone: "054-425-6456",
    business_name: "n",
    phone: "0544256456",
    whatsapp_message: "m",
    address: "a",
    arrival_instructions: "i",
    navigation_url: "https://maps.example.com/x",
    payment_instructions: "p",
  }

  it("keeps every field", () => {
    expect(businessDetailsSchema.parse(full)).toEqual(full)
  })

  it("drops empty optional fields", () => {
    const parsed = businessDetailsSchema.parse({
      whatsapp_phone: "0544256456",
      business_name: "",
      phone: " ",
      navigation_url: "",
    })
    expect(JSON.parse(JSON.stringify(parsed))).toEqual({
      whatsapp_phone: "0544256456",
    })
  })

  it.each([
    ["a WhatsApp number that cannot be read", { whatsapp_phone: "abc" }],
    ["a phone that cannot be read", { phone: "12" }],
    ["a navigation link over http", { navigation_url: "http://x.example" }],
    ["a navigation link that is not a URL", { navigation_url: "maps" }],
  ])("refuses %s", (_label, change) => {
    expect(
      businessDetailsSchema.safeParse({ ...full, ...change }).success
    ).toBe(false)
  })
})

describe("textBlockSchema", () => {
  it("keeps the body's line breaks and drops an empty eyebrow", () => {
    const parsed = textBlockSchema.parse({
      eyebrow: " ",
      title: " t ",
      body: ["a", "b"].join("\n"),
    })
    expect(JSON.parse(JSON.stringify(parsed))).toEqual({
      title: "t",
      body: ["a", "b"].join("\n"),
    })
  })

  it("accepts a heading without a body (home › contact)", () => {
    const parsed = textBlockSchema.parse({ title: "t", body: " " })
    expect(JSON.parse(JSON.stringify(parsed))).toEqual({ title: "t" })
  })

  it("refuses a block without a title", () => {
    expect(textBlockSchema.safeParse({ body: "b" }).success).toBe(false)
  })
})

describe("list schemas", () => {
  it.each([
    [stepsSchema, { title: "t", body: "b" }],
    [faqSchema, { question: "q", answer: "a" }],
    [testimonialsSchema, { name: "n", text: "t" }],
  ] as const)("parses items and refuses an empty list", (schema, item) => {
    expect(schema.safeParse({ items: [item] }).success).toBe(true)
    expect(schema.safeParse({ items: [] }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })

  it("refuses a step without a body", () => {
    expect(
      stepsSchema.safeParse({ items: [{ title: "t", body: "" }] }).success
    ).toBe(false)
    expect(
      stepsSchema.safeParse({ items: [{ title: "t", body: "b" }] }).success
    ).toBe(true)
  })

  it("refuses a testimonial without a name", () => {
    expect(
      testimonialsSchema.safeParse({ items: [{ name: " ", text: "t" }] })
        .success
    ).toBe(false)
  })
})

describe("footerSchema", () => {
  it("needs a text", () => {
    expect(footerSchema.safeParse({ text: "f" }).success).toBe(true)
    expect(footerSchema.safeParse({ text: "" }).success).toBe(false)
  })
})

describe("schemaForKind", () => {
  it("maps each kind to its schema", () => {
    expect(schemaForKind("hero")).toBe(heroSchema)
    expect(schemaForKind("business_details")).toBe(businessDetailsSchema)
    expect(schemaForKind("photo_consent")).toBe(photoConsentSchema)
    expect(schemaForKind("text_block")).toBe(textBlockSchema)
    expect(schemaForKind("steps")).toBe(stepsSchema)
    expect(schemaForKind("faq")).toBe(faqSchema)
    expect(schemaForKind("testimonials")).toBe(testimonialsSchema)
    expect(schemaForKind("footer")).toBe(footerSchema)
  })

  it.each(["test", "toString", "__proto__", ""])(
    "has no schema for %s",
    (kind) => {
      expect(schemaForKind(kind)).toBeNull()
    }
  )
})
