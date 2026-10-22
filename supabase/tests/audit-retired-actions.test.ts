// Story 5.20 (fix 6): an action retired from the audit log is written by no
// live function. Old migration files still contain the calls, so
// lib/copy/audit-actions.test.ts counts them as decided; this file checks
// the live bodies (pg_proc) instead.

import { describe, expect, it } from "vitest"

import { RETIRED_AUDIT_ACTIONS } from "@/lib/copy/retired-audit-actions"

import { sql } from "./support/db"

describe("retired audit actions", () => {
  it("no live function body calls private.audit with a retired action", async () => {
    const rows = await sql<{ fn: string; src: string }>(
      `select n.nspname || '.' || p.proname as fn, p.prosrc as src
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and p.prosrc like '%private.audit(%'`
    )
    expect(rows.length).toBeGreaterThan(20)
    const found: string[] = []
    for (const { fn, src } of rows) {
      for (const match of src.matchAll(
        /private\.audit\(\s*[^,()]+,\s*[^,()]+,\s*'([a-z_]+)'/g
      )) {
        if (RETIRED_AUDIT_ACTIONS.includes(match[1])) {
          found.push(`${fn}: ${match[1]}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  it("the formerly hidden writers still exist (only their audit call went)", async () => {
    const rows = await sql<{ name: string }>(
      `select p.proname as name
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname, p.proname) in (
         ('public', 'admin_add_note'),
         ('public', 'admin_add_work_task'),
         ('public', 'admin_approve_payment'),
         ('public', 'join_begin'),
         ('public', 'claim_join'),
         ('private', 'hide_unused_media')
       )`
    )
    expect(rows.map((r) => r.name).sort()).toEqual([
      "admin_add_note",
      "admin_add_work_task",
      "admin_approve_payment",
      "claim_join",
      "hide_unused_media",
      "join_begin",
    ])
  })
})
