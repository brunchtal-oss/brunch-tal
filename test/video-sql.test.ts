import { describe, expect, it } from "vitest"

import {
  COUNT_TABLES,
  adminRoleSql,
  countsSql,
  dateLiteral,
  deleteSql,
  directWritesSql,
  guardSql,
  momentLiteral,
  uuidArray,
  uuidLiteral,
  warningsSql,
  worldSetSql,
} from "../scripts/video-sql.mjs"

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const input = () => ({
  filmingAdminId: id(1),
  history: [
    { eventId: id(2), realDate: "2026-10-08", tempDate: "2026-10-29" },
    { eventId: id(3), realDate: "2026-06-22", tempDate: "2026-10-26" },
  ],
  historyBookings: [{ bookingId: id(4), at: "2026-10-05 10:00" }],
  payments: [
    {
      paymentId: id(5),
      at: "2026-10-01 11:00",
      boundAt: "2026-10-01 12:30",
      notifyAt: "2026-10-01 12:30",
    },
  ],
  joins: [{ customerId: id(6), paymentId: id(5), at: "2026-10-01 12:30" }],
  events: [{ eventId: id(2), createdAt: "2026-09-17 10:00" }],
  expiredLinks: [id(7)],
  marketingSlot: "2026-10-22 20:00",
})

const indexOf = (list: string[], needle: string) =>
  list.findIndex((s) => s.includes(needle))

describe("literals", () => {
  it("validates every id, date and moment", () => {
    expect(uuidLiteral(id(1))).toBe(`'${id(1)}'::uuid`)
    expect(uuidArray([id(1), id(2)])).toBe(`'{${id(1)},${id(2)}}'::uuid[]`)
    expect(() => uuidLiteral("x'; drop table events; --")).toThrow(
      "unexpected id"
    )
    expect(() => uuidArray([id(1), "nope"])).toThrow("unexpected id")
    expect(dateLiteral("2026-10-08")).toBe("date '2026-10-08'")
    expect(() => dateLiteral("2026-13-01")).toThrow()
    expect(momentLiteral("2026-10-01 11:00")).toContain(
      "at time zone 'Asia/Jerusalem'"
    )
    // Never after now().
    expect(momentLiteral("2026-10-01 11:00")).toMatch(/^least\(.*now\(\)\)$/)
    expect(() => momentLiteral("2026-10-01 11:00'); --")).toThrow()
  })

  it("DW1 inserts the filming admin's role once", () => {
    expect(adminRoleSql(id(1))).toBe(
      `insert into public.admin_roles (user_id) values ('${id(1)}'::uuid) on conflict (user_id) do nothing;`
    )
    expect(() => adminRoleSql("x")).toThrow()
  })
})

