import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

// Online payments, PR B: who gets the purchase sheet on the public session
// page, and when the return notice shows.

const ID = "11111111-1111-4111-8111-111111111111"
const PRODUCT = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "בודד",
  type: "single",
  priceAgorot: 18000,
  units: 1,
  validityMode: "session",
  validityDays: null,
}

const loadOptions = vi.fn()
let role: string | null = null
let outcomeCookie: string | undefined

vi.mock("next/server", () => ({ connection: async () => {} }))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND")
  },
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bt_payment_outcome" && outcomeCookie
        ? { value: outcomeCookie }
        : undefined,
  }),
}))
vi.mock("@/lib/sessions/public", () => ({
  getPublicSession: async () => ({ id: ID, starts_at: "2099-10-12T07:00:00Z" }),
}))
vi.mock("@/lib/auth/viewer-role", () => ({ getViewerRole: async () => role }))
vi.mock("@/lib/content/business-details", () => ({
  businessNameOf: () => "Brunch",
  getBusinessDetails: async () => null,
  guestWhatsappHref: () => "https://wa.me/972500000000",
}))
vi.mock("@/components/public/json-ld", () => ({ JsonLd: () => null }))
vi.mock("@/lib/seo/structured-data", () => ({ buildEventData: () => ({}) }))
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://site.test" }))
// The view and the action are tested on their own; here only what reaches
// them.
vi.mock("@/components/public/public-sessions", () => ({
  PublicSessionView: ({ action }: { action: React.ReactNode }) => (
    <section>
      <h1>CONCEPT</h1>
      {action}
    </section>
  ),
  PublicSessionAction: ({
    customer,
    purchase,
  }: {
    customer: boolean
    purchase: React.ReactNode
  }) => (
    <div>
      {customer ? "CUSTOMER_LINK" : "GUEST_LINE"}
      {purchase}
    </div>
  ),
}))
vi.mock("@/components/shared/purchase-sheet", () => ({
  PurchaseSheet: ({ products }: { products: readonly unknown[] }) => (
    <p>PURCHASE_SHEET:{products.length}</p>
  ),
}))
vi.mock("./actions", () => ({
  loadGuestPurchaseOptions: (...args: unknown[]) => loadOptions(...args),
  startGuestPurchaseAction: vi.fn(),
}))

const { SessionContent } = await import("./page")

async function render(search: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await SessionContent({
      params: Promise.resolve({ id: ID }),
      searchParams: Promise.resolve(search),
    })
  )
}

beforeEach(() => {
  role = null
  outcomeCookie = undefined
  loadOptions.mockReset()
  loadOptions.mockResolvedValue({ enabled: false, products: [] })
})

describe("the public session page: buying (PR B)", () => {
  it("a guest while buying is enabled: the sheet with the products", async () => {
    loadOptions.mockResolvedValue({ enabled: true, products: [PRODUCT] })
    const html = await render()
    expect(html).toContain("PURCHASE_SHEET:1")
    expect(loadOptions).toHaveBeenCalledWith(ID)
  })

  it("a guest while not enabled: no sheet, even with products listed", async () => {
    loadOptions.mockResolvedValue({ enabled: false, products: [PRODUCT] })
    const html = await render()
    expect(html).not.toContain("PURCHASE_SHEET")
    expect(html).toContain("GUEST_LINE")
  })

  it("a signed-in customer (or an admin): no guest sheet, the options not read", async () => {
    for (const viewer of ["customer", "admin"]) {
      role = viewer
      loadOptions.mockResolvedValue({ enabled: true, products: [PRODUCT] })
      const html = await render()
      expect(html, viewer).not.toContain("PURCHASE_SHEET")
    }
    expect(loadOptions).not.toHaveBeenCalled()
  })

  it("the return notice: only with the matching outcome cookie, at the top", async () => {
    const failed = customerCopy.purchase.notices.failed
    expect(await render({ payment: "failed" })).not.toContain(failed)
    outcomeCookie = "expired.session"
    expect(await render({ payment: "failed" })).not.toContain(failed)
    outcomeCookie = "failed.session"
    const html = await render({ payment: "failed" })
    expect(html).toContain(failed)
    expect(html.indexOf(failed)).toBeLessThan(html.indexOf("<h1"))
  })
})
