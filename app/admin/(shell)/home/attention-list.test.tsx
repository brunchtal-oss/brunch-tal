import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("./load-home", () => ({ loadAttentionItems: vi.fn() }))
vi.mock("../attention/actions", () => ({
  markCorrectionHandledAction: vi.fn(),
  previewSettleParkedAction: vi.fn(),
  settleParkedAction: vi.fn(),
}))

const { AttentionRows } = await import("./attention-list")
const { toAttentionItems } = await import("../home-items")

const BASE = {
  customer_label: "Noa",
  since: "2026-10-12T07:00:00Z",
  event_id: "11111111-1111-4111-8111-111111111111",
  concept_name: "שישי מיוחד",
  starts_at: "2026-10-16T07:00:00Z",
}

describe("AttentionRows (story 3.13)", () => {
  it("a row with an action shows its button under the row's link", () => {
    const html = renderToStaticMarkup(
      <AttentionRows
        items={toAttentionItems([
          {
            ...BASE,
            kind: "correction_affected",
            id: "b1",
            customer_id: "22222222-2222-4222-8222-222222222222",
            entitlement_id: "33333333-3333-4333-8333-333333333333",
            field: "allowed_weekdays",
          },
          {
            ...BASE,
            kind: "paid_without_place",
            id: "e1",
            event_status: "cancelled",
          },
        ])}
      />
    )
    expect(html).toContain("טופל")
    expect(html).toContain('aria-label="סימון שטופל: Noa"')
    expect(html).toContain("הצעת החזר או זיכוי")
    expect(html.match(/<button/g)).toHaveLength(2)
  })

  it("a row without an action has no button", () => {
    const html = renderToStaticMarkup(
      <AttentionRows
        items={toAttentionItems([
          { ...BASE, kind: "paid_without_place", id: "e1" },
        ])}
      />
    )
    expect(html).not.toContain("<button")
  })
})
