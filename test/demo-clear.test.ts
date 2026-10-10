import { describe, expect, it } from "vitest"

import { ADMIN_EMAIL, buildClearSql } from "../scripts/demo-clear-sql.mjs"

const LISTS = [
  "jobs",
  "notifications",
  "subscriptions",
  "movements",
  "allocations",
  "bookings",
  "entitlements",
  "tokens",
  "payments",
  "shopping",
  "tasks",
  "dishes",
  "sheets",
  "events",
  "notes",
  "babies",
  "audit",
  "customers",
  "users",
] as const

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ADMIN = uuid(99)
const NOW = "2026-10-10T09:00:00.000Z"

// One id per list (list i gets uuid(i + 1)), and a second Auth user.
function fixture(): Record<string, string[]> {
  const ids: Record<string, string[]> = Object.fromEntries(
    LISTS.map((name, i) => [name, [uuid(i + 1)]])
  )
  ids.users.push(uuid(20))
  ids.admins = [ADMIN]
  return ids
}

// Built once from the code of demo-clear.mjs before the extraction (story
// 5.19), with the same ids and the same timestamp. It must not change.
const EXPECTED = `-- Demo data removal, prepared by scripts/demo-clear.mjs
-- on 2026-10-10T09:00:00.000Z. Review it, then run it in the SQL Editor
-- of the DEV project (a new, empty query). One transaction.

begin;

-- Guard: only the dev project has the dev admin.
do $guard$
begin
  if not exists (
    select 1 from auth.users where lower(email) = 'dev-admin@example.com'
  ) then
    raise exception 'not the dev project: dev-admin@example.com is missing';
  end if;
end
$guard$;

delete from public.notification_deliveries where job_id = any('{00000000-0000-4000-8000-000000000001}'::uuid[]);
delete from public.notification_jobs where id = any('{00000000-0000-4000-8000-000000000001}'::uuid[]);
delete from public.notifications where id = any('{00000000-0000-4000-8000-000000000002}'::uuid[]);
delete from public.push_subscriptions where id = any('{00000000-0000-4000-8000-000000000003}'::uuid[]);

-- entitlement_movements is append-only (a trigger); off for this delete only.
set local session_replication_role = replica;
delete from public.entitlement_movements where id = any('{00000000-0000-4000-8000-000000000004}'::uuid[]);
set local session_replication_role = origin;

delete from public.booking_allocations where id = any('{00000000-0000-4000-8000-000000000005}'::uuid[]);
delete from public.bookings where id = any('{00000000-0000-4000-8000-000000000006}'::uuid[]);
delete from public.entitlements where id = any('{00000000-0000-4000-8000-000000000007}'::uuid[]);
delete from public.activation_tokens where id = any('{00000000-0000-4000-8000-000000000008}'::uuid[]);
delete from public.payments where id = any('{00000000-0000-4000-8000-000000000009}'::uuid[]);
delete from public.shopping_items where id = any('{00000000-0000-4000-8000-000000000010}'::uuid[]);
delete from public.work_tasks where id = any('{00000000-0000-4000-8000-000000000011}'::uuid[]);
delete from public.work_dishes where id = any('{00000000-0000-4000-8000-000000000012}'::uuid[]);
delete from public.work_sheets where id = any('{00000000-0000-4000-8000-000000000013}'::uuid[]);
delete from public.events where id = any('{00000000-0000-4000-8000-000000000014}'::uuid[]);
delete from public.customer_notes where id = any('{00000000-0000-4000-8000-000000000015}'::uuid[]);
delete from public.babies where id = any('{00000000-0000-4000-8000-000000000016}'::uuid[]);

-- audit_log stays; its rows only stop pointing at the removed profiles.
update public.audit_log set customer_id = null where id = any('{00000000-0000-4000-8000-000000000017}'::uuid[]);
delete from public.profiles where id = any('{00000000-0000-4000-8000-000000000018}'::uuid[]);
delete from auth.users where id = any('{00000000-0000-4000-8000-000000000019,00000000-0000-4000-8000-000000000020}'::uuid[]);

commit;
`

describe("buildClearSql", () => {
  it("is the same SQL as before the extraction", () => {
    expect(buildClearSql(fixture(), "demo", NOW)).toBe(EXPECTED)
  })

  it("keeps the order: guard, deletes, audit_log, profiles, auth.users", () => {
    const lines = buildClearSql(fixture(), "demo", NOW).split("\n")
    const at = (text: string) => lines.findIndex((line) => line.includes(text))
    const guard = at(`lower(email) = '${ADMIN_EMAIL}'`)
    const firstDelete = lines.findIndex((line) => line.startsWith("delete "))
    expect(lines.indexOf("begin;")).toBeLessThan(guard)
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(firstDelete)
    expect(at("update public.audit_log")).toBeLessThan(
      at("delete from public.profiles")
    )
    expect(at("delete from public.profiles")).toBeLessThan(
      at("delete from auth.users")
    )
    expect(at("delete from auth.users")).toBeLessThan(lines.indexOf("commit;"))
  })

  it("turns replica on just before entitlement_movements and origin just after", () => {
    const lines = buildClearSql(fixture(), "demo", NOW).split("\n")
    const replica = lines.filter((line) => line.includes("= replica"))
    const origin = lines.filter((line) => line.includes("= origin"))
    expect(replica).toHaveLength(1)
    expect(origin).toHaveLength(1)
    const movements = lines.findIndex((line) =>
      line.includes("public.entitlement_movements ")
    )
    expect(lines[movements - 1]).toBe(
      "set local session_replication_role = replica;"
    )
    expect(lines[movements + 1]).toBe(
      "set local session_replication_role = origin;"
    )
  })

  it("names the mode only in the header line", () => {
    const demo = buildClearSql(fixture(), "demo", NOW)
    const devTest = buildClearSql(fixture(), "dev-test-data", NOW)
    expect(devTest.split("\n")[0]).toBe(
      "-- Dev test data removal, prepared by scripts/demo-clear.mjs"
    )
    expect(devTest.split("\n").slice(1)).toEqual(demo.split("\n").slice(1))
  })

  it("writes a comment instead of a delete for an empty list", () => {
    const ids = fixture()
    for (const name of LISTS) ids[name] = []
    const sql = buildClearSql(ids, "demo", NOW)
    expect(sql).not.toMatch(/^delete /m)
    expect(sql).not.toMatch(/^update /m)
    expect(sql).toContain("-- public.notification_deliveries: nothing")
    expect(sql).toContain("-- public.entitlement_movements: nothing")
    expect(sql).toContain("-- public.audit_log: nothing")
    expect(sql).toContain("-- auth.users: nothing")
    // The guard and the transaction stay.
    expect(sql).toContain("raise exception")
    expect(sql).toContain("commit;")
  })

  it("refuses an admin in any delete list", () => {
    for (const name of LISTS) {
      const ids = fixture()
      ids[name] = [...ids[name], ADMIN]
      expect(() => buildClearSql(ids, "demo", NOW)).toThrow(
        "מזהה של אדמין ברשימת המחיקה. לא נכתב קובץ."
      )
    }
  })

  it("refuses a missing list, admins included", () => {
    for (const name of [...LISTS, "admins"]) {
      const ids = fixture()
      delete ids[name]
      expect(() => buildClearSql(ids, "demo", NOW)).toThrow(
        `חסרה הרשימה ${name}. לא נכתב קובץ.`
      )
    }
  })

  it("refuses an id that is not a uuid", () => {
    const ids = fixture()
    ids.bookings = ["1; drop table public.payments"]
    expect(() => buildClearSql(ids, "demo", NOW)).toThrow("unexpected id")
  })
})
