import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("../../payments/actions", () => ({
  previewCompleteRefundAction: vi.fn(),
  completeRefundAction: vi.fn(),
}))

const { CreditsSection } = await import("./credits-section")
const { parseCustomerCredits, toCustomerCreditItem } =
  await import("./credit-items")

const copy = adminCopy.customers.card.credits

const BASE = {
  credit_id: "c1",
  status: "active",
  choice_pending: false,
  party_size: 1,
  origin_starts_at: "2026-10-16T07:00:00Z",
  concept_name: "שישי מיוחד",
  monetary_basis_agorot: 18000,
  refund: null,
}

function items(rows: Record<string, unknown>[]) {
  return parseCustomerCredits(rows).map(toCustomerCreditItem)
}

describe("CreditsSection (story 3.9)", () => {
  it("none: the empty line", () => {
    const html = renderToStaticMarkup(
      <CreditsSection items={[]} customerName="Noa" />
    )
    expect(html).toContain(copy.empty)
  })

  it("a credit and a refund both show with their status; the button only on the open request", () => {
    const html = renderToStaticMarkup(
      <CreditsSection
        customerName="Noa"
        items={items([
          {
            ...BASE,
            credit_id: "c2",
            status: "refund_requested",
            refund: {
              refund_request_id: "r1",
              status: "requested",
              amount_agorot: 18000,
              requested_at: "2026-10-10T07:00:00Z",
              refunded_on: null,
              reference: null,
            },
          },
          BASE,
          {
            ...BASE,
            credit_id: "c3",
            status: "refunded",
            refund: {
              refund_request_id: "r3",
              status: "completed",
              amount_agorot: 12000,
              requested_at: "2026-10-10T07:00:00Z",
              refunded_on: "2026-10-12",
              reference: "1234",
            },
          },
        ])}
      />
    )
    const text = html.replace(/\s/g, " ")
    expect(html).toContain(copy.chips.active)
    expect(html).toContain(copy.chips.requested)
    expect(html).toContain(copy.chips.refunded)
    expect(text).toContain("הוחזר 120 ₪ ב-12.10.26")
    expect(text).toContain("אסמכתה: 1234")
    expect(html.split(adminCopy.refunds.button).length - 1).toBe(1)
    expect(html).toContain('id="credit-c2"')
  })
})
