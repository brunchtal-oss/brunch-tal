import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  balanceViews,
  cardHeader,
  detailRows,
  entryLines,
  historyHref,
  isOpenSingle,
  orderBalances,
  toBabyItems,
  toBalanceItem,
  toBookingItem,
  toNoteItem,
  toPaymentLine,
  toSingleItem,
  type CardEntitlement,
  type CardProfile,
} from "./card-items"

const copy = adminCopy.customers.card
const photo = adminCopy.photoConsents

const profile = (overrides: Partial<CardProfile> = {}): CardProfile => ({
  id: "c1",
  full_name: "רוני כהן",
  phone_e164: "+972541234567",
  email: "roni@example.test",
  // 05.10 in Jerusalem.
  activated_at: "2026-10-04T22:30:00Z",
  created_at: "2026-10-04T20:00:00Z",
  dietary_notes: "בלי גלוטן",
  photo_consent: true,
  photo_consent_at: "2026-10-04T22:30:00Z",
  personal_photo_consent: false,
  personal_photo_consent_at: null,
  last_activity_on: "2026-10-05",
  ...overrides,
})

const entitlement = (
  overrides: Partial<CardEntitlement> = {}
): CardEntitlement => ({
  entitlement_id: "e1",
  kind: "card",
  status: "active",
  product_name: "כרטיסייה",
  original_units: 4,
  available: 1,
  reserved: 1,
  used: 2,
  expires_on: "2026-10-30",
  is_expired: false,
  days_left: 20,
  is_expiring: false,
  is_used_up: false,
  pinned_event_id: null,
  entries: [],
  ...overrides,
})

// Mondays 12.10 and 19.10, Thursday 15.10, 10:00 in Jerusalem.
const MON_12 = "2026-10-12T07:00:00Z"
const THU_15 = "2026-10-15T07:00:00Z"
const MON_19 = "2026-10-19T07:00:00Z"

describe("the header and details", () => {
  it("the header: name, local phone, not activated", () => {
    expect(cardHeader(profile())).toEqual({
      name: "רוני כהן",
      phone: "054-123-4567",
      notActivated: false,
    })
    expect(
      cardHeader(profile({ phone_e164: null, activated_at: null }))
    ).toEqual({ name: "רוני כהן", phone: null, notActivated: true })
  })

  it("email, joined, last activity, diet and the photo consent as text", () => {
    expect(detailRows(profile())).toEqual([
      { label: copy.email, value: "roni@example.test", ltr: true },
      { label: copy.joined, value: "05.10.26" },
      { label: copy.lastActivity, value: "05.10.26" },
      { label: copy.dietary, value: "בלי גלוטן" },
      // Story 2.13: two lines, no date.
      {
        label: copy.photoConsent,
        value: [photo.atmosphere.yes, photo.personal.no],
      },
    ])
  })

  it("not activated, no activity, no diet, declines, no email", () => {
    expect(
      detailRows(
        profile({
          email: null,
          activated_at: null,
          last_activity_on: null,
          dietary_notes: "  ",
          photo_consent: false,
          photo_consent_at: null,
          personal_photo_consent: true,
          personal_photo_consent_at: "2026-10-04T22:30:00Z",
        })
      )
    ).toEqual([
      { label: copy.joined, value: copy.notActivatedYet },
      { label: copy.lastActivity, value: adminCopy.customers.noActivity },
      { label: copy.dietary, value: copy.none },
      {
        label: copy.photoConsent,
        value: [photo.atmosphere.no, photo.personal.yes],
      },
    ])
  })
})

describe("the balances", () => {
  it("cards first, then the rest, each by expiry", () => {
    const rows = [
      entitlement({
        entitlement_id: "s1",
        kind: "single",
        expires_on: "2026-10-10",
      }),
      entitlement({ entitlement_id: "c2", expires_on: "2026-11-30" }),
      entitlement({ entitlement_id: "c1", expires_on: "2026-10-20" }),
      entitlement({
        entitlement_id: "s0",
        kind: "single",
        expires_on: "2026-10-01",
      }),
    ]
    expect(orderBalances(rows).map((r) => r.entitlement_id)).toEqual([
      "c1",
      "c2",
      "s0",
      "s1",
    ])
  })

  it("one line per entry: used and booked by date, then each free entry", () => {
    const lines = entryLines(
      entitlement({
        entries: [
          {
            status: "confirmed",
            starts_at: MON_19,
            concept_name: "א",
            event_id: "e3",
          },
          {
            status: "completed",
            starts_at: MON_12,
            concept_name: "א",
            event_id: "e1",
          },
          {
            status: "completed",
            starts_at: THU_15,
            concept_name: "א",
            event_id: "e2",
          },
        ],
      })
    )
    expect(lines.map((l) => [l.kind, l.text])).toEqual([
      ["used", copy.entryUsed("יום שני 12.10")],
      ["used", copy.entryUsed("יום חמישי 15.10")],
      ["booked", copy.entryBooked("יום שני 19.10")],
      ["free", copy.entryFree],
    ])
    expect(new Set(lines.map((l) => l.key)).size).toBe(4)
  })

  it("an expired card's free entries read as not used", () => {
    expect(
      entryLines(entitlement({ is_expired: true, available: 2 })).map(
        (l) => l.text
      )
    ).toEqual([copy.entryUnused, copy.entryUnused])
    expect(entryLines(entitlement({ available: 0 }))).toEqual([])
  })

  it("the counts and validity from the server", () => {
    expect(toBalanceItem(entitlement())).toMatchObject({
      key: "e1",
      productName: "כרטיסייה",
      used: 2,
      reserved: 1,
      total: 4,
      meter: true,
      summary: copy.balanceSummary(2, 1, 1),
      until: copy.validUntil("30.10"),
      expiresOn: "2026-10-30",
      chip: null,
    })
  })

  it("a chip for expiring, expired, used up and cancelled", () => {
    expect(toBalanceItem(entitlement({ is_expiring: true })).chip).toEqual({
      tone: "warning",
      label: copy.expiring,
    })
    expect(toBalanceItem(entitlement({ is_expired: true })).chip).toEqual({
      tone: "expired",
      label: copy.expired,
    })
    expect(toBalanceItem(entitlement({ is_used_up: true })).chip).toEqual({
      tone: "expired",
      label: copy.usedUp,
    })
    expect(toBalanceItem(entitlement({ status: "refunded" })).chip).toEqual({
      tone: "expired",
      label: copy.cancelled,
    })
    expect(toBalanceItem(entitlement({ original_units: 20 })).meter).toBe(false)
  })
})

