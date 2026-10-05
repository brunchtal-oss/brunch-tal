import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { formatDayMonth, formatTime, formatWeekday } from "@/lib/time"

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
        customerId="c1"
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

  it("after a card, leads on to booking her for a date (story 3.4)", () => {
    const html = renderToStaticMarkup(
      <ApprovedPurchase
        customerId="c1"
        customerName="Dana"
        productName="Card"
        units={4}
        expiresOn="2026-11-19"
      />
    )
    expect(html).toContain('href="/admin/sessions/book?customer=c1"')
    expect(html).toContain(adminCopy.sessions.bookForDate)
  })

  it("has no booking link after a pinned product (its place is kept)", () => {
    const html = renderToStaticMarkup(
      <ApprovedPurchase
        customerId="c1"
        customerName="Dana"
        productName="Single"
        units={1}
        expiresOn="2026-10-12"
        placed={{
          productName: "Single",
          conceptName: "Mothers",
          startsAt: "2026-10-12T07:00:00Z",
        }}
      />
    )
    expect(html).not.toContain(adminCopy.sessions.bookForDate)
  })
})

describe("a pinned product's success screens (story 3.11)", () => {
  const placed = {
    productName: "Single",
    conceptName: "Mothers",
    startsAt: "2026-10-12T07:00:00Z",
  }
  const lead = copy.successPlacedLead("Single")
  // Monday 12.10, no time (user decision 2026-10-05).
  const session = copy.successPlacedSession(
    "Mothers",
    `${formatWeekday(placed.startsAt)} ${formatDayMonth(placed.startsAt)}`
  )

  it("names the session instead of the entries for an existing customer", () => {
    const html = renderToStaticMarkup(
      <ApprovedPurchase
        customerId="c1"
        customerName="Dana"
        productName="Single"
        units={1}
        expiresOn="2026-10-12"
        placed={placed}
      />
    )
    expect(html).toContain(lead)
    expect(html).toContain(`${lead}</bdi><br/><bdi>${session}`)
    expect(html).not.toContain(formatTime(placed.startsAt))
    expect(html).not.toContain(copy.successPurchase("Single", 1, "12.10"))
  })

  it("names the session under the link for a new customer", () => {
    const html = renderToStaticMarkup(
      <ApprovedLink
        link="https://host.example/join/abc"
        linkExpiresAt={EXPIRES}
        placed={placed}
      />
    )
    expect(html).toContain(lead)
    expect(html).toContain(`${lead}</bdi><br/><bdi>${session}`)
    expect(html).not.toContain(formatTime(placed.startsAt))
  })

  it("a days product's link screen names no session", () => {
    const html = renderToStaticMarkup(
      <ApprovedLink
        link="https://host.example/join/abc"
        linkExpiresAt={EXPIRES}
      />
    )
    // "המקום נשמר", the fixed words of the line.
    const kept = copy.successPlacedLead("P").split(":")[0].split(" · ")[1]
    expect(html).not.toContain(kept)
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
      { eventId: "e" },
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
    // A new customer without a payer name comes first (user decision
    // 2026-10-05).
    expect(
      submitBlock({
        payerMissing: true,
        amountAgorot: null,
        eventMissing: true,
        hasSimilar: true,
        duplicateChecked: false,
      })
    ).toBe("payer")
    // A pinned product without its session (story 3.11), after the amount.
    expect(
      submitBlock({
        amountAgorot: 0,
        eventMissing: true,
        hasSimilar: true,
        duplicateChecked: false,
      })
    ).toBe("event")
    expect(
      submitBlock({
        amountAgorot: null,
        eventMissing: true,
        hasSimilar: false,
        duplicateChecked: false,
      })
    ).toBe("amount")
    expect(
      submitBlock({
        amountAgorot: 47200,
        hasSimilar: false,
        duplicateChecked: false,
      })
    ).toBeNull()
  })
})