describe("directWritesSql (DW2–DW5)", () => {
  it("shifts history, then completes, then backdates, then runs the jobs", () => {
    const sql = directWritesSql(input())
    const shift = indexOf(sql, "update public.events e set starts_at")
    const pinned = indexOf(sql, "update public.entitlements en set expires_on")
    const notes = indexOf(sql, "delete from public.notifications n")
    const complete = sql.indexOf("select private.job_complete_events();")
    const backdate = indexOf(sql, "update public.payments p set created_at")
    const completeAudit = indexOf(sql, "a.action = 'complete_event'")
    const expired = indexOf(sql, "interval '48 hours'")
    const expiry = sql.indexOf("select private.job_expiry_alerts();")
    const credits = sql.indexOf("select private.job_refresh_credit_options();")
    const marketing = indexOf(sql, "'marketing_reminder'")
    for (const i of [
      shift,
      pinned,
      notes,
      complete,
      backdate,
      completeAudit,
      expired,
      expiry,
      credits,
      marketing,
    ]) {
      expect(i).toBeGreaterThanOrEqual(0)
    }
    expect(shift).toBeLessThan(complete)
    expect(pinned).toBeLessThan(complete)
    expect(notes).toBeLessThan(complete)
    expect(complete).toBeLessThan(backdate)
    // The completion is asserted right after the job, in the transaction.
    expect(sql[complete + 1]).toContain(
      "raise exception 'history sessions not completed'"
    )
    expect(complete).toBeLessThan(completeAudit)
    expect(backdate).toBeLessThan(expired)
    expect(expired).toBeLessThan(expiry)
    expect(expiry).toBeLessThan(marketing)
  })

  it("matches a shifted session by its temporary date (safe to replay)", () => {
    const sql = directWritesSql(input())
    const shift = sql.filter((s) =>
      s.startsWith("update public.events e set starts_at")
    )
    expect(shift).toHaveLength(2)
    expect(shift[0]).toContain("private.local_instant(date '2026-10-08'")
    expect(shift[0]).toContain("= date '2026-10-29'")
    const pinned = sql.filter((s) => s.includes("set expires_on"))
    expect(pinned[1]).toContain("en.expires_on = date '2026-10-26'")
  })

  it("updates entitlement_movements only inside the replica window", () => {
    const sql = directWritesSql(input())
    const on = sql.indexOf("set local session_replication_role = replica;")
    const off = sql.indexOf("set local session_replication_role = origin;")
    expect(on).toBeGreaterThanOrEqual(0)
    expect(off).toBeGreaterThan(on)
    expect(
      sql.filter((s) => s.includes("session_replication_role"))
    ).toHaveLength(2)
    sql.forEach((s, i) => {
      const inside = i > on && i < off
      expect(s.includes("public.entitlement_movements")).toBe(inside)
    })
  })

  it("sends the marketing reminder to the filming admin only, with a valid slot", () => {
    const sql = directWritesSql(input())
    const marketing = sql.find((s) => s.includes("'marketing_reminder'"))!
    expect(marketing).toContain(`private.enqueue_notification('${id(1)}'::uuid`)
    expect(marketing).toContain("'2026-10-22 20:00'")
    expect(
      directWritesSql({ ...input(), marketingSlot: null }).some((s) =>
        s.includes("marketing_reminder")
      )
    ).toBe(false)
    expect(() =>
      directWritesSql({ ...input(), marketingSlot: "2026-10-22'; --" })
    ).toThrow()
  })

  it("refuses an invalid id anywhere", () => {
    expect(() =>
      directWritesSql({ ...input(), expiredLinks: ["not-a-uuid"] })
    ).toThrow("unexpected id")
    expect(() =>
      directWritesSql({
        ...input(),
        historyBookings: [{ bookingId: id(4), at: "yesterday" }],
      })
    ).toThrow()
  })

  it("writes nothing for empty lists but still runs the jobs", () => {
    const sql = directWritesSql({
      ...input(),
      history: [],
      historyBookings: [],
      payments: [],
      joins: [],
      events: [],
      expiredLinks: [],
      marketingSlot: null,
    })
    expect(sql).toEqual([
      "select private.job_complete_events();",
      "select private.job_expiry_alerts();",
      "select private.job_refresh_credit_options();",
    ])
  })
})

describe("the world set of video-clear", () => {
  const set = worldSetSql({
    adminEmail: "admin@video.example.com",
    domain: "video.example.com",
  })
  const position = (name: string) =>
    set.findIndex((s) => s.startsWith(`create temp table ${name} `))

  it("builds every temp table after the ones it reads", () => {
    for (const s of set)
      expect(s).toMatch(/^create temp table w_\w+ on commit drop as /)
    expect(position("w_admin")).toBe(0)
    expect(position("w_users")).toBeLessThan(position("w_profiles"))
    expect(position("w_events")).toBeLessThan(position("w_payments"))
    expect(position("w_payments")).toBeLessThan(position("w_bookings"))
    expect(position("w_tokens")).toBeLessThan(position("w_ids"))
    expect(position("w_credits")).toBeLessThan(position("w_ids"))
    expect(position("w_ids")).toBeLessThan(position("w_notifications"))
    expect(position("w_notifications")).toBeLessThan(position("w_jobs"))
    expect(position("w_notes")).toBeLessThan(position("w_audit"))
    expect(position("w_tokens")).toBeLessThan(position("w_idempotency"))
  })

  it("finds the world by the domain, the filming admin and its sessions", () => {
    expect(set[0]).toContain("lower(u.email) = 'admin@video.example.com'")
    expect(set[1]).toContain("like '%@video.example.com'")
    const events = set[position("w_events")]
    expect(events).toContain("'admin_create_event', 'admin_duplicate_event'")
    expect(events).toContain("a.actor_id in (select id from w_admin)")
    const notes = set[position("w_notes")]
    expect(notes).toContain("r.rpc = 'admin_add_note'")
    expect(notes).toContain("r.result ->> 'note_id'")
  })

  it("refuses a malformed email or domain", () => {
    expect(() =>
      worldSetSql({ adminEmail: "x'; --@a", domain: "video.example.com" })
    ).toThrow()
    expect(() =>
      worldSetSql({ adminEmail: "admin@video.example.com", domain: "a'b" })
    ).toThrow()
  })

  it("guards dev accounts, test rows and every foreign row", () => {
    const guard = guardSql({ domain: "video.example.com" })
    for (const reason of [
      "dev_account",
      "test_row",
      "foreign_booking",
      "foreign_waitlist",
      "foreign_credit_option",
      "foreign_correction",
      "foreign_customer",
      "foreign_join_user",
    ]) {
      expect(guard).toContain(`'${reason}'`)
    }
    // w_notes is traced by construction (D10): no note guard.
    expect(guard).not.toContain("untraced_note")
    // Every profile of the set, not only payment customers.
    expect(guard).toContain(
      "from public.profiles p where p.id in (select id from w_profiles) and p.anonymized_at is null"
    )
    expect(guard).toContain("u.id in (tk.pending_user_id, tk.bound_user_id)")
    expect(guard).toContain(
      "'dev-admin@example.com', 'dev-customer@example.com'"
    )
    expect(guard).toContain("p.anonymized_at is null")
    expect(guard).toContain("b.customer_id not in (select id from w_profiles)")
    expect(guard).toContain("ilike 'test\\_%'")
    expect(warningsSql()).toContain("public.media_assets")
    // Each old note is listed with its id, time and text.
    expect(warningsSql()).toContain(
      "'old_note', 1, n.id::text, n.created_at, left(n.body, 60)"
    )
  })

  it("counts every table it deletes", () => {
    const counts = countsSql()
    for (const [label] of COUNT_TABLES)
      expect(counts).toContain(`'${label}', (`)
  })
})