describe("single entitlements (second phone check)", () => {
  const single = (overrides: Partial<CardEntitlement> = {}) =>
    entitlement({
      entitlement_id: "s1",
      kind: "single",
      product_name: "כניסה בודדת",
      original_units: 1,
      available: 0,
      reserved: 1,
      used: 0,
      ...overrides,
    })

  it("shown only while not used: active, not expired, used 0", () => {
    expect(isOpenSingle(single())).toBe(true)
    expect(isOpenSingle(single({ kind: "couple" }))).toBe(true)
    expect(isOpenSingle(single({ kind: "intro" }))).toBe(true)
    expect(isOpenSingle(single({ used: 1, reserved: 0 }))).toBe(false)
    expect(isOpenSingle(single({ is_expired: true }))).toBe(false)
    expect(isOpenSingle(single({ status: "revoked" }))).toBe(false)
    expect(isOpenSingle(single({ status: "refunded" }))).toBe(false)
    expect(isOpenSingle(entitlement())).toBe(false)
  })

  it("its booked session (the earliest confirmed entry)", () => {
    expect(
      toSingleItem(
        single({
          entries: [
            {
              status: "confirmed",
              starts_at: MON_19,
              concept_name: "ב",
              event_id: "e2",
            },
            {
              status: "confirmed",
              starts_at: MON_12,
              concept_name: "אמהות",
              event_id: "e1",
            },
          ],
        })
      )
    ).toEqual({
      key: "s1",
      productName: "כניסה בודדת",
      line: copy.singleBooked("אמהות", "יום שני 12.10"),
      chip: null,
    })
    expect(copy.singleBooked("אמהות", "יום שני 12.10")).toBe(
      "בראנץ׳ אמהות · יום שני 12.10"
    )
  })

  it("with no booked session: to book, with its validity; expiring keeps its chip", () => {
    expect(
      toSingleItem(single({ reserved: 0, available: 1, is_expiring: true }))
    ).toEqual({
      key: "s1",
      productName: "כניסה בודדת",
      line: copy.singleToBook("30.10"),
      chip: { tone: "warning", label: copy.expiring },
    })
    expect(copy.singleToBook("30.10")).toBe("יש לשריין · בתוקף עד 30.10")
  })

  it("cards first (all of them, as before), then the open singles", () => {
    const views = balanceViews([
      single({ entitlement_id: "s-open", expires_on: "2026-10-05" }),
      single({ entitlement_id: "s-used", used: 1 }),
      entitlement({ entitlement_id: "c-expired", is_expired: true }),
      entitlement({ entitlement_id: "c1", expires_on: "2026-11-30" }),
    ])
    expect(views.map((v) => [v.variant, v.key])).toEqual([
      ["card", "c-expired"],
      ["card", "c1"],
      ["single", "s-open"],
    ])
  })
})

describe("the other parts", () => {
  it("babies with their age on the day", () => {
    expect(
      toBabyItems([{ name: "נועה", birth_date: "2026-09-01" }], "2026-10-07")
    ).toEqual([{ key: "0:נועה", name: "נועה", age: expect.any(String) }])
  })

  it("the history pages", () => {
    expect(historyHref("c1", "bookings")).toBe("/admin/customers/c1/bookings")
    expect(historyHref("c1", "purchases")).toBe("/admin/customers/c1/purchases")
  })

  it("a booking links to its session", () => {
    expect(
      toBookingItem({
        booking_id: "b1",
        event_id: "ev1",
        concept_name: "אמהות",
        starts_at: MON_12,
        status: "completed",
        party_size: 2,
        created_at: "2026-10-01T07:00:00Z",
      })
    ).toEqual({
      key: "b1",
      href: "/admin/sessions/ev1",
      title: "בראנץ׳ אמהות",
      when: expect.stringContaining("12.10 · 10:00"),
      startsAt: MON_12,
      status: copy.bookingStatus.completed,
      tone: "pending",
      couple: true,
    })
  })

  it("a purchase: the product, then amount, method and day", () => {
    expect(
      toPaymentLine({
        payment_id: "p1",
        product_name: "כרטיסייה",
        amount_agorot: 47200,
        paid_on: "2026-10-01",
        payment_method_name: "ביט",
        status: "approved",
      })
    ).toEqual({
      key: "p1",
      product: "כרטיסייה",
      detail: copy.purchaseDetail("472 ₪", "ביט", "01.10.26"),
      voided: false,
    })
  })

  it("a note with its local time", () => {
    expect(
      toNoteItem({ id: "n1", body: "הערה", created_at: "2026-10-04T22:30:00Z" })
    ).toEqual({ id: "n1", body: "הערה", when: "05.10.26, 01:30" })
  })
})
