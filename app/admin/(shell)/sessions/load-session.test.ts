import { describe, expect, it } from "vitest"

import {
  SESSION_COLUMNS,
  isReadOnlySession,
  sessionRowsFrom,
  sessionsListFilter,
  toSessionRow,
} from "./load-session"

describe("sessionsListFilter", () => {
  it("lists every draft and the published or cancelled sessions that have not ended", () => {
    expect(sessionsListFilter("2026-10-05T07:00:00.000Z")).toBe(
      "status.eq.draft,and(status.in.(published,cancelled),ends_at.gt.2026-10-05T07:00:00.000Z)"
    )
  })
})

describe("isReadOnlySession", () => {
  const now = new Date("2026-10-05T10:00:00Z")

  it.each([
    ["draft", "2026-10-06T10:00:00Z", false],
    ["published", "2026-10-06T10:00:00Z", false],
    // Started and not ended yet: Tal still books a walk-in.
    ["published", "2026-10-05T10:00:01Z", false],
    ["published", "2026-10-05T10:00:00Z", true],
    ["published", "2026-10-04T10:00:00Z", true],
    ["draft", "2026-10-04T10:00:00Z", true],
    ["cancelled", "2026-10-06T10:00:00Z", true],
    ["completed", "2026-10-06T10:00:00Z", true],
  ] as const)("%s ending %s -> %s", (status, ends_at, expected) => {
    expect(isReadOnlySession({ status, ends_at }, now)).toBe(expected)
  })
})

// Story 3.18: the eligible products embed (event_products(product_id)).
describe("toSessionRow product_ids", () => {
  const base = {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "regular",
    description: null,
    starts_at: "2026-12-15T08:00:00+00:00",
    ends_at: "2026-12-15T10:00:00+00:00",
    registration_closes_at: "2026-12-14T18:00:00+00:00",
    registration_close_overridden: false,
    status: "published",
    display_price_agorot: null,
    concepts: { name: "Greek" },
  }

  it("sorts the embedded ids", () => {
    expect(
      toSessionRow(
        {
          ...base,
          event_products: [{ product_id: "b-2" }, { product_id: "a-1" }],
        },
        12
      ).product_ids
    ).toEqual(["a-1", "b-2"])
  })

  it("a null or missing embed is none", () => {
    expect(
      toSessionRow({ ...base, event_products: null }, 12).product_ids
    ).toEqual([])
    expect(toSessionRow(base, 12).product_ids).toEqual([])
  })

  it("the embed itself is not kept on the row", () => {
    expect(
      toSessionRow({ ...base, event_products: [{ product_id: "a-1" }] }, 12)
    ).not.toHaveProperty("event_products")
  })
})

// Story 5.20: the capacity comes from an admin RPC, not from the edit
// page's select.
describe("toSessionRow capacity", () => {
  it("takes the capacity it is given", () => {
    const base = {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "regular",
      description: null,
      starts_at: "2026-12-15T08:00:00+00:00",
      ends_at: "2026-12-15T10:00:00+00:00",
      registration_closes_at: "2026-12-14T18:00:00+00:00",
      registration_close_overridden: false,
      status: "published",
      display_price_agorot: null,
      concepts: { name: "Greek" },
    }
    expect(toSessionRow(base, 14).capacity_adults).toBe(14)
  })

  it("the session screens' columns do not read the capacity (story 5.20)", () => {
    expect(SESSION_COLUMNS).not.toContain("capacity_adults")
  })
})

describe("sessionRowsFrom (story 5.20)", () => {
  const row = (id: string) => ({
    id,
    kind: "regular",
    description: null,
    starts_at: "2026-11-01T08:00:00Z",
    ends_at: "2026-11-01T10:00:00Z",
    registration_closes_at: "2026-10-31T18:00:00Z",
    registration_close_overridden: false,
    status: "published",
    display_price_agorot: null,
    concepts: { name: "Greek" },
  })

  it("takes the capacity from the RPC's capacity, not occupied", () => {
    const rows = sessionRowsFrom(
      [row("a"), row("b")],
      [
        { event_id: "a", occupied: 3, capacity: 12 },
        { event_id: "b", occupied: 0, capacity: 14 },
      ]
    )
    expect(rows.map((r) => [r.id, r.capacity_adults])).toEqual([
      ["a", 12],
      ["b", 14],
    ])
  })

  it("a listed session missing from the answer throws", () => {
    expect(() =>
      sessionRowsFrom([row("a")], [{ event_id: "b", occupied: 0, capacity: 9 }])
    ).toThrow("sessions capacity missing")
    expect(() =>
      sessionRowsFrom([row("a")], [{ event_id: "a", occupied: 2 }])
    ).toThrow("sessions capacity missing")
    expect(sessionRowsFrom([], [])).toEqual([])
  })
})
