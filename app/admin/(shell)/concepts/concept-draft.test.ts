import { describe, expect, it } from "vitest"

import {
  conceptChanges,
  createPayload,
  draftFromRow,
  emptyDraft,
  fieldError,
  imageChanged,
  visibleConcepts,
  type ConceptRow,
} from "./concept-draft"

const ROW: ConceptRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "יווני",
  description: "תיאור",
  default_kind: "regular",
  archived_at: null,
  image: null,
  image_path: null,
}

describe("fieldError", () => {
  it("needs a name of up to 100 characters (trimmed)", () => {
    expect(fieldError("name", { ...emptyDraft(), name: "  " })).toBe("required")
    expect(fieldError("name", { ...emptyDraft(), name: "x".repeat(101) })).toBe(
      "tooLong"
    )
    expect(
      fieldError("name", { ...emptyDraft(), name: ` ${"x".repeat(100)} ` })
    ).toBeNull()
  })

  it("takes a description of up to 2000 characters", () => {
    const draft = { ...emptyDraft(), name: "n" }
    expect(
      fieldError("description", { ...draft, description: "x".repeat(2001) })
    ).toBe("tooLong")
    expect(fieldError("description", { ...draft, description: "" })).toBeNull()
  })
})

describe("createPayload", () => {
  it("trims, sends an empty description as null", () => {
    expect(
      createPayload({ name: " חגים ", description: "  ", kind: "couple" })
    ).toEqual({
      ok: true,
      concept: { name: "חגים", description: null, default_kind: "couple" },
    })
  })

  it("names the first field to fix", () => {
    expect(createPayload(emptyDraft())).toEqual({ ok: false, field: "name" })
    expect(
      createPayload({
        name: "n",
        description: "x".repeat(2001),
        kind: "regular",
      })
    ).toEqual({ ok: false, field: "description" })
  })
})

describe("conceptChanges", () => {
  it("is null when nothing changed", () => {
    expect(conceptChanges(ROW, draftFromRow(ROW))).toEqual({
      ok: true,
      changes: null,
    })
    expect(
      conceptChanges(ROW, { ...draftFromRow(ROW), name: " יווני " })
    ).toEqual({ ok: true, changes: null })
  })

  it("sends only the changed fields; an empty description is null", () => {
    expect(
      conceptChanges(ROW, {
        name: "יווני",
        description: "",
        kind: "couple",
      })
    ).toEqual({
      ok: true,
      changes: { description: null, default_kind: "couple" },
    })
    expect(conceptChanges(ROW, { ...draftFromRow(ROW), name: "אחר" })).toEqual({
      ok: true,
      changes: { name: "אחר" },
    })
  })

  it("names a field to fix", () => {
    expect(conceptChanges(ROW, { ...draftFromRow(ROW), name: "" })).toEqual({
      ok: false,
      field: "name",
    })
  })
})

describe("imageChanged", () => {
  const image = { media_id: "m", alt: "a", focus_x: 50, focus_y: 50 }
  it("compares the id, alt (trimmed) and focus", () => {
    expect(imageChanged(null, null)).toBe(false)
    expect(imageChanged(null, image)).toBe(true)
    expect(imageChanged(image, null)).toBe(true)
    expect(imageChanged(image, { ...image, alt: " a " })).toBe(false)
    expect(imageChanged(image, { ...image, focus_x: 20 })).toBe(true)
  })
})

describe("visibleConcepts", () => {
  const archived = { ...ROW, id: "a", archived_at: "2026-10-10T10:00:00Z" }
  const active = { ...ROW, id: "b" }
  it("hides the archived until shown, then lists them after the active", () => {
    expect(visibleConcepts([archived, active], false)).toEqual([active])
    expect(visibleConcepts([archived, active], true)).toEqual([
      active,
      archived,
    ])
  })
})
