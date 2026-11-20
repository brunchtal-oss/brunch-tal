import type { ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"
import { ERROR_MESSAGES, type ErrorCode } from "@/lib/errors"
import type { PurchaseProduct } from "@/lib/payments/purchase-options"
import {
  advisesContact,
  CLOSED,
  sheetReducer,
  unavailableReason,
} from "@/lib/payments/purchase-sheet-state"

// The pay button must be an OnlineButton (the offline guard): marked here.
vi.mock("@/components/shared/online-button", () => ({
  OnlineButton: (props: ComponentProps<"button">) => (
    <button data-online-button="" {...props} />
  ),
}))

const { PURCHASE_TERMS_HREF, PurchaseSheet, PurchaseSheetBody } =
  await import("./purchase-sheet")

const copy = customerCopy.purchase
const EVENT = "33333333-3333-4333-8333-333333333333"
const CONTACT = "https://wa.me/972500000000"

const CARD: PurchaseProduct = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "כרטיסייה",
  type: "card",
  priceAgorot: 47200,
  units: 4,
  validityMode: "days",
  validityDays: 49,
}
const SINGLE: PurchaseProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "בודד",
  type: "single",
  priceAgorot: 18000,
  units: 1,
  validityMode: "session",
  validityDays: null,
}

// The open sheet's content (the sheet itself is a portal).
function body(
  overrides: Partial<ComponentProps<typeof PurchaseSheetBody>> = {}
): string {
  return renderToStaticMarkup(
    <PurchaseSheetBody
      products={[SINGLE, CARD]}
      eventId={EVENT}
      productId={SINGLE.id}
      terms={true}
      busy={false}
      error={null}
      contactHref={CONTACT}
      onSelect={vi.fn()}
      onTerms={vi.fn()}
      onPay={vi.fn()}
      {...overrides}
    />
  )
}

function payButton(html: string): string {
  const match = /<button data-online-button=""[^>]*>/.exec(html)
  expect(match, "the pay button is an OnlineButton").not.toBeNull()
  return match![0]
}

describe("PurchaseSheet: closed", () => {
  it("only the trigger, with the dialog's trigger semantics", () => {
    const html = renderToStaticMarkup(
      <PurchaseSheet
        products={[CARD]}
        eventId={null}
        start={vi.fn()}
        trigger={copy.buyCard}
        triggerClassName="x"
      />
    )
    expect(html).toContain("רכישת כרטיסייה")
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain(copy.pay)
  })

  it("the exact wording and the terms page", () => {
    expect(PURCHASE_TERMS_HREF).toBe("/purchase-terms")
    expect(copy.sheetTitle).toBe("רכישה ותשלום")
    expect(copy.termsBefore + copy.termsLink).toBe(
      "קראתי ואני מסכימה לתקנון הרכישה"
    )
    expect(copy.pay).toBe("למעבר לתשלום")
    expect(copy.holdLine).toBe("המקום נשמר לך עד סיום התשלום.")
    expect(ERROR_MESSAGES.TERMS_REQUIRED).toBe(
      "צריך לאשר את תקנון הרכישה כדי להמשיך"
    )
    expect(copy.cardDetail(4, 49)).toBe("4 כניסות, בתוקף 49 ימים")
    expect(copy.cardDetail(1, null)).toBe("כניסה אחת")
  })
})

