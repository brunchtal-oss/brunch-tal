// Story 5.16: the public session pages read events as anon with
// PUBLIC_SESSION_COLUMNS only. As anon, the same selection (built from the
// constant) is allowed by the grants, never returns a draft or a cancelled
// session, and returns exactly those keys. Everything runs in inRollback.

import { describe, expect, it } from "vitest"

import { PUBLIC_SESSION_COLUMNS } from "@/lib/sessions/public"

import { inRollback, testName, type Db } from "./support/db"

// Splits a PostgREST select list on its top-level commas.
function topLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const char of list) {
    if (char === "(") depth++
    if (char === ")") depth--
    if (char === "," && depth === 0) {
      parts.push(current.trim())
      current = ""
    } else current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

// The column an image embed (story 5.4) follows, by its foreign key.
const IMAGE_FKS: Record<string, string> = {
  events_image_id_fkey: "e.image_id",
  concepts_default_image_id_fkey: "c.default_image_id",
}

// One select item as SQL: a column of `table`, or an image embed
// (alias:media_assets!fk(cols)) as a json subselect, read as anon so RLS
// on media_assets applies.
function itemSql(item: string, table: string): { key: string; sql: string } {
  const image = /^(\w+):media_assets!(\w+)\(([^)]*)\)$/.exec(item)
  if (image) {
    const [, alias, fk, cols] = image
    const fields = cols
      .split(",")
      .map((c) => `'${c.trim()}', m.${c.trim()}`)
      .join(", ")
    return {
      key: alias,
      sql: `(select json_build_object(${fields}) from public.media_assets m where m.id = ${IMAGE_FKS[fk]})`,
    }
  }
  return { key: item, sql: `${table}.${item}` }
}

// PUBLIC_SESSION_COLUMNS as SQL: the event's own columns, its image, and the
// embedded concept as a json object with its listed columns (and image).
function selectionSql(): {
  sql: string
  keys: string[]
  conceptKeys: string[]
} {
  const keys: string[] = []
  let conceptKeys: string[] = []
  const columns = topLevel(PUBLIC_SESSION_COLUMNS).map((item) => {
    const concept = /^concepts\((.*)\)$/.exec(item)
    if (concept) {
      const inner = topLevel(concept[1]).map((sub) => itemSql(sub, "c"))
      conceptKeys = inner.map((sub) => sub.key)
      keys.push("concepts")
      return `json_build_object(${inner
        .map((sub) => `'${sub.key}', ${sub.sql}`)
        .join(", ")}) as concepts`
    }
    const own = itemSql(item, "e")
    keys.push(own.key)
    return `${own.sql} as ${own.key}`
  })
  if (!keys.includes("concepts")) {
    throw new Error("PUBLIC_SESSION_COLUMNS embeds no concept")
  }
  return {
    sql: `select ${columns.join(", ")}
          from public.events e join public.concepts c on c.id = e.concept_id
          where e.id = any($1::uuid[])`,
    keys,
    conceptKeys,
  }
}

// As the owner: a session of the mothers concept with this status, 7 days
// ahead (or 7 days ago when past), registration closing a day before it.
async function insertEvent(
  db: Db,
  status: string,
  past = false
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.events (
       concept_id, kind, description, starts_at, ends_at, capacity_adults,
       registration_closes_at, status)
     select c.id, 'regular', $1, now() + $3::interval,
       now() + $3::interval + interval '2 hours', 12,
       now() + $3::interval - interval '1 day', $2
     from public.concepts c where c.theme_key = 'mothers' limit 1
     returning id`,
    [
      testName(`public_${status}${past ? "_past" : ""}`),
      status,
      past ? "-7 days" : "7 days",
    ]
  )
  return rows[0].id
}

describe("public session columns as anon", () => {
  it("returns only published sessions, with exactly the public keys", async () => {
    await inRollback(async (db) => {
      const published = await insertEvent(db, "published")
      const draft = await insertEvent(db, "draft")
      const cancelled = await insertEvent(db, "cancelled")
      const past = await insertEvent(db, "published", true)
      const { sql, keys, conceptKeys } = selectionSql()

      await db.query("set local role anon")
      // RLS alone already hides the draft from anon.
      const { rows: visible } = await db.query<{ id: string }>(
        "select id from public.events where id = any($1::uuid[])",
        [[published, draft, cancelled, past]]
      )
      expect(visible.map((row) => row.id)).not.toContain(draft)
      // A past published session passes RLS; only the pages' filter drops it.
      expect(visible.map((row) => row.id)).toContain(past)

      // The pages' filter (published, not started) on top of RLS.
      const { rows } = await db.query(
        `${sql} and e.status = 'published' and e.starts_at > now()
         order by e.starts_at, e.id`,
        [[published, draft, cancelled, past]]
      )
      expect(rows.map((row) => row.id)).toEqual([published])
      expect(Object.keys(rows[0]).sort()).toEqual([...keys].sort())
      expect(Object.keys(rows[0].concepts).sort()).toEqual(
        [...conceptKeys].sort()
      )
      expect(rows[0].description).toBe(testName("public_published"))
      for (const key of keys) {
        expect(key).not.toMatch(/capacity|kind|status/)
      }
    })
  })
})
