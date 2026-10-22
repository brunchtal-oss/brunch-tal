import { describe, expect, it } from "vitest"

import {
  PROTECTED_SQL,
  PROTECTION_CHECKS,
  SETS,
  STEPS,
  bind,
  isProtectedEmail,
  isTestName,
  namesIn,
} from "../scripts/dev-clean-test-data-plan.mjs"

// Story 5.20 (fix 8): the selection and protection rules of
// scripts/dev-clean-test-data.mjs.

const setNames = SETS.map(([name]) => name)
const order = STEPS.map((step) => step.table)
const before = (child: string, parent: string) =>
  expect(order.indexOf(child), `${child} before ${parent}`).toBeLessThan(
    order.indexOf(parent)
  )

describe("what counts as test data and what is protected", () => {
  it("only the test_ prefix the db tests write", () => {
    expect(isTestName("test_ab12cd34ef56_alice")).toBe(true)
    expect(isTestName("test_")).toBe(true)
    expect(isTestName("Test_x")).toBe(false)
    expect(isTestName("testing")).toBe(false)
    expect(isTestName("נועה בדויה")).toBe(false)
    expect(isTestName(null)).toBe(false)
  })

  it("the dev accounts and every demo customer are protected", () => {
    expect(isProtectedEmail("dev-customer@example.com")).toBe(true)
    expect(isProtectedEmail(" DEV-ADMIN@example.com ")).toBe(true)
    expect(isProtectedEmail("maya.barak@demo.example.com")).toBe(true)
    expect(isProtectedEmail("someone@demo.example.com")).toBe(true)
    expect(isProtectedEmail("test_x_a@example.test")).toBe(false)
    expect(isProtectedEmail("x@notdemo.example.com")).toBe(false)
  })
})

describe("the plan", () => {
  it("every set reads only sets defined above it", () => {
    SETS.forEach(([name, sql], index) => {
      for (const used of namesIn(sql)) {
        expect(setNames.slice(0, index), `${name} uses ${used}`).toContain(used)
      }
    })
  })

  it("the roots are the test_ prefix only", () => {
    const roots = Object.fromEntries(SETS)
    for (const name of ["U", "PROD", "PM", "CON"]) {
      expect(roots[name]).toContain("like 'test\\_%'")
    }
    expect(roots.P).toContain("full_name like 'test\\_%'")
    expect(roots.E).toContain("description like 'test\\_%'")
  })

  it("every delete is limited to a computed set (never a whole table)", () => {
    for (const step of STEPS) {
      const names = namesIn(step.where)
      expect(names.length, step.table).toBeGreaterThan(0)
      for (const name of names) expect(setNames, step.table).toContain(name)
    }
    for (const [label, sql] of PROTECTION_CHECKS) {
      const names = namesIn(sql)
      expect(names.includes("PROT") || names.includes("P"), label).toBe(true)
    }
  })

  it("a non-test customer's rows tied to test data stop the run", () => {
    const checks = (PROTECTION_CHECKS as [string, string][]).map(
      ([, sql]) => sql
    )
    for (const [table, set] of [
      ["public.bookings", "BOOK"],
      ["public.entitlements", "ENT"],
      ["public.cancellation_credits", "CRED"],
      ["public.payments", "PAY"],
    ]) {
      const sql = checks.find(
        (s) =>
          s.includes(`from ${table} `) &&
          s.includes("customer_id is not null") &&
          s.includes("not (")
      )
      expect(sql, table).toBeDefined()
      expect(namesIn(sql!), table).toEqual([set, "P"])
    }
  })

  it("children go before their parents (foreign keys)", () => {
    before("public.notification_deliveries", "public.notification_jobs")
    before("public.notification_jobs", "public.notifications")
    before("public.refund_requests", "public.cancellation_credits")
    before("public.credit_options", "public.cancellation_credits")
    before("public.booking_allocations", "public.bookings")
    before("public.booking_allocations", "public.cancellation_credits")
    before("public.entitlement_movements", "public.entitlements")
    before(
      "public.entitlement_correction_bookings",
      "public.entitlement_corrections"
    )
    before("public.entitlement_corrections", "public.entitlements")
    before("public.cancellation_credits", "public.bookings")
    before("public.bookings", "public.payments")
    before("public.entitlements", "public.payments")
    before("public.activation_tokens", "public.payments")
    before("public.bookings", "public.events")
    before("public.work_tasks", "public.work_dishes")
    before("public.work_dishes", "public.work_sheets")
    before("public.event_products", "public.products")
    before("public.payments", "public.products")
    before("public.payments", "public.payment_methods")
    before("public.events", "public.concepts")
    before("public.babies", "public.profiles")
    before("public.audit_log", "public.profiles")
    before("public.profiles", "auth.users")
    // The append-only trigger is off for that delete only.
    expect(STEPS.filter((s) => s.replica).map((s) => s.table)).toEqual([
      "public.entitlement_movements",
    ])
  })

  it("bind numbers each set once and casts uuid sets", () => {
    const bound = bind("x = any($P) or y = any($P) or z = any($E)", {
      P: ["a"],
      E: [],
    })
    expect(bound.text).toBe(
      "x = any($1::uuid[]) or y = any($1::uuid[]) or z = any($2::uuid[])"
    )
    expect(bound.values).toEqual([["a"], []])
    expect(() => bind("$NOPE", {})).toThrow("unknown set NOPE")
    const prot = bind(PROTECTED_SQL, {
      EMAILS: ["a@b"],
      DOMAIN: "demo.example.com",
      NAMES: ["n"],
    })
    expect(prot.text).toContain("$1::text[]")
    expect(prot.text).not.toContain("$1::uuid[]")
  })
})
