import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SPECIAL_BRUNCH_FALLBACK } from "@/lib/special-brunch"

import { CustomerLiveSearch } from "./customer-live-search"
import { FilterForm } from "./filter-sheet"

vi.mock("./actions", () => ({ listCustomersAction: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

const SB = { ...SPECIAL_BRUNCH_FALLBACK, grandma_title: "G" }

function render(
  category: "all" | "active" | "inactive" | null,
  interests: ("couples" | "grandma" | "grandpa")[],
  initialQuery = ""
) {
  return renderToStaticMarkup(
    <CustomerLiveSearch
      initialQuery={initialQuery}
      category={category}
      interests={interests}
      specialBrunch={SB}
    />
  )
}

// Story 2.16 (phone-check fix, user decision 2026-11-10): one "סינון"
// button in place of the category buttons and the chips.
describe("CustomerLiveSearch: the filter button", () => {
  it("no category links or chips; the button and the export", () => {
    const html = render("inactive", ["grandma"])
    expect(html).not.toContain("?activity=")
    expect(html).toContain(">סינון<")
    expect(html).toContain("ייצוא")
  })

  it("carries the number of active filters", () => {
    expect(render("inactive", ["grandma", "couples"])).toContain(
      'aria-label="סינון, 3 פעילים"'
    )
    expect(render("all", [])).toContain('aria-label="סינון"')
    expect(render(null, [])).toContain('aria-label="סינון"')
  })

  it("a search ignores the filter: no number", () => {
    expect(render("inactive", ["grandma"], "רונ")).toContain(
      'aria-label="סינון"'
    )
  })
})

describe("FilterForm", () => {
  const html = (
    activities: ("active" | "inactive")[],
    interests: ("couples" | "grandma" | "grandpa")[]
  ) =>
    renderToStaticMarkup(
      <FilterForm
        choice={{ activities, interests }}
        onChoiceChange={() => {}}
        specialBrunch={SB}
        onSubmit={() => {}}
      />
    )

  it("every option, the titles from the content, and the button", () => {
    const page = html([], [])
    for (const text of [
      "כל הלקוחות",
      "פעילות",
      "לא פעילות",
      SPECIAL_BRUNCH_FALLBACK.couples_title,
      "G",
      SPECIAL_BRUNCH_FALLBACK.grandpa_title,
      "בראנצ׳ים מיוחדים",
      "הצגת הלקוחות",
    ]) {
      expect(page).toContain(text)
    }
  })

  // A checked box renders the attribute data-checked (Base UI).
  const checked = (page: string) =>
    (page.match(/ data-checked=""/g) ?? []).length

  it("'כל הלקוחות' is checked only when nothing else is", () => {
    const none = checked(html([], []))
    expect(none).toBeGreaterThan(0)
    // Two boxes checked, and not the "all" one.
    expect(checked(html(["active"], ["couples"]))).toBe(none * 2)
  })
})
