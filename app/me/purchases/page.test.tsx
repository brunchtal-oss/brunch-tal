import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

// Online payments, PR B: "רכישת כרטיסייה" and the return notice at the top
// of "my purchases".

const CARD = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "כרטיסייה",
  type: "card",
  priceAgorot: 47200,
  units: 4,
  validityMode: "days",
  validityDays: 49,
}

const loadOptions = vi.fn()
let outcomeCookie: string | undefined

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bt_payment_outcome" && outcomeCookie
        ? { value: outcomeCookie }
        : undefined,
  }),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }))
vi.mock("@/lib/content/business-details", () => ({
  getWhatsappHref: async () => "https://wa.me/972500000000",
}))
vi.mock("@/components/shared/purchase-sheet", () => ({
  PurchaseSheet: ({
    products,
    eventId,
  }: {
    products: readonly unknown[]
    eventId: string | null
  }) => (
    <p>
      PURCHASE_SHEET:{products.length}:{String(eventId)}
    </p>
  ),
}))
vi.mock("./actions", () => ({
  loadCardPurchaseOptions: (...args: unknown[]) => loadOptions(...args),
  startCardPurchaseAction: vi.fn(),
}))

const { BuyCard } = await import("./page")

async function render(search: Record<string, string> = {}) {
  const node = await BuyCard({ searchParams: Promise.resolve(search) })
  return node ? renderToStaticMarkup(node) : ""
}

beforeEach(() => {
  outcomeCookie = undefined
  loadOptions.mockReset()
  loadOptions.mockResolvedValue({ enabled: false, products: [] })
})

describe("my purchases: buying a card (PR B)", () => {
  it("enabled: the card sheet, without a session", async () => {
    loadOptions.mockResolvedValue({ enabled: true, products: [CARD] })
    expect(await render()).toContain("PURCHASE_SHEET:1:null")
  })

  it("not enabled: nothing, even with products listed", async () => {
    loadOptions.mockResolvedValue({ enabled: false, products: [CARD] })
    expect(await render()).toBe("")
  })

  it("a paid card return: the success notice only with the outcome cookie", async () => {
    const paid = customerCopy.purchase.notices.paidCard
    expect(await render({ payment: "paid" })).not.toContain(paid)
    outcomeCookie = "paid.card"
    expect(await render({ payment: "paid" })).toContain(paid)
  })

  it("a card issue: the card wording with 'צרי קשר'", async () => {
    outcomeCookie = "issue.card"
    const html = await render({ payment: "issue" })
    expect(html).toContain(customerCopy.purchase.notices.issueCard)
    expect(html).toContain("צרי קשר")
  })
})
