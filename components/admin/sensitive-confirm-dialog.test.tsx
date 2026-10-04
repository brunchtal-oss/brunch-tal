import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  SENSITIVE_ACTIONS,
  sensitiveTitle,
} from "@/lib/admin/sensitive-actions"
import { adminCopy } from "@/lib/copy/admin"

import { SensitiveConfirmPanel } from "./sensitive-confirm-dialog"

const props = {
  impact: [
    { label: "Customer", value: "Dana" },
    { label: "Price", value: "472 ₪ ← 440 ₪" },
  ],
  checkboxLabel: "I confirm the change",
  confirmLabel: "Approve",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

describe("SensitiveConfirmPanel", () => {
  it("shows the impact box, the checkbox and an aria-disabled confirm", () => {
    const html = renderToStaticMarkup(<SensitiveConfirmPanel {...props} />)
    expect(html).toContain("<dt")
    expect(html).toContain("Dana")
    expect(html).toContain("472 ₪ ← 440 ₪")
    expect(html).toContain("I confirm the change")
    expect(html).toContain('role="checkbox"')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain(adminCopy.sensitive.cancel)
    // The hint appears only after a press without the checkbox.
    expect(html).not.toContain(adminCopy.sensitive.checkRequired)
  })

  it("adds the warning and an optional reason field (never required)", () => {
    const html = renderToStaticMarkup(
      <SensitiveConfirmPanel
        {...props}
        notice="Heads up"
        reason={{ label: "Reason (optional)", value: "", onChange: vi.fn() }}
      />
    )
    expect(html).toContain("Heads up")
    expect(html).toContain("Reason (optional)")
    expect(html).toContain("<textarea")
    expect(html).not.toContain("aria-required")
  })
})

describe("sensitive actions", () => {
  it("titles price_change with its question", () => {
    expect(sensitiveTitle("price_change")).toBe("האם לאשר שינוי מחיר?")
    for (const title of Object.values(SENSITIVE_ACTIONS)) {
      expect(title.endsWith("?")).toBe(true)
    }
  })
})
