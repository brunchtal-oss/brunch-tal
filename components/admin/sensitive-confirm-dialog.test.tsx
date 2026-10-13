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

describe("the message slot (story 3.8)", () => {
  it("shows the prefilled message with its hint and limit", () => {
    const html = renderToStaticMarkup(
      <SensitiveConfirmPanel
        {...props}
        message={{
          label: "Notice",
          hint: "Title: cancelled",
          value: "Prefilled body",
          maxLength: 1000,
          onChange: vi.fn(),
        }}
      />
    )
    expect(html).toContain("Notice")
    expect(html).toContain("Title: cancelled")
    expect(html).toContain("Prefilled body")
    expect(html).toContain('maxLength="1000"')
    // The textarea is described by its hint.
    const hintId = /<p id="([^"]+)"[^>]*>Title: cancelled/.exec(html)?.[1]
    expect(hintId).toBeTruthy()
    expect(html).toMatch(
      new RegExp(`<textarea[^>]*aria-describedby="${hintId}"`)
    )
  })

  it("a second required checkbox when given (story 3.8)", () => {
    const html = renderToStaticMarkup(
      <SensitiveConfirmPanel {...props} secondCheckboxLabel="I know" />
    )
    expect(html).toContain("I know")
    expect(html.match(/role="checkbox"/g)).toHaveLength(2)
    expect(html).toContain('aria-disabled="true"')
  })

  it("titles the session actions with their questions", () => {
    expect(sensitiveTitle("event_cancel")).toBe("האם לבטל את המפגש?")
    expect(sensitiveTitle("event_reschedule")).toBe("האם לשנות את מועד המפגש?")
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
