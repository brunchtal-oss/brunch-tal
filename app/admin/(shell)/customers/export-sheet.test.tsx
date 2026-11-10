import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"

import { ExportForm } from "./export-sheet"

const copy = adminCopy.customers.export

function render(props: Partial<Parameters<typeof ExportForm>[0]> = {}) {
  return renderToStaticMarkup(
    <ExportForm
      shown={null}
      columns={["full_name", "phone", "email", "special_brunch_interests"]}
      onColumnsChange={() => {}}
      pending={false}
      notice={null}
      onSubmit={() => {}}
      {...props}
    />
  )
}

describe("ExportForm", () => {
  it("nothing shown: every customer, no scope choice; the four columns, all checked", () => {
    const html = render()
    expect(html).toContain("בחרת לייצא את כל הלקוחות")
    expect(html).not.toContain('type="radio"')
    // Story 2.16: the special brunches are a column like the others.
    for (const header of ["שם", "טלפון", "מייל", "בראנצ׳ים מיוחדים"]) {
      expect(html).toContain(header)
    }
    expect(html.match(/aria-checked="true"/g)).toHaveLength(4)
    expect(html).not.toContain("aria-disabled")
  })

  it("says what the screen shows: a category or the search with its count", () => {
    expect(
      render({
        shown: { kind: "category", activity: "inactive", interests: [] },
      })
    ).toContain("בחרת לייצא את כל הלקוחות הלא פעילות")
    expect(
      render({
        shown: { kind: "category", activity: "active", interests: [] },
      })
    ).toContain("בחרת לייצא את כל הלקוחות הפעילות")
    expect(
      render({ shown: { kind: "search", query: "רונ", count: "5" } })
    ).toContain("בחרת לייצא את תוצאות החיפוש (5)")
  })

  // Story 2.16: the filter's line under "בחרת לייצא…", only when it is on.
  it("shows the special-brunch filter's line", () => {
    const line = copy.onlyInterest(["בראנץ׳ זוגות", "בראנץ׳ עם סבוש"])
    expect(line).toBe("רק מי שסימנה: בראנץ׳ זוגות או בראנץ׳ עם סבוש")
    expect(render({ interestLine: line })).toContain(line)
    expect(render()).not.toContain("רק מי שסימנה")
  })

  it("no column: the button is aria-disabled with the reason", () => {
    const html = render({ columns: [] })
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain(copy.noColumns)
    expect(html).toMatch(/aria-describedby="[^"]+-reason"/)
  })

  it("locks while preparing", () => {
    const html = render({ pending: true })
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('aria-disabled="true"')
  })

  it("shows the result: success or the error's message", () => {
    expect(render({ notice: { ok: true } })).toContain(copy.done)
    expect(render({ notice: { ok: false, code: "NOT_AUTHORIZED" } })).toContain(
      errorMessage("NOT_AUTHORIZED")
    )
  })
})
