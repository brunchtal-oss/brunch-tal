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

  it("the legend: used with the dark key, then booked with the light key; no free item (2026-10-10)", () => {
    const html = renderToStaticMarkup(<HomeCard {...base} />)
    const used = html.indexOf(customerCopy.usedOf(1, 4))
    const booked = html.indexOf(customerCopy.bookedOf(2, 4))
    expect(used).toBeGreaterThan(-1)
    expect(used).toBeLessThan(booked)
    expect(html).not.toContain("פנויה")
    // The key just before each item's words.
    const keyBefore = (at: number) => {
      const before = html.slice(0, at)
      return before.lastIndexOf("bg-primary") >
        before.lastIndexOf("bg-brand-accent")
        ? "primary"
        : "accent"
    }
    expect(keyBefore(used)).toBe("primary")
    expect(keyBefore(booked)).toBe("accent")
  })

  it("one part per entry: used (dark), then booked (light), then free (grey)", () => {
    const html = renderToStaticMarkup(<HomeCard {...base} />)
    const parts = [
      ...html.matchAll(/<span[^>]*data-entry="[a-z]+"[^>]*>/g),
    ].map((m) => [
      /data-entry="([a-z]+)"/.exec(m[0])?.[1] ?? "",
      /class="([^"]*)"/.exec(m[0])?.[1] ?? "",
    ])
    expect(parts.map(([entry]) => entry)).toEqual([
      "used",
      "booked",
      "booked",
      "free",
    ])
    expect(parts[0][1]).toContain("bg-primary")
    expect(parts[1][1]).toContain("bg-brand-accent")
    expect(parts[3][1]).toContain("bg-border")
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
