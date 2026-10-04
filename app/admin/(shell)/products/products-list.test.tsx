import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { ProductRow } from "./product-draft"
import { ProductsList } from "./products-list"

const copy = adminCopy.products

const row = (overrides: Partial<ProductRow> = {}): ProductRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Card",
  type: "card",
  price_agorot: 47200,
  units: 4,
  validity_mode: "days",
  validity_days: 49,
  allowed_weekdays: [1, 4],
  eligible_event_kind: "regular",
  party_size: 1,
  intro_only: false,
  post_join_message: null,
  post_join_button_label: null,
  active: true,
  ...overrides,
})

describe("ProductsList", () => {
  it("shows the name, the summary and a link to the editor", () => {
    const html = renderToStaticMarkup(<ProductsList rows={[row()]} />)
    expect(html).toContain("Card")
    expect(html).toContain("472 ₪ · 4 כניסות · בתוקף 49 ימים")
    expect(html).toContain(
      'href="/admin/products/11111111-1111-4111-8111-111111111111"'
    )
    expect(html).not.toContain(copy.hidden)
  })

  it("marks a hidden product", () => {
    const html = renderToStaticMarkup(
      <ProductsList rows={[row({ active: false })]} />
    )
    expect(html).toContain(copy.hidden)
  })
})