describe("deleteSql", () => {
  const sql = deleteSql()
  const at = (table: string) =>
    sql.findIndex((s) => s.startsWith(`delete from ${table} `))

  it("deletes every counted table", () => {
    for (const [label] of COUNT_TABLES) {
      const table = label.includes(".")
        ? label
        : label === "idempotency_results"
          ? "private.idempotency_results"
          : `public.${label}`
      expect(at(table)).toBeGreaterThanOrEqual(0)
    }
  })

  it("keeps foreign-key order", () => {
    const before = (a: string, b: string) => expect(at(a)).toBeLessThan(at(b))
    before("public.notification_deliveries", "public.notification_jobs")
    before("public.notification_jobs", "public.notifications")
    before("public.refund_requests", "public.cancellation_credits")
    before("public.credit_options", "public.cancellation_credits")
    before(
      "public.entitlement_correction_bookings",
      "public.entitlement_corrections"
    )
    before("public.entitlement_movements", "public.entitlements")
    before("public.entitlement_movements", "public.bookings")
    before("public.booking_allocations", "public.cancellation_credits")
    before("public.cancellation_credits", "public.bookings")
    before("public.waitlist_entries", "public.profiles")
    before("public.bookings", "public.entitlements")
    before("public.entitlements", "public.payments")
    before("public.activation_tokens", "public.payments")
    before("public.bookings", "public.events")
    before("public.entitlement_corrections", "public.events")
    before("public.work_tasks", "public.work_dishes")
    before("public.work_dishes", "public.work_sheets")
    before("public.work_sheets", "public.events")
    before("public.audit_log", "public.profiles")
    before("public.payments", "public.profiles")
    before("public.profiles", "auth.users")
    // The filming admin's role (no FK to auth.users) goes too.
    before("public.admin_roles", "auth.users")
    expect(sql[at("public.admin_roles")]).toBe(
      "delete from public.admin_roles where user_id in (select id from w_admin);"
    )
    expect(sql.at(-1)).toBe(
      "delete from auth.users where id in (select id from w_users);"
    )
  })

  it("clears moved-booking links before deleting bookings", () => {
    const unlink = sql.findIndex((s) =>
      s.includes("set moved_to_booking_id = null")
    )
    expect(unlink).toBeGreaterThanOrEqual(0)
    expect(unlink).toBeLessThan(at("public.bookings"))
  })

  it("opens the replica window only around entitlement_movements", () => {
    const on = sql.indexOf("set local session_replication_role = replica;")
    const off = sql.indexOf("set local session_replication_role = origin;")
    expect(off - on).toBe(2)
    expect(sql[on + 1]).toContain("public.entitlement_movements")
    expect(
      sql.filter((s) => s.includes("session_replication_role"))
    ).toHaveLength(2)
  })

  it("deletes audit_log rows instead of nulling them", () => {
    expect(at("public.audit_log")).toBeGreaterThanOrEqual(0)
    expect(sql.some((s) => s.includes("update public.audit_log"))).toBe(false)
  })
})
