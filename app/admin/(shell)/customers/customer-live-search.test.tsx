import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SPECIAL_BRUNCH_FALLBACK } from "@/lib/special-brunch"

import { CustomerLiveSearch } from "./customer-live-search"

vi.mock("./actions", () => ({ listCustomersAction: vi.fn() }))

// The links of the rendered page, with their text and aria-current.
function links(html: string) {
  return [...html.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((m) => ({
    href: /href="([^"]*)"/.exec(m[1])?.[1]?.replaceAll("&amp;", "&"),
    current: m[1].includes('aria-current="page"'),
    text: m[2],
  }))
}

// Story 2.16: the special-brunch chips under the categories.
describe("CustomerLiveSearch: the special-brunch filter", () => {
  const html = renderToStaticMarkup(
    <CustomerLiveSearch
      initialQuery=""
      category="inactive"
      interest="grandma"
      specialBrunch={{ ...SPECIAL_BRUNCH_FALLBACK, grandma_title: "G" }}
    />
  )
  const all = links(html)

  it("the category buttons keep the filter", () => {
    for (const activity of ["all", "active", "inactive"]) {
      expect(all.map((l) => l.href)).toContain(
        `/admin/customers?activity=${activity}&interest=grandma`
      )
    }
  })

  it("the chips keep the category; the chosen one is current, not 'הכול'", () => {
    const chip = (text: string) => all.find((l) => l.text === text)
    expect(chip("G")).toEqual({
      href: "/admin/customers?activity=inactive&interest=grandma",
      current: true,
      text: "G",
    })
    expect(chip("הכול")).toEqual({
      href: "/admin/customers?activity=inactive",
      current: false,
      text: "הכול",
    })
    // The labels come from the passed content.
    expect(chip(SPECIAL_BRUNCH_FALLBACK.couples_title)?.href).toBe(
      "/admin/customers?activity=inactive&interest=couples"
    )
    expect(chip(SPECIAL_BRUNCH_FALLBACK.grandma_title)).toBeUndefined()
    expect(html).toContain("בראנצ׳ים מיוחדים")
  })
})
