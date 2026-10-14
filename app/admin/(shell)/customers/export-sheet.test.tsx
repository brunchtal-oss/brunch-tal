import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"

import { ExportForm } from "./export-sheet"

const copy = adminCopy.customers.export

function render(props: Partial<Parameters<typeof ExportForm>[0]> = {}) {
  return renderToStaticMarkup(
    <ExportForm
      search={null}
      scope="all"
      onScopeChange={() => {}}
      columns={["full_name", "phone", "email"]}
      onColumnsChange={() => {}}
      pending={false}
      notice={null}
      onSubmit={() => {}}
      {...props}
    />
  )
}

describe("ExportForm", () => {
  it("only 'all' without a search; the three columns, all checked", () => {
    const html = render()
    expect(html).toContain(copy.scopeAll)
    expect(html).not.toContain("תוצאות החיפוש")
    for (const header of ["שם", "טלפון", "מייל"]) expect(html).toContain(header)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(3)
    expect(html).not.toContain("aria-disabled")
  })

  it("offers the shown search with its count", () => {
    expect(render({ search: { query: "רונ", count: "200+" } })).toContain(
      copy.scopeSearch("200+")
    )
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
