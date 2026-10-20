import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { BabiesRow } from "./babies-row"
import { BalancePlate, SinglePlate } from "./balance-plates"
import type { BalanceItem } from "./card-items"
import { HistoryDisclosure } from "./history-disclosure"

const copy = adminCopy.customers.card
const HREF = "/admin/customers/c1/entitlements/e1"

const plate = (overrides: Partial<BalanceItem> = {}): BalanceItem => ({
  key: "e1",
  productName: "כרטיסייה 4",
  used: 1,
  reserved: 1,
  total: 4,
  meter: true,
  summary: copy.balanceSummary(1, 1, 2),
  until: copy.validUntil("01.12"),
  expiresOn: "2026-12-01",
  extended: false,
  chip: null,
  entries: [],
  ...overrides,
})

describe("a balance plate (fix 9)", () => {
  it("one link to the card's page, named by the product, stretched over the plate", () => {
    const html = renderToStaticMarkup(
      <BalancePlate item={plate()} href={HREF} />
    )
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain(`href="${HREF}"`)
    expect(html).toContain(
      `aria-label="${copy.entitlementLinkFor("כרטיסייה 4")}"`
    )
    expect(html).toContain("after:inset-0")
    expect(html).toMatch(/^<li class="relative /)
    // The old text link is gone.
    expect(html).not.toContain(">פרטים ותיקונים<")
  })

  it("with entries: the toggle sits above the link, so it opens in place", () => {
    const html = renderToStaticMarkup(
      <BalancePlate
        item={plate({
          entries: [{ key: "f", kind: "free", text: "פנויה", title: null }],
        })}
        href={HREF}
      />
    )
    expect(html).toMatch(/<details class="[^"]*relative z-10/)
    expect(html).toContain(copy.entriesToggle)
  })

  it("an open single is not a link", () => {
    const html = renderToStaticMarkup(
      <SinglePlate
        item={{ key: "s1", productName: "בודד", line: "יש לשריין", chip: null }}
      />
    )
    expect(html).not.toContain("<a ")
  })
})

describe("the history (fix 9)", () => {
  it("closed at first: a button in the h2 with aria-expanded false, rows hidden", () => {
    const html = renderToStaticMarkup(
      <HistoryDisclosure id="card-history" title={copy.history}>
        <li>row</li>
      </HistoryDisclosure>
    )
    expect(html).toMatch(
      /<h2[^>]*><button id="card-history" type="button" aria-expanded="false" aria-controls="card-history-panel"/
    )
    expect(html).toMatch(/<ul id="card-history-panel" hidden/)
  })

  it("open: aria-expanded true and the rows shown", () => {
    const html = renderToStaticMarkup(
      <HistoryDisclosure id="card-history" title={copy.history} defaultOpen>
        <li>row</li>
      </HistoryDisclosure>
    )
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toMatch(/<ul id="card-history-panel" hidden/)
    expect(html).toContain("<li>row</li>")
  })
})

describe("the babies' row in the details (fix 9)", () => {
  it("none: the 'no babies' line", () => {
    const html = renderToStaticMarkup(
      <dl>
        <BabiesRow babies={[]} />
      </dl>
    )
    expect(html).toContain(copy.babies)
    expect(html).toContain(copy.noBabies)
  })

  it("each baby with the age", () => {
    const html = renderToStaticMarkup(
      <dl>
        <BabiesRow babies={[{ key: "b1", name: "Lia", age: "3 months" }]} />
      </dl>
    )
    expect(html).toContain("Lia")
    expect(html).toContain(", 3 months")
    expect(html).not.toContain(copy.noBabies)
  })
})
