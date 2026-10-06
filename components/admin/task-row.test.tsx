import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { detailLines, TaskRow } from "./task-row"

function render(props: Partial<React.ComponentProps<typeof TaskRow>> = {}) {
  return renderToStaticMarkup(
    <ul>
      <TaskRow
        href="/admin/links"
        title="התנגשות חשבון · Dana"
        detail="מייל וטלפון של שתי לקוחות"
        meta="מאז 12.10"
        metaAt="2026-10-12"
        chip={{ tone: "error", label: "התנגשות" }}
        {...props}
      />
    </ul>
  )
}

describe("TaskRow", () => {
  it("is one link (the title) to where the item is handled", () => {
    const html = render()
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('href="/admin/links"')
    expect(html).not.toContain("<button")
  })

  it("shows the title, the detail, the meta in <time> and the chip", () => {
    const html = render()
    expect(html).toContain("התנגשות חשבון · Dana")
    expect(html).toContain("מייל וטלפון של שתי לקוחות")
    expect(html).toContain('<time dateTime="2026-10-12">')
    expect(html).toContain("מאז 12.10")
    expect(html).toContain("bg-error-tint")
  })

  it("the link's name carries the status; the visible chip and the chevron are hidden from screen readers", () => {
    const html = render()
    const link = /<a [^>]*>(.*?)<\/a>/.exec(html)?.[1] ?? ""
    expect(link).toContain("התנגשות חשבון · Dana")
    expect(link).toContain('<span class="sr-only">, התנגשות</span>')
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*><span[^>]*bg-error-tint/
    )
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
  })

  it("leaves out a missing detail, meta or chip", () => {
    const html = render({ detail: null, meta: null, chip: null })
    expect(html).not.toContain("<time")
    expect(html).not.toContain("sr-only")
    expect(html).not.toMatch(/<p[ >]/)
  })

  it("puts each sentence of the detail on its own line, without the period", () => {
    expect(
      detailLines(
        "הקישור פג או בוטל לפני שהצטרפה. אפשר להפיק קישור חדש בלי תשלום נוסף"
      )
    ).toEqual([
      "הקישור פג או בוטל לפני שהצטרפה",
      "אפשר להפיק קישור חדש בלי תשלום נוסף",
    ])
    // A date keeps its dot.
    expect(
      detailLines("שילמה לבראנץ׳ שישי 16.10 והמפגש היה מלא. צריך למצוא מקום")
    ).toEqual(["שילמה לבראנץ׳ שישי 16.10 והמפגש היה מלא", "צריך למצוא מקום"])
    const html = render({ detail: "משפט אחד. משפט שני." })
    expect(html.match(/<bdi class="block">/g)).toHaveLength(2)
  })
})
