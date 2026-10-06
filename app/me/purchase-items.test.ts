import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import {
  byPaidOnDesc,
  entitlementName,
  isEmptyHome,
  isHomeCard,
  isHomeReturned,
  isOpen,
  parseMyEntitlements,
  pastStatus,
  type MyEntitlement,
} from "./purchase-items"

// A row of get_my_entitlements as the RPC returns it (Design Notes).
const rpcRow = (overrides: Record<string, unknown> = {}) => ({
  entitlement_id: "ent-1",
  kind: "card",
  status: "active",
  product_name: "Card at purchase",
  amount_agorot: 47200,
  paid_on: "2026-09-23",
  original_units: 4,
  available: 4,
  reserved: 0,
  used: 0,
  expires_on: "2026-11-11",
  is_expired: false,
  expired_before_bound: false,
  days_left: 30,
  is_expiring: false,
  is_used_up: false,
  validity_days: 49,
  pinned_event_id: null,
  payment_id: "pay-1",
  ...overrides,
})

const entitlement = (overrides: Record<string, unknown> = {}): MyEntitlement =>
  parseMyEntitlements([rpcRow(overrides)])[0]

describe("parseMyEntitlements", () => {
  it("maps the RPC row to camelCase", () => {
    expect(parseMyEntitlements([rpcRow()])).toEqual([
      {
        id: "ent-1",
        kind: "card",
        status: "active",
        productName: "Card at purchase",
        amountAgorot: 47200,
        paidOn: "2026-09-23",
        originalUnits: 4,
        available: 4,
        reserved: 0,
        used: 0,
        expiresOn: "2026-11-11",
        isExpired: false,
        expiredBeforeBound: false,
        daysLeft: 30,
        isExpiring: false,
        isUsedUp: false,
        validityDays: 49,
        pinnedEventId: null,
        paymentId: "pay-1",
        returned: false,
        awaitingSessions: false,
      },
    ])
  })

  it.each([
    ["no id", { entitlement_id: null }],
    ["an unknown kind", { kind: "other" }],
    ["no expiry", { expires_on: null }],
    ["a fractional amount", { amount_agorot: 1.5 }],
  ])("leaves out a row with %s", (_label, change) => {
    expect(parseMyEntitlements([rpcRow(change)])).toEqual([])
  })

  it("is empty for anything but an array", () => {
    expect(parseMyEntitlements(null)).toEqual([])
    expect(parseMyEntitlements({})).toEqual([])
  })

  it("has no validity days without a positive number", () => {
    expect(entitlement({ validity_days: null }).validityDays).toBeNull()
    expect(entitlement({ validity_days: 0 }).validityDays).toBeNull()
  })
})

describe("isOpen and pastStatus", () => {
  it.each([
    ["an active card", {}, true, null],
    [
      "a card that expired before it was bound",
      { is_expired: true, expired_before_bound: true },
      true,
      customerCopy.entitlementExpired,
    ],
    [
      "an expired card",
      { is_expired: true },
      false,
      customerCopy.entitlementExpired,
    ],
    [
      "a used up card",
      { available: 0, reserved: 0, used: 4, is_used_up: true },
      false,
      customerCopy.entitlementUsedUp,
    ],
    [
      "a refunded one",
      { status: "refunded" },
      false,
      customerCopy.entitlementCancelled,
    ],
    [
      "a revoked one, even if not expired",
      { status: "revoked" },
      false,
      customerCopy.entitlementCancelled,
    ],
  ])("%s", (_label, change, open, past) => {
    const e = entitlement(change)
    expect(isOpen(e)).toBe(open)
    expect(pastStatus(e)).toBe(past)
  })
})

describe("entitlementName", () => {
  it("names a pinned purchase by its concept, else by the product", () => {
    const names = new Map([["ev-1", "Mothers"]])
    expect(
      entitlementName(entitlement({ pinned_event_id: "ev-1" }), names)
    ).toBe(customerCopy.sessionTitle("Mothers"))
    expect(entitlementName(entitlement(), names)).toBe("Card at purchase")
    expect(
      entitlementName(entitlement({ pinned_event_id: "ev-2" }), names)
    ).toBe("Card at purchase")
  })
})

describe("isHomeCard", () => {
  it.each([
    ["an active card", {}, true],
    ["a card with only booked entries", { available: 0, reserved: 4 }, true],
    [
      "a used-up card",
      { available: 0, reserved: 0, used: 4, is_used_up: true },
      false,
    ],
    ["an expired card", { is_expired: true }, false],
    [
      "a card that expired before it was bound",
      { is_expired: true, expired_before_bound: true },
      false,
    ],
    ["a cancelled card", { status: "revoked" }, false],
    ["a pinned single", { kind: "single", pinned_event_id: "ev-1" }, false],
    ["a pinned couple", { kind: "couple", pinned_event_id: "ev-1" }, false],
  ] as const)("%s", (_label, change, expected) => {
    expect(isHomeCard(entitlement(change))).toBe(expected)
  })
})

describe("isEmptyHome", () => {
  it("is empty only with no session ahead and no active card", () => {
    expect(isEmptyHome(0, 0)).toBe(true)
    expect(isEmptyHome(1, 0)).toBe(false)
    expect(isEmptyHome(0, 1)).toBe(false)
    expect(isEmptyHome(0, 0, 1)).toBe(false)
  })
})

describe("isHomeReturned (story 3.6)", () => {
  const returned = {
    kind: "single",
    original_units: 1,
    available: 1,
    returned: true,
  }
  it.each([
    ["a returned single with its entry", returned, true],
    ["a waiting one", { ...returned, awaiting_sessions: true }, true],
    [
      "booked again (no free entry)",
      { ...returned, available: 0, reserved: 1 },
      false,
    ],
    [
      "a pinned single not cancelled",
      { kind: "single", pinned_event_id: "ev-1", available: 0, reserved: 1 },
      false,
    ],
    ["a card", { returned: true }, false],
  ] as const)("%s", (_label, change, expected) => {
    expect(isHomeReturned(entitlement(change))).toBe(expected)
  })

  it("parses returned and awaiting_sessions", () => {
    expect(entitlement({ ...returned, awaiting_sessions: true })).toMatchObject(
      {
        returned: true,
        awaitingSessions: true,
      }
    )
  })
})

describe("byPaidOnDesc", () => {
  it("puts the newest purchase first", () => {
    const rows = [
      { id: "a", paidOn: "2026-09-01" },
      { id: "b", paidOn: "2026-10-01" },
      { id: "c", paidOn: "2026-09-15" },
    ]
    expect([...rows].sort(byPaidOnDesc).map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ])
  })
})
