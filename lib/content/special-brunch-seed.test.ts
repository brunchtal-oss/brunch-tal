import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { SPECIAL_BRUNCH_FALLBACK } from "@/lib/special-brunch"

import { specialBrunchSchema } from "./schema"

// Story 2.16: the migration seeds join-form › special_brunch with the user's
// wording (spec, word for word; the geresh ׳ per the Spec Change Log of
// 2026-11-10), and the fallback in code is the same text. Read from the
// migration file, so a later edit in the dev database does not break it.

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20261109224655_special_brunch_interest.sql"
)

const APPROVED = {
  question: "תרצי שאעדכן אותך על בראנצ׳ים מיוחדים?",
  couples_title: "בראנץ׳ זוגות",
  couples_hint: "את מגיעה עם הבייבי ועם בן או בת הזוג",
  grandma_title: "בראנץ׳ עם סבתוש",
  grandma_hint: "את מגיעה עם הבייבי ועם סבתא",
  grandpa_title: "בראנץ׳ עם סבוש",
  grandpa_hint: "את מגיעה עם הבייבי ועם סבא",
}

describe("the special-brunch seed of the migration", () => {
  const sql = readFileSync(MIGRATION, "utf8")
  // The one JSON literal, used for the draft and the full published copy.
  const match = /select '([^']*)'::jsonb as content/.exec(sql)

  it("seeds the approved wording, in the block's schema", () => {
    expect(match).not.toBeNull()
    const content: unknown = JSON.parse(match![1])
    expect(content).toEqual(APPROVED)
    expect(specialBrunchSchema.safeParse(content).success).toBe(true)
  })

  it("writes draft_content and published_content_full, never published_content alone", () => {
    expect(sql).toMatch(
      /insert into public\.content_sections \(\s*page_slug, key, kind, sort_order, draft_content, published_content_full, published_at\s*\)\s*select 'join-form', 'special_brunch', 'special_brunch', 2, s\.content, s\.content, now\(\)/
    )
  })

  it("the fallback in code is the seed, word for word", () => {
    expect(SPECIAL_BRUNCH_FALLBACK).toEqual(APPROVED)
  })
})
