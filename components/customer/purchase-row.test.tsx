import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"
import { formatAgorot } from "@/lib/money"

import { PurchaseRow } from "./purchase-row"

const base = {
  href: "/me/purchases/ent-1",
  productName: "Personal card",
  amountAgorot: 47200,
  paidOn: "2026-09-23",
  expiresOn: "2026-11-19",
  status: null,
}

describe("PurchaseRow", () => {
  it("shows the name, then the price, the purchase date and the validity, as one link", () => {
    const html = renderToStaticMarkup(<PurchaseRow {...base} />)
    expect(html).toContain(base.productName)
    expect(html).toContain(formatAgorot(47200))
    expect(html).toContain(customerCopy.purchasedOn)
    expect(html).toContain(customerCopy.validUntil)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain(`href="${base.href}"`)
  })

  it("shows the word of an ended purchase in place of its validity", () => {
    const html = renderToStaticMarkup(
      <PurchaseRow {...base} status={customerCopy.entitlementUsedUp} />
    )
    expect(html).toContain(customerCopy.entitlementUsedUp)
    expect(html).not.toContain(customerCopy.validUntil)
  })

  it("shows the note of a card that expired before it was bound", () => {
    const html = renderToStaticMarkup(
      <PurchaseRow
        {...base}
        status={customerCopy.entitlementExpired}
        expiredNote={<p>{customerCopy.expiredBeforeBound}</p>}
      />
    )
    expect(html).toContain(customerCopy.expiredBeforeBound)
    expect(html).toContain(formatAgorot(47200))
    expect(html).not.toContain(customerCopy.validUntil)
  })

  it("story 3.6: a waiting returned entry shows the words, never the provisional date", () => {
    const html = renderToStaticMarkup(
      <PurchaseRow {...base} expiresOn="2036-10-14" awaiting />
    )
    expect(html).toContain(customerCopy.awaitingSessions)
    expect(html).not.toContain(customerCopy.validUntil)
    expect(html).not.toContain("14.10")
  })
})