describe("PurchaseSheet: open", () => {
  it("the products with their prices; the hold line for a pinned product only", () => {
    const pinned = body()
    expect(pinned).toContain("בודד")
    expect(pinned).toContain("כרטיסייה")
    expect(pinned).toContain(copy.holdLine)
    expect(body({ productId: CARD.id })).not.toContain(copy.holdLine)
    // A card sheet without a session: never the hold line.
    expect(
      body({ products: [CARD], eventId: null, productId: CARD.id })
    ).not.toContain(copy.holdLine)
  })

  it("the terms link opens a new tab and says so", () => {
    const html = body()
    expect(html).toContain(`href="${PURCHASE_TERMS_HREF}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain("(נפתח בחלון חדש)")
  })

  it("ready: the pay button is not disabled and has no reason", () => {
    const button = payButton(body())
    expect(button).not.toContain("aria-disabled")
    expect(button).not.toContain("aria-describedby")
  })

  it("terms not ticked: aria-disabled, described by the terms reason", () => {
    const html = body({ terms: false })
    const button = payButton(html)
    expect(button).toContain('aria-disabled="true"')
    const id = /aria-describedby="([^"]+)"/.exec(button)![1]
    expect(html).toContain(
      `id="${id}" class="mt-2 text-[15px] text-muted-foreground">${ERROR_MESSAGES.TERMS_REQUIRED}`
    )
  })

  it("no product chosen: aria-disabled, described by its own reason", () => {
    const html = body({ productId: "" })
    const button = payButton(html)
    expect(button).toContain('aria-disabled="true"')
    const id = /aria-describedby="([^"]+)"/.exec(button)![1]
    expect(html).toContain(`id="${id}"`)
    expect(html).toContain(copy.chooseProduct)
    expect(html).not.toContain(ERROR_MESSAGES.TERMS_REQUIRED)
  })

  it("busy: aria-busy and aria-disabled, not dimmed", () => {
    const button = payButton(body({ busy: true }))
    expect(button).toContain('aria-busy="true"')
    expect(button).toContain('aria-disabled="true"')
    expect(button).not.toContain("opacity-50")
  })

  it("a refusal: its message in an error notice, with 'צרי קשר' when it advises contact", () => {
    const contact = body({ error: "ONLINE_PAYMENTS_OFF" })
    expect(contact).toContain('role="alert"')
    expect(contact).toContain(ERROR_MESSAGES.ONLINE_PAYMENTS_OFF)
    expect(contact).toContain(`href="${CONTACT}"`)

    const full = body({ error: "EVENT_FULL" })
    expect(full).toContain(ERROR_MESSAGES.EVENT_FULL)
    expect(full).not.toContain(`href="${CONTACT}"`)
  })
})

describe("the sheet's state", () => {
  const products = [SINGLE, CARD]
  const opened = sheetReducer(CLOSED, { type: "open", key: "k1", products })

  it("each opening: a new key, the first product, terms not ticked", () => {
    expect(opened).toEqual({
      open: true,
      key: "k1",
      productId: SINGLE.id,
      terms: false,
      busy: false,
      error: null,
    })
    const ticked = sheetReducer(opened, { type: "terms", value: true })
    const again = sheetReducer(sheetReducer(ticked, { type: "close" }), {
      type: "open",
      key: "k2",
      products,
    })
    expect(again.key).toBe("k2")
    expect(again.terms).toBe(false)
  })

  it("another product: a new key; the same product keeps it", () => {
    expect(
      sheetReducer(opened, { type: "select", productId: CARD.id, key: "k2" })
        .key
    ).toBe("k2")
    expect(
      sheetReducer(opened, { type: "select", productId: SINGLE.id, key: "k2" })
        .key
    ).toBe("k1")
  })

  it("a failure: the code, not busy, a new key", () => {
    const busy = sheetReducer(opened, { type: "submit" })
    expect(busy.busy).toBe(true)
    expect(
      sheetReducer(busy, {
        type: "failed",
        code: "CHECKOUT_TOO_MANY",
        key: "k3",
      })
    ).toMatchObject({ busy: false, error: "CHECKOUT_TOO_MANY", key: "k3" })
  })

  it("back from the back-forward cache: not busy, no error, a new key", () => {
    const busy = sheetReducer(opened, { type: "submit" })
    expect(sheetReducer(busy, { type: "pageshow", key: "k4" })).toMatchObject({
      busy: false,
      error: null,
      key: "k4",
      open: true,
    })
  })

  it("closing is refused while the checkout is on its way", () => {
    const busy = sheetReducer(opened, { type: "submit" })
    expect(sheetReducer(busy, { type: "close" }).open).toBe(true)
    expect(sheetReducer(opened, { type: "close" }).open).toBe(false)
  })

  it("the reason matches the cause", () => {
    expect(unavailableReason(null, true)).toBe("product")
    expect(unavailableReason(CARD, false)).toBe("terms")
    expect(unavailableReason(CARD, true)).toBeNull()
  })

  it.each([
    ["ONLINE_PAYMENTS_OFF", true],
    ["PRODUCT_NOT_PURCHASABLE", true],
    ["PUBLIC_PURCHASE_OFF", true],
    ["EVENT_FULL", false],
    ["CHECKOUT_TOO_MANY", false],
  ] as const)("%s advises contact: %s", (code, expected) => {
    expect(advisesContact(code as ErrorCode)).toBe(expected)
  })
})
