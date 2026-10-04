import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { ValueChangeRow } from "./value-change-row"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const copy = adminCopy.valueChange

describe("ValueChangeRow", () => {
  it("shows only the field while the value is unchanged", () => {
    const html = renderToStaticMarkup(
      <ValueChangeRow
        label="Units"
        oldValue="4"
        newValue={null}
        scope="Scope note"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      >
        <input id="units" />
      </ValueChangeRow>
    )
    expect(html).toContain('id="units"')
    expect(html).not.toContain(copy.save)
    expect(html).not.toContain(copy.cancel)
    expect(html).not.toContain("Scope note")
    expect(html).not.toContain(copy.saved)
  })

  it("shows old ← new, the scope note and the save button after a change", () => {
    const html = renderToStaticMarkup(
      <ValueChangeRow
        label="Units"
        oldValue="4"
        newValue="5"
        scope="Scope note"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      >
        <input id="units" />
      </ValueChangeRow>
    )
    expect(html).toContain(copy.change("Units", "4", "5"))
    expect(html).toContain("Units: 4 ← 5")
    expect(html).toContain("Scope note")
    expect(html).toContain(copy.save)
    expect(html).toContain(copy.cancel)
    // No checkbox: it belongs to the sensitive dialog only.
    expect(html).not.toContain('role="checkbox"')
    expect(html).not.toContain("aria-busy")
  })
})
