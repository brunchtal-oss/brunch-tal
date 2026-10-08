import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { HomeCard } from "./home-card"

const base = {
  href: "/me/purchases/ent-1",
  productName: "Personal card",
  available: 1,
  reserved: 2,
  used: 1,
  total: 4,
  expiresOn: "2026-11-19",
  daysLeft: 9,
}

describe("HomeCard", () => {
  it("the product, the free entries with their label, the legend and the validity, as one link", () => {
    const html = renderToStaticMarkup(<HomeCard {...base} />)
    expect(html).toContain(base.productName)
    expect(html).toContain(customerCopy.availableEntriesLabel)
    expect(customerCopy.availableEntriesLabel).toBe("כניסות זמינות")
    expect(html).toContain(customerCopy.bookedOf(2, 4))
    expect(html).toContain(customerCopy.usedOf(1, 4))
    expect(html).toContain(customerCopy.validUntil)
    expect(html).toContain("19.11")
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain(`href="${base.href}"`)
    // No frame and no fill.
    expect(html).not.toContain("border-border")
    expect(html).not.toContain("bg-muted")
    expect(html).not.toContain(customerCopy.expiring)
    expect(html).not.toContain(customerCopy.daysLeft(9))
  })

  it("one part per entry: free, then booked, then used", () => {
    const html = renderToStaticMarkup(<HomeCard {...base} />)
    const parts = [...html.matchAll(/data-entry="(\w+)"/g)].map((m) => m[1])
    expect(parts).toEqual(["free", "booked", "booked", "used"])
  })

  it("numeral-xl by default, numeral-lg for a second card", () => {
    expect(renderToStaticMarkup(<HomeCard {...base} />)).toContain(
      'data-numeral="xl"'
    )
    const second = renderToStaticMarkup(
      <HomeCard {...base} prominent={false} />
    )
    expect(second).toContain('data-numeral="lg"')
    expect(second).not.toContain("text-[40px]")
  })

  it("adds the remaining days and the chip only when expiring", () => {
    const html = renderToStaticMarkup(<HomeCard {...base} isExpiring />)
    expect(html).toContain(customerCopy.daysLeft(9))
    expect(html).toContain(customerCopy.expiring)
  })
})
