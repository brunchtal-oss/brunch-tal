import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

// Story 6.11 (round 2): the Hebrew email copy lives in the migration
// (private.email_html, private.email_subject), so both projects send the
// same. Each email is RTL, its link is built from the link argument (our
// verification token, or the hook's reset link with token_hash), it never
// names Tal, and the copy carries no invisible character.

const MIGRATION = "20261111200341_email_hook_and_own_token.sql"
// The hook's current definition (Vault site_url, the throttle).
const FIXES = "20261111202945_email_hook_fixes.sql"
// The current private.email_html (the new look, user decision 2026-11-12).
const DESIGN = "20261112204056_email_design.sql"

function read(file = MIGRATION): string {
  return readFileSync(
    fileURLToPath(new URL(`../supabase/migrations/${file}`, import.meta.url)),
    "utf8"
  ).replace(/\r\n/g, "\n")
}

// The body of one function, from its create line to its closing $$;.
function functionBody(
  sql: string,
  name: string,
  create = "create function"
): string {
  const start = sql.indexOf(`${create} ${name}(`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf("\n$$;", start)
  return sql.slice(start, end)
}

// The copy lines of email_html (v_title / v_intro / v_button / v_footer).
function copyLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^v_(title|intro|button|note) := (array\[)?'/.test(line))
}

// U+200B-U+200F, U+202A-U+202E, U+2060-U+2069, U+FEFF.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/

const sql = read()
const html = functionBody(
  read(DESIGN),
  "private.email_html",
  "create or replace function"
)
const subject = functionBody(sql, "private.email_subject")

// The approved copy (user decision 2026-11-12), word for word, held as
// units that never break inside (a wrap only between them).
const NOTE = "array['הקישור בתוקף לשעה.', 'לא ביקשת? אפשר להתעלם מהמייל.'];"
const APPROVED = [
  "v_title := 'אימות המייל';",
  `v_intro := array['לוחצים על הכפתור,', 'ובעמוד שנפתח על "אימות המייל".'];`,
  "v_button := 'לאימות המייל';",
  `v_note := ${NOTE}`,
  "v_title := 'איפוס סיסמה';",
  "v_intro := array['לבחירת סיסמה חדשה,', 'לוחצים על הכפתור.'];",
  "v_button := 'בחירת סיסמה חדשה';",
  `v_note := ${NOTE}`,
]

describe("the new look and the shorter copy (user decision 2026-11-12)", () => {
  it("has the approved copy word for word", () => {
    expect(copyLines(html)).toEqual(APPROVED)
  })

  it("no sentence breaks mid-line: each unit in a nowrap span", () => {
    expect(html).toContain(
      `v_whole constant text := '<span style="white-space:nowrap">';`
    )
    for (const part of ["v_intro", "v_note"]) {
      expect(html).toContain(
        `v_whole || array_to_string(${part}, '</span> ' || v_whole) || '</span>`
      )
    }
    expect(html).toContain(
      "v_whole || 'הכפתור לא נפתח?</span> ' || v_whole || 'אפשר להעתיק את הקישור לדפדפן:</span>"
    )
  })

  it("puts the link to copy at the very bottom, after the signature, small and grey", () => {
    const signature = html.lastIndexOf("v_name ||")
    const fallback = html.indexOf("הכפתור לא נפתח?")
    expect(fallback).toBeGreaterThan(signature)
    expect(html.slice(fallback - 400, fallback)).toContain("font-size:12px")
    // The note sits right under the button, before the signature.
    expect(html.indexOf("v_note ||")).toBeLessThan(signature)
  })

  it("the image comes from Vault email_image_url, only a public storage URL, decorative", () => {
    expect(html).toContain("where s.name = 'email_image_url'")
    expect(html).toContain("/storage/v1/object/public/")
    expect(html).toContain("when v_image is not null then")
    expect(html).toContain('alt=""')
    // No project URL in the migration.
    expect(read(DESIGN)).not.toMatch(/[a-z0-9]{20}\.supabase\.co/)
  })

  it("the site's address comes from the email's own link", () => {
    expect(html).toContain("v_site text := substring(p_link from")
    expect(html).toContain("private.html_escape(v_site)")
  })

  it("is create or replace only: no drop", () => {
    const statements = read(DESIGN)
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
    expect(statements).not.toMatch(/\bdrop\b/i)
  })
})

describe("the email copy (private.email_html)", () => {
  it("is Hebrew, written from the start side (RTL)", () => {
    expect(html).toContain('<html lang="he" dir="rtl">')
    expect(html).toContain('<body dir="rtl"')
  })

  it("has the two kinds, each with a button and the plain link", () => {
    expect(html).toContain("p_kind = 'verification'")
    expect(html).toContain("p_kind = 'reset'")
    expect(html).toContain("v_link text := private.html_escape(p_link)")
    expect(html.match(/<a href="' \|\| v_link \|\| '"/g)).toHaveLength(2)
    // The plain link, as text.
    expect(html).toContain(`">' || v_link || '</a>`)
  })

  it("says the link lasts an hour and may be ignored, in both kinds", () => {
    for (const phrase of ["בתוקף לשעה", "להתעלם"]) {
      expect(html.split(phrase).length - 1, phrase).toBe(2)
    }
  })

  it("the subjects", () => {
    expect(subject).toContain("'אימות כתובת המייל'")
    expect(subject).toContain("'קישור לאיפוס סיסמה'")
  })

  it("never names Tal, but in the business name (the band and the signature)", () => {
    expect(html.replaceAll("בראנץ׳ אצל טל", "")).not.toContain("טל")
    expect(subject).not.toContain("טל")
  })

  it("has no invisible characters", () => {
    expect(INVISIBLE.test(html)).toBe(false)
    expect(INVISIBLE.test(subject)).toBe(false)
  })
})

describe("the links", () => {
  it("verification: <site>/verify-email?token=<our raw token>", () => {
    const request = functionBody(sql, "public.request_email_verification")
    expect(request).toContain("v_site || '/verify-email?token=' || v_raw")
  })

  it("reset (the hook): <Vault site_url>/reset-password?token_hash=<token_hash>", () => {
    const fixes = read(FIXES)
    const start = fixes.indexOf(
      "create or replace function public.send_email_hook("
    )
    expect(start).toBeGreaterThanOrEqual(0)
    const hook = fixes.slice(start, fixes.indexOf("\n$;", start))
    expect(hook).toContain(
      "v_site || '/reset-password?token_hash=' || v_token_hash"
    )
    expect(hook).toContain("where s.name = 'site_url'")
    // Never Auth's site_url (its API address), redirect_to or plain token.
    expect(hook).not.toContain("->> 'site_url'")
    expect(hook).not.toContain("redirect_to")
    expect(hook).not.toContain("'token'")
  })
})
