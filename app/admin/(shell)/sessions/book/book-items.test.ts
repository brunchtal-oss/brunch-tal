import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  bookListView,
  countFreeEntries,
  markBooked,
  parseCustomerBookable,
} from "./book-items"

describe("manual booking rows", () => {
  it("marks the sessions she is already booked for, keeps the order", () => {
    const rows = markBooked(
      [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      ["s2", "other"]
    )
    expect(rows).toEqual([
      { id: "s1", booked: false },
      { id: "s2", booked: true },
      { id: "s3", booked: false },
    ])
  })

  it("no bookings: nothing marked", () => {
    expect(markBooked([{ id: "s1" }], [])).toEqual([
      { id: "s1", booked: false },
    ])
  })
})

describe("her free entries (the selection cap)", () => {
  const base = {
    entitlements: [] as {
      id: string
      status: string
      pinned_event_id: string | null
      expires_on: string
    }[],
    balances: [] as {
      entitlement_id: string | null
      available: number | null
    }[],
    credits: [] as { id: string; status: string; choice_pending: boolean }[],
    fundingCreditIds: [] as string[],
    today: "2026-10-13",
  }

  it("a card with 1 free (Roni): 1", () => {
    expect(
      countFreeEntries({
        ...base,
        entitlements: [
          {
            id: "c1",
            status: "active",
            pinned_event_id: null,
            expires_on: "2026-11-19",
          },
        ],
        balances: [{ entitlement_id: "c1", available: 1 }],
      })
    ).toBe(1)
  })

  it("counts as preview_book_sessions: active, not pinned, valid today or later; plus free credits", () => {
    expect(
      countFreeEntries({
        ...base,
        entitlements: [
          {
            id: "ok",
            status: "active",
            pinned_event_id: null,
            expires_on: "2026-10-13",
          },
          {
            id: "old",
            status: "active",
            pinned_event_id: null,
            expires_on: "2026-10-12",
          },
          {
            id: "revoked",
            status: "revoked",
            pinned_event_id: null,
            expires_on: "2026-12-01",
          },
          {
            id: "pinned",
            status: "active",
            pinned_event_id: "e1",
            expires_on: "2026-12-01",
          },
        ],
        balances: [
          { entitlement_id: "ok", available: 2 },
          { entitlement_id: "old", available: 3 },
          { entitlement_id: "revoked", available: 4 },
          { entitlement_id: "pinned", available: 1 },
          { entitlement_id: null, available: 9 },
        ],
        credits: [
          { id: "free", status: "active", choice_pending: false },
          { id: "pending", status: "active", choice_pending: true },
          { id: "funding", status: "active", choice_pending: false },
          { id: "used", status: "used", choice_pending: false },
        ],
        fundingCreditIds: ["funding"],
      })
    ).toBe(3)
  })

  it("nothing active to fund: 0", () => {
    expect(countFreeEntries(base)).toBe(0)
  })
})

describe("only the sessions she can be booked for (story 3.19)", () => {
  it("the RPC's answer: the rows and the hidden count", () => {
    expect(
      parseCustomerBookable({ events: [{ id: "e1" }], hidden: 2 })
    ).toEqual({ events: [{ id: "e1" }], hidden: 2 })
  })

  it("a malformed answer: nothing listed, nothing hidden", () => {
    expect(parseCustomerBookable(null)).toEqual({ events: [], hidden: 0 })
    expect(parseCustomerBookable([{ id: "e1" }])).toEqual({
      events: [],
      hidden: 0,
    })
    expect(parseCustomerBookable({ events: "x", hidden: -1 })).toEqual({
      events: [],
      hidden: 0,
    })
    expect(parseCustomerBookable({ events: [], hidden: 1.5 })).toEqual({
      events: [],
      hidden: 0,
    })
  })

  it("the view: the list, nothing fundable, or no open session", () => {
    expect(bookListView(2, 0)).toBe("list")
    expect(bookListView(1, 3)).toBe("list")
    expect(bookListView(0, 3)).toBe("noFundable")
    expect(bookListView(0, 0)).toBe("noSessions")
  })

  it("the hidden line: one, several", () => {
    const copy = adminCopy.sessions
    expect(copy.hiddenSessions(1)).toBe(
      "מפגש אחד לא מוצג כי אין לה זכות שמתאימה לו"
    )
    expect(copy.hiddenSessions(3)).toBe(
      "3 מפגשים לא מוצגים כי אין לה זכות שמתאימה להם"
    )
    expect(copy.noFundableSessions).toBe(
      "אין מפגש פתוח שהזכויות שלה מתאימות לו"
    )
  })
})
