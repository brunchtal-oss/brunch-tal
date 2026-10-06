import { describe, expect, it } from "vitest"

import {
  ACCESSIBILITY_REQUIRED_FIELDS,
  accessibilityStatementSchema,
  businessDetailsSchema,
  faqSchema,
  footerSchema,
  heroSchema,
  legalTextSchema,
  photoConsentSchema,
  schemaForKind,
  schemaForSection,
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
    ["a title over 80", { ...hero, title: "x".repeat(81) }],
    ["a description over 300", { ...hero, description: "x".repeat(301) }],
  ])("refuses %s", (_label, value) => {
    expect(heroSchema.safeParse(value).success).toBe(false)
  })

  it("still parses a hero published with a button label, and one without", () => {
    expect(heroSchema.safeParse(hero).success).toBe(true)
    expect(heroSchema.safeParse({ title: "t" }).success).toBe(true)
    expect(heroSchema.parse({ title: "t", cta_label: "" })).toEqual({
      title: "t",
    })
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
  ] as const)(
    "parses items, an empty list and hidden flags, not a missing list",
    (schema, item) => {
      expect(schema.safeParse({ items: [item] }).success).toBe(true)
      // An empty list is saved and published; the site does not show it.
      expect(schema.safeParse({ items: [] }).success).toBe(true)
      expect(
        schema.safeParse({ hidden: true, items: [{ ...item, hidden: true }] })
          .success
      ).toBe(true)
      expect(
        schema.safeParse({ items: [{ ...item, hidden: "yes" }] }).success
      ).toBe(false)
      expect(schema.safeParse({}).success).toBe(false)
    }
  )

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
  it("still parses the old text, and links", () => {
    expect(footerSchema.safeParse({ text: "f" }).success).toBe(true)
    expect(footerSchema.safeParse({}).success).toBe(true)
    expect(
      footerSchema.safeParse({
        items: [
          { label: "Instagram", url: " https://instagram.com/x " },
          { label: "f", url: "https://f.example", hidden: true },
        ],
      }).success
    ).toBe(true)
  })

  it.each([
    ["http", { label: "x", url: "http://instagram.com/x" }],
    ["text that is not a link", { label: "x", url: "instagram" }],
    ["no label", { label: " ", url: "https://x.example" }],
    ["an empty address", { label: "x", url: " " }],
    ["javascript", { label: "x", url: "javascript:alert(1)" }],
  ])("refuses a link with %s", (_label, item) => {
    expect(footerSchema.safeParse({ items: [item] }).success).toBe(false)
  })
})

describe("textBlockSchema hidden", () => {
  it("parses a hidden block", () => {
    expect(
      textBlockSchema.safeParse({ title: "t", hidden: true }).success
    ).toBe(true)
  })
})

describe("schemaForSection", () => {
  it.each(["home/intro", "about/main", "contact/intro"])(
    "requires the body of %s",
    (section) => {
      const [slug, key] = section.split("/")
      const schema = schemaForSection(slug, key, "text_block")
      expect(schema?.safeParse({ title: "t" }).success).toBe(false)
      expect(schema?.safeParse({ title: "t", body: " " }).success).toBe(false)
      expect(schema?.safeParse({ title: "t", body: "b" }).success).toBe(true)
    }
  )

  it("keeps home › contact a heading only", () => {
    expect(
      schemaForSection("home", "contact", "text_block")?.safeParse({
        title: "t",
      }).success
    ).toBe(true)
  })

  it("uses the kind's schema for the other sections", () => {
    expect(schemaForSection("home", "hero", "hero")).toBe(heroSchema)
    expect(schemaForSection("site", "footer", "footer")).toBe(footerSchema)
    expect(schemaForSection("home", "x", "odd")).toBeNull()
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

// Story 5.5: the legal pages (one text field, user decision 2026-10-06).
describe("legalTextSchema", () => {
  it("needs the body, up to 50000 characters", () => {
    expect(legalTextSchema.safeParse({ body: "## a\n\nb" }).success).toBe(true)
    expect(legalTextSchema.safeParse({ body: " " }).success).toBe(false)
    expect(legalTextSchema.safeParse({}).success).toBe(false)
    expect(legalTextSchema.safeParse({ body: "x".repeat(50001) }).success).toBe(
      false
    )
  })

  it("drops a hidden flag, so a legal text cannot be hidden", () => {
    expect(legalTextSchema.parse({ hidden: true, body: "b" })).toEqual({
      body: "b",
    })
  })

  it("is the schema of the kind; legal_sections is gone", () => {
    expect(schemaForKind("legal_text")).toBe(legalTextSchema)
    expect(schemaForKind("legal_sections")).toBeNull()
  })
})

describe("accessibilityStatementSchema", () => {
  const statement = {
    body: "## h\n\ntext",
    contact_name: "n",
    contact_phone: "054-4256456",
    contact_email: "a@example.com",
  }

  it("parses the required fields alone", () => {
    expect(accessibilityStatementSchema.safeParse(statement).success).toBe(true)
  })

  it.each(ACCESSIBILITY_REQUIRED_FIELDS)("refuses without %s", (field) => {
    expect(
      accessibilityStatementSchema.safeParse({ ...statement, [field]: "" })
        .success
    ).toBe(false)
  })

  it("refuses an invalid email and phone", () => {
    expect(
      accessibilityStatementSchema.safeParse({
        ...statement,
        contact_email: "not-an-email",
      }).success
    ).toBe(false)
    expect(
      accessibilityStatementSchema.safeParse({
        ...statement,
        contact_phone: "abc",
      }).success
    ).toBe(false)
  })

  it("keeps only the four fields (old fields and hidden are dropped)", () => {
    const parsed = accessibilityStatementSchema.parse({
      ...statement,
      hidden: true,
      intro: "i",
      conformance_level: "AA",
      contact_note: "note",
    })
    expect(parsed).toEqual(statement)
    expect(
      accessibilityStatementSchema.safeParse({
        ...statement,
        body: "x".repeat(50001),
      }).success
    ).toBe(false)
  })
})
