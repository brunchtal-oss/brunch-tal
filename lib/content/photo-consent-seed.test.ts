import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { photoConsentSchema } from "./schema"

// Story 2.13: the migration seeds the block with the user's wording (UX
// memlog 2026-10-07), word for word, in the draft and the published
// content. Read from the migration file, so a later edit in the dev
// database does not break it.

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20261007183144_two_photo_consents.sql"
)

const APPROVED = {
  atmosphere_title: "פרסום תמונות אווירה",
  atmosphere_question:
    "האם את מסכימה לפרסום תמונות מהמפגשים שבהן ניתן לזהות אותך או את ילדך, באתר ובערוצי הפרסום של העסק?",
  atmosphere_yes: "כן, אני מסכימה.",
  atmosphere_no: "לא, איני מסכימה.",
  personal_title: "צילום תמונות אישיות ושיתוף בקבוצה",
  personal_question:
    "האם את מסכימה שטל תצלם תמונות אישיות שלך או של ילדך ותשתף אותן בקבוצת הוואטסאפ של הבראנץ׳? התמונות יהיו נגישות לחברות הקבוצה ולא ישמשו לפרסום מטעם העסק.",
  personal_yes: "כן, אני מסכימה.",
  personal_no: "לא, איני מסכימה.",
  note: [
    "הסכמה לגבי ילדך ניתנת על ידך כהורה או כאפוטרופוס מוסמך.",
    "ההסכמות אינן תנאי להשתתפות, וסירוב לא יפגע בשירות שתקבלי.",
    "ההשתתפות כשלעצמה אינה מהווה הסכמה.",
    "ניתן לשנות את בחירתך או לבטל הסכמה להמשך צילום, שיתוף או פרסום בכל עת באפליקציה.",
  ].join("\n"),
}

// The JSON literal of `<column> = '...'::jsonb` (no quote inside the seed).
function literal(sql: string, column: string): unknown {
  const match = new RegExp(`${column} = '([^']*)'::jsonb`).exec(sql)
  if (!match) throw new Error(`${column} not found in the migration`)
  return JSON.parse(match[1])
}

describe("the photo consent seed of the migration", () => {
  const sql = readFileSync(MIGRATION, "utf8")

  it.each(["draft_content", "published_content"])(
    "seeds %s with the approved wording, in the block's schema",
    (column) => {
      const content = literal(sql, column)
      expect(content).toEqual(APPROVED)
      expect(photoConsentSchema.safeParse(content).success).toBe(true)
    }
  )
})
