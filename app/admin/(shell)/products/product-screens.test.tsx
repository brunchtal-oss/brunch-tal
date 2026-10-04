import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { ProductEditor } from "./[id]/product-editor"
import { ProductCreateForm } from "./new/product-create-form"
import type { ProductRow } from "./product-draft"

vi.mock("./actions", () => ({
  createProductAction: vi.fn(),
  updateProductAction: vi.fn(),
  previewProductPriceAction: vi.fn(),
  setProductPriceAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/products/x",
}))

const copy = adminCopy.products

const CARD: ProductRow = {
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
}

describe("ProductCreateForm", () => {
  it("starts with the type, the fixed note and every field", () => {
    const html = renderToStaticMarkup(
      <ProductCreateForm defaultValidityDays={49} />
    )
    expect(html.indexOf(copy.fields.type)).toBeLessThan(
      html.indexOf(copy.fields.name)
    )
    for (const text of [
      copy.scopeNote,
      ...Object.values(copy.types),
      copy.fields.price,
      copy.fields.units,
      copy.fields.validity,
      copy.weekdaysOpen,
      copy.fields.eventKind,
      copy.fields.partySize,
      copy.fields.introOnly,
      copy.fields.postJoinMessage,
      copy.fields.postJoinButtonLabel,
      copy.create.submit,
    ]) {
      expect(html, text).toContain(text)
    }
    // Every day by default: the weekday picker stays closed behind the link.
    expect(html).not.toContain(copy.fields.weekdays)
  })
})

describe("ProductEditor", () => {
  it("hides the weekday row of a product valid every day, and shows a restricted one", () => {
    const open = renderToStaticMarkup(<ProductEditor row={CARD} />)
    expect(open).toContain(copy.fields.weekdays)
    expect(open).not.toContain(copy.weekdaysOpen)
    const closed = renderToStaticMarkup(
      <ProductEditor row={{ ...CARD, allowed_weekdays: null }} />
    )
    expect(closed).toContain(copy.weekdaysOpen)
    expect(closed).not.toContain(copy.fields.weekdays)
  })

  it("shows each field with its saved value, the note and hide, and no change box yet", () => {
    const html = renderToStaticMarkup(<ProductEditor row={CARD} />)
    for (const text of [
      copy.scopeNote,
      copy.fields.price,
      copy.fields.validityDays,
      copy.hide,
    ]) {
      expect(html, text).toContain(text)
    }
    expect(html).toContain('value="472"')
    expect(html).toContain('value="49"')
    expect(html).not.toContain(adminCopy.valueChange.save)
  })

  it("offers to show a hidden product", () => {
    const html = renderToStaticMarkup(
      <ProductEditor row={{ ...CARD, active: false }} />
    )
    expect(html).toContain(copy.show)
  })
})
