import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { filterByPayment, toLinkItem, type LinkRow } from "./link-items"

const copy = adminCopy.links

const row = (overrides: Partial<LinkRow> = {}): LinkRow => ({
  token_id: "tok-1",
  payment_id: "pay-1",
  status: "pending",
  detail: null,
  detail_name: null,
  conflict_reason: null,
  product_name: "Card",
  amount_agorot: 47200,
  paid_on: "2026-10-01",
  created_at: "2026-10-01T09:00:00Z",
  // Monday 05.10 at 12:00 in Jerusalem (UTC+3).
  expires_at: "2026-10-05T09:00:00Z",
  consumed_at: null,
  revoked_at: null,
  customer_name: null,
  can_revoke: true,
  can_replace: true,
  ...overrides,
})

describe("toLinkItem", () => {
  it("words a waiting link with its validity and purchase", () => {
    expect(toLinkItem(row())).toEqual({
      tokenId: "tok-1",
      paymentId: "pay-1",
      title: copy.rowTitle.pending,
      purchase: copy.purchase("Card", "472 ₪", "01.10"),
      status: "pending",
      statusLabel: copy.status.pending,
      timeAt: "2026-10-05T09:00:00Z",
      timeLine: copy.validUntil("יום שני", "05.10", "12:00"),
      detail: null,
      canRevoke: true,
      canReplace: true,
    })
  })

  it.each(["pending", "expired", "revoked"] as const)(
    "puts the payer label before the title of a %s link",
    (status) => {
      expect(toLinkItem(row({ status, payer_label: "Michal" })).title).toBe(
        copy.rowTitleNamed("Michal", copy.rowTitle[status])
      )
    }
  )

  it("shows the customer's name, not the payer label, once the link is used", () => {
    expect(
      toLinkItem(
        row({
          status: "consumed",
          payer_label: "Michal",
          customer_name: "Dana",
        })
      ).title
    ).toBe("Dana")
  })

  it("shows the customer's name and the day of a consumed link", () => {
    const item = toLinkItem(
      row({
        status: "consumed",
        customer_name: "Dana",
        consumed_at: "2026-10-02T08:00:00Z",
        can_revoke: false,
        can_replace: false,
      })
    )
    expect(item).toMatchObject({
      title: "Dana",
      statusLabel: copy.status.consumed,
      timeLine: copy.consumedOn("02.10"),
      canRevoke: false,
      canReplace: false,
    })
  })

  it.each([
    ["expired", copy.rowTitle.expired, copy.expiredOn("05.10")],
    ["revoked", copy.rowTitle.revoked, copy.revokedOn("03.10")],
  ] as const)("words a %s link", (status, title, timeLine) => {
    const item = toLinkItem(row({ status, revoked_at: "2026-10-03T08:00:00Z" }))
    expect(item).toMatchObject({
      title,
      timeLine,
      statusLabel: copy.status[status],
    })
  })

  it("details awaiting_login with the account's name", () => {
    expect(
      toLinkItem(row({ detail: "awaiting_login", detail_name: "Noa" })).detail
    ).toEqual({ text: copy.detail.awaitingLogin("Noa"), attention: false })
  })

  it("flags a stuck link", () => {
    expect(toLinkItem(row({ detail: "stuck" })).detail).toEqual({
      text: copy.detail.stuck,
      attention: true,
    })
  })

  it.each([
    ["two_accounts", copy.reasons.two_accounts],
    ["too_many_attempts", copy.reasons.too_many_attempts],
    ["something_else", copy.reasons.bind_conflict],
    [null, copy.reasons.bind_conflict],
  ])("words a conflict with reason %j", (reason, text) => {
    expect(
      toLinkItem(row({ detail: "conflict", conflict_reason: reason })).detail
    ).toEqual({ text: copy.detail.conflict(text), attention: true })
  })

  it("has no detail once the link is not pending", () => {
    expect(
      toLinkItem(row({ status: "revoked", detail: "conflict" })).detail
    ).toBeNull()
  })
})

describe("filterByPayment", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const rows = [
    row({ token_id: "a1", payment_id: A, status: "revoked" }),
    row({ token_id: "b1", payment_id: B }),
    row({ token_id: "a2", payment_id: A }),
  ]
  const ids = (r: LinkRow[]) => r.map((x) => x.token_id)

  it("a payment with links: only its links, in order", () => {
    const result = filterByPayment(rows, A)
    expect(result.filtered).toBe(true)
    expect(ids(result.rows)).toEqual(["a1", "a2"])
    expect(ids(filterByPayment(rows, A.toUpperCase()).rows)).toEqual([
      "a1",
      "a2",
    ])
  })

  it("no parameter, an invalid id, several values or a payment with no links: the full list", () => {
    for (const payment of [
      undefined,
      "",
      "not-a-uuid",
      [A, B],
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]) {
      const result = filterByPayment(rows, payment)
      expect(result.filtered, String(payment)).toBe(false)
      expect(ids(result.rows)).toEqual(["a1", "b1", "a2"])
    }
  })
})
