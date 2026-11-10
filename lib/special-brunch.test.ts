import { describe, expect, it } from "vitest"

import { schemaForKind, specialBrunchSchema } from "@/lib/content/schema"

import {
  orderedSpecialBrunchCodes,
  parseSpecialBrunchInterests,
  SPECIAL_BRUNCH_FALLBACK as SB,
  specialBrunchLabels,
  specialBrunchOptions,
} from "./special-brunch"

// Story 2.16: the fixed codes and the content block's wording.

describe("parseSpecialBrunchInterests", () => {
  it("known codes, each once, in code order; [] is a valid answer", () => {
    expect(parseSpecialBrunchInterests(["grandpa", "couples"])).toEqual([
      "couples",
      "grandpa",
    ])
    expect(parseSpecialBrunchInterests(["couples", "couples"])).toEqual([
      "couples",
    ])
    expect(parseSpecialBrunchInterests([])).toEqual([])
  })

  it.each([[["aunt"]], [["couples", "aunt"]], [[1]], [[null]]])(
    "refuses %j",
    (values) => {
      expect(parseSpecialBrunchInterests(values)).toBeNull()
    }
  )
})

describe("the stored codes for display", () => {
  it("known ones only, in code order", () => {
    expect(orderedSpecialBrunchCodes(["grandpa", "x", "grandma"])).toEqual([
      "grandma",
      "grandpa",
    ])
    expect(orderedSpecialBrunchCodes(null)).toEqual([])
  })

  it("labels by the published titles (an edited title shows)", () => {
    expect(
      specialBrunchLabels({ ...SB, grandma_title: "X" }, ["grandma"])
    ).toEqual(["X"])
    expect(specialBrunchLabels(SB, [])).toEqual([])
  })
})

describe("the content block", () => {
  it("is the editor's schema for the special_brunch kind", () => {
    expect(schemaForKind("special_brunch")).toBe(specialBrunchSchema)
  })

  it("question and titles required, hints optional (empty = no line)", () => {
    expect(specialBrunchSchema.safeParse(SB).success).toBe(true)
    const noHints = specialBrunchSchema.safeParse({
      ...SB,
      couples_hint: "  ",
      grandma_hint: undefined,
    })
    expect(noHints.success && noHints.data.couples_hint).toBeUndefined()
    expect(
      specialBrunchOptions(noHints.success ? noHints.data : SB)[0]
    ).toEqual({ code: "couples", title: SB.couples_title, hint: null })
  })

  it.each([
    ["an empty question", { ...SB, question: " " }],
    ["an empty title", { ...SB, grandpa_title: "" }],
    ["a title over 200", { ...SB, couples_title: "x".repeat(201) }],
    ["a hint over 200", { ...SB, grandma_hint: "x".repeat(201) }],
  ])("refuses %s", (_label, value) => {
    expect(specialBrunchSchema.safeParse(value).success).toBe(false)
  })

  it("three options in code order, with their hints", () => {
    expect(specialBrunchOptions(SB).map((o) => [o.code, o.hint])).toEqual([
      ["couples", SB.couples_hint],
      ["grandma", SB.grandma_hint],
      ["grandpa", SB.grandpa_hint],
    ])
  })
})
