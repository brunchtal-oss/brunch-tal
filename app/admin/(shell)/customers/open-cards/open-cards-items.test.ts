import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { entryLines } from "../[id]/card-items"
import {
  cardAnchor,
  expiringCardHref,
  filterHref,
  filterItems,
  parseFilter,
  toOpenCardItem,
  type OpenCardRow,
} from "./open-cards-items"

const copy = adminCopy.customers.openCards
const card = adminCopy.customers.card

// 10:00 Jerusalem time (UTC+3).
const MON_12 = "2026-10-12T07:00:00+00:00"
const THU_15 = "2026-10-15T07:00:00+00:00"
const MON_19 = "2026-10-19T07:00:00+00:00"

const row = (overrides: Partial<OpenCardRow> = {}): OpenCardRow => ({
  entitlement_id: "e1",
  customer_id: "11111111-1111-4111-8111-111111111111",
  customer_label: "רוני כהן",
  product_name: "כרטיסייה 4",
  paid_on: "2026-10-01",
  original_units: 4,
  available: 1,
  reserved: 1,
  used: 2,
  expires_on: "2026-11-19",
  days_left: 37,
  is_expiring: false,
  entries: [
    {
      status: "confirmed",
      starts_at: MON_19,
      concept_name: "אמהות",
      event_id: "s3",
    },
    {
      status: "completed",
      starts_at: MON_12,
      concept_name: "אמהות",
      event_id: "s1",
    },
    {
      status: "completed",
      starts_at: THU_15,
      concept_name: "אמהות",
      event_id: "s2",
    },
  ],
  ...overrides,
})

describe("open cards items", () => {
  it("story 3.13: the extension marker and the card's page, also for a purchase not bound yet", () => {
    expect(toOpenCardItem(row({ is_extended: true })).extended).toBe(true)
    expect(toOpenCardItem(row()).extended).toBe(false)
    expect(toOpenCardItem(row()).detailsHref).toBe(
      "/admin/customers/11111111-1111-4111-8111-111111111111/entitlements/e1"
    )
    expect(toOpenCardItem(row({ customer_id: null })).detailsHref).toBe(
      "/admin/customers/unbound/entitlements/e1"
    )
  })

  it("?filter=: the three filters; anything else (or none) is all", () => {
    expect(parseFilter({ filter: "available" })).toBe("available")
    expect(parseFilter({ filter: "expiring" })).toBe("expiring")
    expect(parseFilter({ filter: ["expiring", "all"] })).toBe("expiring")
    expect(parseFilter({ filter: "x" })).toBe("all")
    expect(parseFilter({})).toBe("all")
  })

  it("the filter links: one current, all without a query", () => {
    expect(filterHref("all")).toBe("/admin/customers/open-cards")
    expect(filterItems("available")).toEqual([
      {
        key: "all",
        href: "/admin/customers/open-cards",
        label: "הכול",
        current: false,
      },
      {
        key: "available",
        href: "/admin/customers/open-cards?filter=available",
        label: "יש כניסות פנויות",
        current: true,
      },
      {
        key: "expiring",
        href: "/admin/customers/open-cards?filter=expiring",
        label: "עומדת לפוג",
        current: false,
      },
    ])
  })

  it("the home's target: the expiring list at the card's anchor", () => {
    expect(cardAnchor("e1")).toBe("card-e1")
    expect(expiringCardHref("e1")).toBe(
      "/admin/customers/open-cards?filter=expiring#card-e1"
    )
  })

  it("a row: name, product, bought, valid until, the card's entry lines and two buttons", () => {
    const r = row()
    const item = toOpenCardItem(r)
    expect(item).toMatchObject({
      key: "e1",
      anchor: "card-e1",
      name: "רוני כהן",
      productName: "כרטיסייה 4",
      purchased: "נרכשה 01.10",
      until: "בתוקף עד 19.11",
      chip: null,
      bookHref:
        "/admin/sessions/book?customer=11111111-1111-4111-8111-111111111111",
      profileHref: "/admin/customers/11111111-1111-4111-8111-111111111111",
    })
    // The same lines as the customer card.
    expect(item.entries).toEqual(entryLines({ ...r, is_expired: false }))
    expect(item.entries.map((l) => [l.kind, l.text, l.title])).toEqual([
      ["used", card.entryUsed("יום שני 12.10"), "בראנץ׳ אמהות"],
      ["used", card.entryUsed("יום חמישי 15.10"), "בראנץ׳ אמהות"],
      ["booked", card.entryBooked("יום שני 19.10"), "בראנץ׳ אמהות"],
      ["free", "פנויה, יש לשריין", null],
    ])
  })

  it("expiring: the warning chip", () => {
    expect(toOpenCardItem(row({ is_expiring: true })).chip).toEqual({
      tone: "warning",
      label: "עומדת לפוג",
    })
  })

  it("a purchase not bound yet: the payer's label, no buttons", () => {
    expect(
      toOpenCardItem(row({ customer_id: null, customer_label: "מיכל (משלמת)" }))
    ).toMatchObject({
      name: "מיכל (משלמת)",
      bookHref: null,
      profileHref: null,
    })
    expect(
      toOpenCardItem(row({ customer_id: null, customer_label: null })).name
    ).toBe(adminCopy.home.newCustomer)
  })

  it("the copy of the screen", () => {
    expect(copy.empty).toBe("אין כרטיסיות פתוחות כרגע")
    expect(copy.showAll).toBe("להצגת כל הכרטיסיות")
    expect(copy.book).toBe("לרישום למפגש")
    expect(copy.profile).toBe("לפרופיל")
    expect(copy.notJoined).toBe("עוד לא הצטרפה")
  })
})
