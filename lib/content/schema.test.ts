import { describe, expect, it } from "vitest"

import { businessDetailsSchema, photoConsentSchema } from "./schema"

// The shapes the migration seeds (create_join_flow).
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
