import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

// Online payments, PR B: the purchase-terms page is seeded unpublished and
// empty (its wording is Tal's, 6.4; no purchase until she publishes it).
// Read from the migration, since dev may hold a published test text during
// the sandbox run.
describe("the purchase-terms seed", () => {
  const dir = join(process.cwd(), "supabase", "migrations")
  const file = readdirSync(dir).find((name) =>
    name.endsWith("_online_payments_screens.sql")
  )
  const sql = readFileSync(join(dir, file!), "utf8")

  it("the page and its section carry no content and no publish", () => {
    expect(sql).toContain(
      "insert into public.content_pages (slug)\nvalues ('purchase-terms')"
    )
    expect(sql).toContain(
      "insert into public.content_sections (page_slug, key, kind, sort_order)\nvalues ('purchase-terms', 'body', 'legal_text', 1)"
    )
    // Neither statement publishes or fills anything.
    const statements = sql
      .split(";")
      .filter(
        (statement) =>
          /insert into public\.content_(pages|sections)/.test(statement) &&
          statement.includes("('purchase-terms'")
      )
    expect(statements).toHaveLength(2)
    for (const statement of statements) {
      expect(statement).not.toMatch(/published|draft_content/)
    }
  })
})
