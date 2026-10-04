import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  ApprovedLink,
  ApprovedPurchase,
  previewKey,
  submitBlock,
} from "./payment-form"

vi.mock("./actions", () => ({
  approvePaymentAction: vi.fn(),
  previewPaymentAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const EXPIRES = "2026-10-03T07:42:00+00:00"
const copy = adminCopy.payments

describe("ApprovedLink", () => {
  it("offers WhatsApp and copy for a new link", () => {
    const html = renderToStaticMarkup(
      <ApprovedLink
        link="https://host.example/join/abc"
        linkExpiresAt={EXPIRES}
      />
    )
    expect(html).toContain(copy.success)
    expect(html).toContain(copy.sendWhatsapp)
    expect(html).toContain(copy.copyLink)
    expect(html).not.toContain(copy.linkNotShown)
  })

  it("explains, without send buttons, that a repeat cannot show the link", () => {
    const html = renderToStaticMarkup(
      <ApprovedLink link={null} linkExpiresAt={EXPIRES} />
    )
    expect(html).toContain(copy.linkNotShown)
    expect(html).not.toContain(copy.success)
    expect(html).not.toContain(copy.sendWhatsapp)
    expect(html).not.toContain(copy.copyLink)
    expect(html).toContain(copy.another)
  })
})

describe("ApprovedLink with a payer label", () => {
  it("titles the link card with the label", () => {
    const html = renderToStaticMarkup(
      <ApprovedLink
        link="https://host.example/join/abc"
        linkExpiresAt={EXPIRES}
        payerLabel="Michal"
      />
    )
    expect(html).toContain(copy.linkTitleNamed("Michal"))
    expect(html).not.toContain(copy.linkTitle)
  })
})

describe("ApprovedPurchase", () => {
  it("names the customer and the purchase, with another payment and the list", () => {
    const html = renderToStaticMarkup(
      <ApprovedPurchase
        customerName="Dana"
        productName="Card"
        units={4}
        expiresOn="2026-11-19"
      />
    )
    expect(html).toContain(copy.successExisting("Dana"))
    expect(html).toContain(copy.successPurchase("Card", 4, "19.11"))
    expect(html).toContain('href="/admin/payments/new"')
    expect(html).toContain(copy.another)
    expect(html).toContain('href="/admin/payments"')
    expect(html).toContain(copy.toList)
    expect(html).not.toContain(copy.sendWhatsapp)
  })
})

describe("previewKey", () => {
  const input = {
    customerId: null,
    payerLabel: "",
    productId: "p",
    amountAgorot: 47200,
    paidOn: "2026-10-01",
    methodId: "m",
  }

  it("changes with every input of the preview", () => {
    const key = previewKey(input)
    expect(key).not.toBeNull()
    for (const change of [
      { customerId: "c" },
      { payerLabel: "Michal" },
      { productId: "q" },
      { amountAgorot: 44000 },
      { paidOn: "2026-10-02" },
      { methodId: "n" },
    ]) {
      expect(previewKey({ ...input, ...change })).not.toBe(key)
    }
  })

  it("is null without a readable amount, a product, a date or a method", () => {
    for (const change of [
      { amountAgorot: null },
      { productId: "" },
      { paidOn: "" },
      { methodId: "" },
    ]) {
      expect(previewKey({ ...input, ...change })).toBeNull()
    }
  })
})

describe("submitBlock", () => {
  it("blocks an unreadable amount first, then an unchecked similar payment", () => {
    expect(
      submitBlock({
        amountAgorot: null,
        hasSimilar: true,
        duplicateChecked: false,
      })
    ).toBe("amount")
    expect(
      submitBlock({
        amountAgorot: 0,
        hasSimilar: true,
        duplicateChecked: false,
      })
    ).toBe("duplicate")
    expect(
      submitBlock({ amountAgorot: 0, hasSimilar: true, duplicateChecked: true })
    ).toBeNull()
    expect(
      submitBlock({
        amountAgorot: 47200,
        hasSimilar: false,
        duplicateChecked: false,
      })
    ).toBeNull()
  })
})
