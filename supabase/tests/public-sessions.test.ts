// Story 5.16: the public session pages read events as anon with
// PUBLIC_SESSION_COLUMNS only. As anon, the same selection (built from the
// constant) is allowed by the grants, never returns a draft or a cancelled
// session, and returns exactly those keys. Everything runs in inRollback.

import { describe, expect, it } from "vitest"

import { PUBLIC_SESSION_COLUMNS } from "@/lib/sessions/public"

import { inRollback, testName, type Db } from "./support/db"

// PUBLIC_SESSION_COLUMNS as SQL: the event's own columns, and the embedded
// concept as a json object with its listed columns.
function selectionSql(): {
  sql: string
  keys: string[]
  conceptKeys: string[]
} {
  const embed = /concepts\(([^)]*)\)/.exec(PUBLIC_SESSION_COLUMNS)
  if (!embed) throw new Error("PUBLIC_SESSION_COLUMNS embeds no concept")
  const conceptKeys = embed[1].split(",").map((c) => c.trim())
  const keys = PUBLIC_SESSION_COLUMNS.replace(embed[0], "concepts")
    .split(",")
    .map((c) => c.trim())
  const columns = keys.map((key) =>
    key === "concepts"
      ? `json_build_object(${conceptKeys
          .map((c) => `'${c}', c.${c}`)
          .join(", ")}) as concepts`
      : `e.${key}`
  )
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
