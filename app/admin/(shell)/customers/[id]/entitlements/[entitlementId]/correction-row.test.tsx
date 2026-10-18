import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("./actions", () => ({
  previewCorrectEntitlementAction: vi.fn(),
  correctEntitlementAction: vi.fn(),
}))

const { CorrectionRow } = await import("./correction-row")

const PROPS = {
  entitlementId: "11111111-1111-4111-8111-111111111111",
  field: "expires_on" as const,
  label: "בתוקף עד",
  value: "15.11.26",
  note: "(כולל הארכה)",
  initial: {
    expiresOn: "2026-11-15",
    units: "2",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    kind: "regular",
  },
  validFrom: "2026-10-01",
  reserved: 1,
  sessions: [],
  customerName: "Noa",
  hasCustomer: true,
}

describe("CorrectionRow (story 3.13)", () => {
  it("shows the term, its value, the marker and שינוי", () => {
    const html = renderToStaticMarkup(<CorrectionRow {...PROPS} editable />)
    expect(html).toContain("בתוקף עד")
    expect(html).toContain("15.11.26")
    expect(html).toContain("(כולל הארכה)")
    expect(html).toContain("שינוי")
    expect(html).toContain('aria-label="שינוי בתוקף עד"')
    expect(html).not.toContain("←")
  })

  it("a card that cannot be corrected has no button", () => {
    const html = renderToStaticMarkup(
      <CorrectionRow {...PROPS} editable={false} />
    )
    expect(html).not.toContain("שינוי")
  })
})
