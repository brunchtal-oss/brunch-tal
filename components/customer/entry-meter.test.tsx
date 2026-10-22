import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { EntryMeter, METER_MAX } from "./entry-meter"

function plates(html: string, kind: string) {
  return html.match(new RegExp(`data-entry="${kind}"`, "g"))?.length ?? 0
}

describe("EntryMeter", () => {
  it("draws one plate per entry: used, then booked, then free", () => {
    const html = renderToStaticMarkup(
      <EntryMeter used={1} reserved={2} total={4} />
    )
    expect(plates(html, "used")).toBe(1)
    expect(plates(html, "booked")).toBe(2)
    expect(plates(html, "free")).toBe(1)
    // In order: the used plate first, the free one last.
    expect(html.indexOf('data-entry="used"')).toBeLessThan(
      html.indexOf('data-entry="booked"')
    )
    expect(html.indexOf('data-entry="booked"')).toBeLessThan(
      html.indexOf('data-entry="free"')
    )
    // Decorative: the text next to it says it in words.
    expect(html).toContain('aria-hidden="true"')
  })

  it("a fully free card has only empty rings; a fully used one only filled plates", () => {
    const free = renderToStaticMarkup(
      <EntryMeter used={0} reserved={0} total={3} />
    )
    expect(plates(free, "free")).toBe(3)
    expect(free).not.toContain("bg-primary")
    const used = renderToStaticMarkup(
      <EntryMeter used={3} reserved={0} total={3} />
    )
    expect(plates(used, "used")).toBe(3)
    expect(used).not.toContain("border-brand-accent")
  })

  it("is meant for a card of a few entries", () => {
    expect(METER_MAX).toBe(12)
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
