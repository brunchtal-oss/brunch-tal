import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { BalanceCard } from "./balance-card"

const base = {
  href: "/me/purchases/ent-1",
  productName: "Personal card",
  used: 1,
  reserved: 2,
  total: 4,
  expiresOn: "2026-11-19",
  daysLeft: 9,
}

describe("BalanceCard", () => {
  it("shows the name, used and booked out of all entries, and the validity, as one link", () => {
    const html = renderToStaticMarkup(<BalanceCard {...base} />)
    expect(html).toContain(base.productName)
    expect(html).toContain(customerCopy.usedOf(1, 4))
    expect(html).toContain(customerCopy.bookedOf(2, 4))
    expect(html).toContain(customerCopy.validUntil)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain(`href="${base.href}"`)
    expect(html).not.toContain(customerCopy.expiring)
    expect(html).not.toContain(customerCopy.daysLeft(9))
  })

  it("draws one plate per entry: used, then booked, then free", () => {
    const html = renderToStaticMarkup(<BalanceCard {...base} />)
    expect(html.match(/data-entry="used"/g)).toHaveLength(1)
    expect(html.match(/data-entry="booked"/g)).toHaveLength(2)
    expect(html.match(/data-entry="free"/g)).toHaveLength(1)
  })

  it("adds the remaining days and the chip only when expiring", () => {
    const html = renderToStaticMarkup(<BalanceCard {...base} isExpiring />)
    expect(html).toContain(customerCopy.daysLeft(9))
    expect(html).toContain(customerCopy.expiring)
  })
})

describe("BalanceCard of an entry that is not a card", () => {
  const single = { ...base, used: 0, reserved: 0, total: 1 }

  it("no plates and no counts: 'יש להירשם' while it funds no booking", () => {
    const html = renderToStaticMarkup(
      <BalanceCard {...single} counts={false} />
    )
    expect(html).not.toContain("data-entry")
    expect(html).not.toContain(customerCopy.usedOf(0, 1))
    expect(html).not.toContain(customerCopy.bookedOf(0, 1))
    expect(html).toContain(customerCopy.toBook)
    expect(html).toContain("bg-pending-tint")
    expect(html).toContain(customerCopy.validUntil)
  })

  it("'נרשמת' while it funds a booking", () => {
    const html = renderToStaticMarkup(
      <BalanceCard {...single} reserved={1} counts={false} />
    )
    expect(html).toContain(customerCopy.booked)
    // "נרשמת" is filled, never the "יש מקום" green (2026-10-08).
    expect(html).toContain("bg-primary text-primary-foreground")
    expect(html).not.toContain("bg-success-tint")
    expect(html).not.toContain(customerCopy.toBook)
    expect(html).not.toContain(customerCopy.bookedOf(1, 1))
  })
})

describe("customerCopy", () => {
  it("says the last day for 0 days", () => {
    expect(customerCopy.daysLeft(0)).toBe("היום האחרון")
    expect(customerCopy.daysLeft(1)).toBe("עוד יום אחד")
    expect(customerCopy.daysLeft(9)).toBe("עוד 9 ימים")
  })

  it("writes used and booked as X/N", () => {
    expect(customerCopy.usedOf(1, 4)).toBe("ניצלת 1/4")
    expect(customerCopy.bookedOf(2, 4)).toBe("נרשמת 2/4")
  })
})
