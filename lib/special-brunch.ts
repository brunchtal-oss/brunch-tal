import type { SpecialBrunchContent } from "@/lib/content/schema"

// Story 2.16: the special brunches a customer wants to hear about. The codes
// are fixed (profiles_special_brunch_interests_check); their words are the
// content block join-form › special_brunch. The database stores codes only,
// so editing the text never changes an answer. Pure: shared by the forms,
// the Server Actions, the customers list and the export.

export const SPECIAL_BRUNCH_CODES = ["couples", "grandma", "grandpa"] as const

export type SpecialBrunchCode = (typeof SPECIAL_BRUNCH_CODES)[number]

// The form field of the checkboxes (one value per checked code).
export const SPECIAL_BRUNCH_FIELD = "specialBrunchInterests"

export function isSpecialBrunchCode(
  value: unknown
): value is SpecialBrunchCode {
  return (
    typeof value === "string" &&
    (SPECIAL_BRUNCH_CODES as readonly string[]).includes(value)
  )
}

// The checked values of a form: known codes only, each once, in code order;
// null when any value is not a known code.
export function parseSpecialBrunchInterests(
  values: readonly unknown[]
): SpecialBrunchCode[] | null {
  if (!values.every(isSpecialBrunchCode)) return null
  return SPECIAL_BRUNCH_CODES.filter((code) => values.includes(code))
}

// The customers list's and the export's ?interest= (phone-check fix, user
// decision 2026-11-10: several at once): codes joined by ",", each once,
// returned in code order. Absent -> [] (no filter); empty, an unknown or a
// repeated code -> null.
export function parseSpecialBrunchList(
  raw: string | null | undefined
): SpecialBrunchCode[] | null {
  if (raw === null || raw === undefined) return []
  const values = raw.split(",")
  if (new Set(values).size !== values.length) return null
  return parseSpecialBrunchInterests(values)
}

// The address form of a filter: the codes in code order, joined by ",".
export function specialBrunchListParam(
  codes: readonly SpecialBrunchCode[]
): string {
  return orderedSpecialBrunchCodes(codes).join(",")
}

// Stored codes for display: known ones only, each once, in code order.
export function orderedSpecialBrunchCodes(
  values: readonly unknown[] | null | undefined
): SpecialBrunchCode[] {
  return SPECIAL_BRUNCH_CODES.filter((code) => values?.includes(code))
}

// The block's wording seeded by 20261109224655_special_brunch_interest.sql,
// word for word: the text shown when the published block is missing or
// invalid (special-brunch-seed.test.ts compares the two).
export const SPECIAL_BRUNCH_FALLBACK: SpecialBrunchContent = {
  question: "תרצי שאעדכן אותך על בראנצ׳ים מיוחדים?",
  couples_title: "בראנץ׳ זוגות",
  couples_hint: "את מגיעה עם הבייבי ועם בן או בת הזוג",
  grandma_title: "בראנץ׳ עם סבתוש",
  grandma_hint: "את מגיעה עם הבייבי ועם סבתא",
  grandpa_title: "בראנץ׳ עם סבוש",
  grandpa_hint: "את מגיעה עם הבייבי ועם סבא",
}

export type SpecialBrunchOption = {
  code: SpecialBrunchCode
  title: string
  // null: no line under the checkbox.
  hint: string | null
}

// The options of the block, in code order.
export function specialBrunchOptions(
  content: SpecialBrunchContent
): SpecialBrunchOption[] {
  return SPECIAL_BRUNCH_CODES.map((code) => ({
    code,
    title: content[`${code}_title`],
    hint: content[`${code}_hint`] ?? null,
  }))
}

// The titles of stored codes, in code order (the card, the export cell).
export function specialBrunchLabels(
  content: SpecialBrunchContent,
  values: readonly unknown[] | null | undefined
): string[] {
  return orderedSpecialBrunchCodes(values).map(
    (code) => content[`${code}_title`]
  )
}
