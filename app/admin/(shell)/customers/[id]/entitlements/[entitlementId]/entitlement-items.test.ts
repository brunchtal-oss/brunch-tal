import { describe, expect, it } from "vitest"

import {
  fieldEditable,
  correctionRefusal,
  meterTotal,
  correctionValue,
  draftOf,
  entitlementHref,
  formatFieldValue,
  historyItems,
  impactValues,
  parseCorrectionPlan,
  segmentMatches,
  sensitiveOf,
  sessionOptions,
  termRows,
  weekLine,
  canVoid,
  parseVoidPlan,
  showsBalance,
  voidBookingLine,
  voidLines,
  voidNotificationLines,
  type EntitlementPage,
} from "./entitlement-items"

const ID = "11111111-1111-4111-8111-111111111111"
const CUSTOMER = "22222222-2222-4222-8222-222222222222"
const EVENT = "33333333-3333-4333-8333-333333333333"

const PAGE: EntitlementPage = {
  entitlement_id: ID,
  payment_id: "44444444-4444-4444-8444-444444444444",
  payment_status: "approved",
  voided_at: null,
  void_reason: null,
  customer_id: CUSTOMER,
  customer_label: "Noa",
  product_name: "כרטיסייה 4",
  kind: "card",
  status: "active",
  correctable: true,
  paid_on: "2026-10-01",
  original_units: 4,
  available: 2,
  reserved: 1,
  used: 1,
  valid_from: "2026-10-01",
  expires_on: "2026-11-15",
  is_expired: false,
  allowed_weekdays: null,
  eligible_event_kind: "regular",
  is_extended: true,
  entries: [],
  bookings: [
    {
      booking_id: "b1",
      event_id: EVENT,
      concept_name: "שישי מיוחד",
      starts_at: "2026-10-16T07:00:00Z",
      status: "confirmed",
    },
    {
      booking_id: "b0",
      event_id: EVENT,
      concept_name: "שישי מיוחד",
      starts_at: "2026-10-16T07:00:00Z",
      status: "cancelled",
    },
  ],
  corrections: [
    {
      correction_id: "c2",
      field: "allowed_weekdays",
      old_value: null,
      new_value: [0, 2],
      reason: "  ביקשה ימי ראשון ושלישי ",
      actor_kind: "admin",
      created_at: "2026-10-12T07:00:00Z",
      related_event_id: null,
      related_concept_name: null,
      related_starts_at: null,
      week_start: null,
    },
    {
      correction_id: "c1",
      field: "units",
      old_value: 3,
      new_value: 2,
      reason: null,
      actor_kind: "admin",
      created_at: "2026-10-11T07:00:00Z",
      related_event_id: EVENT,
      related_concept_name: "שישי מיוחד",
      related_starts_at: "2026-10-16T07:00:00Z",
      week_start: null,
    },
  ],
}

describe("formatFieldValue", () => {
  it("words each field; unexpected values read —", () => {
    expect(formatFieldValue("expires_on", "2026-11-15")).toBe("15.11.26")
    expect(formatFieldValue("units", 0)).toBe("0")
    expect(formatFieldValue("allowed_weekdays", null)).toBe("כל הימים")
    expect(formatFieldValue("allowed_weekdays", [2, 0])).toBe("ראשון, שלישי")
    expect(formatFieldValue("allowed_weekdays", [0, 1, 2, 3, 4, 5, 6])).toBe(
      "כל הימים"
    )
    expect(formatFieldValue("eligible_event_kind", "couple")).toBe("זוגי")
    expect(formatFieldValue("expires_on", 7)).toBe("—")
    expect(formatFieldValue("other", "x")).toBe("—")
  })
})

describe("the page", () => {
  it("terms: four rows, the expiry with (כולל הארכה)", () => {
    const rows = termRows(PAGE)
    expect(rows.map((r) => r.field)).toEqual([
      "expires_on",
      "units",
      "allowed_weekdays",
      "eligible_event_kind",
    ])
    expect(rows[0]).toMatchObject({ value: "15.11.26", note: "(כולל הארכה)" })
    expect(rows[1]).toMatchObject({ value: "2", note: null })
    expect(rows[2].value).toBe("כל הימים")
    expect(termRows({ ...PAGE, is_extended: false })[0].note).toBeNull()
  })

  it("history: was / now, never an arrow; who and when; the reason trimmed; the related session", () => {
    const items = historyItems(PAGE)
    expect(items[0].change).toBe("ימים: היה כל הימים, עכשיו ראשון, שלישי")
    expect(items[0].who).toBe("טל, 12.10.26")
    expect(items[0].reason).toBe("סיבה: ביקשה ימי ראשון ושלישי")
    expect(items[0].session).toBeNull()
    expect(items[1].change).toBe("כניסות פנויות: היה 3, עכשיו 2")
    expect(items[1].reason).toBeNull()
    expect(items[1].session).toMatch(/^מפגש: /)
    for (const item of items) expect(item.change).not.toContain("←")
  })

  it("history: an automatic extension reads its own line, its week and the system", () => {
    const items = historyItems({
      ...PAGE,
      corrections: [
        {
          correction_id: "c3",
          field: "expires_on",
          old_value: "2026-11-08",
          new_value: "2026-11-15",
          reason: null,
          actor_kind: "system",
          created_at: "2026-10-19T07:00:00Z",
          related_event_id: null,
          related_concept_name: null,
          related_starts_at: null,
          week_start: "2026-10-11",
        },
      ],
    })
    expect(items[0]).toMatchObject({
      change: "הארכה אוטומטית: היה 08.11.26, עכשיו 15.11.26",
      week: "שבוע 11.10–17.10 בלי בראנץ׳ מתאים",
      who: "המערכת, 19.10.26",
      reason: null,
      session: null,
    })
    expect(items[0].change).not.toContain("←")
    // A system correction without a week reads as a regular one.
    const plain = historyItems({
      ...PAGE,
      corrections: [
        {
          correction_id: "c4",
          field: "units",
          old_value: 3,
          new_value: 2,
          reason: null,
          actor_kind: "system",
          created_at: "2026-10-19T07:00:00Z",
          related_event_id: null,
          related_concept_name: null,
          related_starts_at: null,
          week_start: null,
        },
      ],
    })
    expect(plain[0]).toMatchObject({
      change: "כניסות פנויות: היה 3, עכשיו 2",
      week: null,
      who: "המערכת, 19.10.26",
    })
    // Tal's corrections have no week line.
    expect(historyItems(PAGE).every((item) => item.week === null)).toBe(true)
    expect(weekLine("2026-02-30")).toBeNull()
    expect(weekLine(null)).toBeNull()
    // Across a month.
    expect(weekLine("2026-12-27")).toBe("שבוע 27.12–02.01 בלי בראנץ׳ מתאים")
  })

  it("the session picker lists each session once", () => {
    expect(sessionOptions(PAGE)).toHaveLength(1)
    expect(sessionOptions(PAGE)[0].value).toBe(EVENT)
  })

  it("href and the URL's customer segment (unbound for a purchase not bound yet)", () => {
    expect(entitlementHref(CUSTOMER, ID)).toBe(
      `/admin/customers/${CUSTOMER}/entitlements/${ID}`
    )
    expect(entitlementHref(null, ID)).toBe(
      `/admin/customers/unbound/entitlements/${ID}`
    )
    expect(segmentMatches(CUSTOMER, PAGE)).toBe(true)
    expect(segmentMatches("unbound", PAGE)).toBe(false)
    expect(segmentMatches("unbound", { ...PAGE, customer_id: null })).toBe(true)
    expect(segmentMatches(CUSTOMER, { ...PAGE, customer_id: null })).toBe(false)
  })

  it("sensitive keys: expiry, balance, and the terms for weekdays and kind", () => {
    expect(sensitiveOf("expires_on")).toBe("entitlement_expiry")
    expect(sensitiveOf("units")).toBe("entitlement_units")
    expect(sensitiveOf("allowed_weekdays")).toBe("entitlement_terms")
    expect(sensitiveOf("eligible_event_kind")).toBe("entitlement_terms")
  })
})

describe("correctionValue", () => {
  const draft = draftOf(PAGE)

  it("starts from the current values; every day for null", () => {
    expect(draft).toEqual({
      expiresOn: "2026-11-15",
      units: "2",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      kind: "regular",
    })
  })

  it("units: a whole number >= 0; anything else is not ready", () => {
    expect(correctionValue("units", { ...draft, units: " 0 " })).toEqual({
      ready: true,
      value: 0,
    })
    expect(correctionValue("units", { ...draft, units: "99" })).toEqual({
      ready: true,
      value: 99,
    })
    for (const units of ["", "-1", "1.5", "abc", "100"]) {
      expect(correctionValue("units", { ...draft, units }).ready, units).toBe(
        false
      )
    }
  })

  it("weekdays: sorted, all seven is null (every day), none is not ready", () => {
    expect(
      correctionValue("allowed_weekdays", { ...draft, weekdays: [3, 0, 3] })
    ).toEqual({ ready: true, value: [0, 3] })
    expect(correctionValue("allowed_weekdays", draft)).toEqual({
      ready: true,
      value: null,
    })
    expect(
      correctionValue("allowed_weekdays", { ...draft, weekdays: [] }).ready
    ).toBe(false)
  })

  it("expiry and kind", () => {
    expect(correctionValue("expires_on", draft)).toEqual({
      ready: true,
      value: "2026-11-15",
    })
    expect(
      correctionValue("expires_on", { ...draft, expiresOn: "" }).ready
    ).toBe(false)
    expect(
      correctionValue("eligible_event_kind", { ...draft, kind: "couple" })
    ).toEqual({ ready: true, value: "couple" })
    expect(
      correctionValue("eligible_event_kind", { ...draft, kind: "x" }).ready
    ).toBe(false)
  })
})

describe("parseCorrectionPlan", () => {
  it("a plan: before / after and the affected bookings", () => {
    const plan = parseCorrectionPlan({
      ok: true,
      entitlement_id: ID,
      customer_label: "Noa",
      field: "allowed_weekdays",
      old_value: null,
      new_value: [0],
      available: 2,
      affected: [
        {
          booking_id: "b1",
          event_id: EVENT,
          starts_at: "2026-10-20T07:00:00Z",
          concept_name: "שישי מיוחד",
        },
      ],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(impactValues(plan)).toEqual({ before: "כל הימים", after: "ראשון" })
    expect(plan.affected).toEqual([
      {
        bookingId: "b1",
        eventId: EVENT,
        startsAt: "2026-10-20T07:00:00Z",
        conceptName: "שישי מיוחד",
      },
    ])
  })

  it("a refusal keeps its code and field; an unknown code is SERVER_ERROR", () => {
    expect(
      parseCorrectionPlan({ ok: false, code: "INVALID_INPUT", field: "units" })
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "units" })
    expect(parseCorrectionPlan({ ok: false, code: "NOT_A_CARD" })).toEqual({
      ok: false,
      code: "NOT_A_CARD",
      field: null,
    })
    expect(parseCorrectionPlan({ ok: false, code: "WHAT" })).toMatchObject({
      code: "SERVER_ERROR",
    })
    expect(parseCorrectionPlan(null)).toMatchObject({ ok: false })
  })

  it("refusal wording by field, NO_CHANGE in the page's words, others to lib/errors", () => {
    expect(correctionRefusal("INVALID_INPUT", "units")).toBe(
      "מספר הכניסות צריך להיות מספר שלם בין 0 ל-99"
    )
    expect(correctionRefusal("NO_CHANGE", null)).toBe("זה כבר הערך הנוכחי")
    expect(correctionRefusal("INVALID_INPUT", "unknown")).toBeNull()
    expect(correctionRefusal("NOT_A_CARD", null)).toBeNull()
  })
})

describe("review fixes", () => {
  it("a card's event kind is never editable; other fields are", () => {
    expect(fieldEditable("eligible_event_kind", "card")).toBe(false)
    expect(fieldEditable("eligible_event_kind", "intro")).toBe(true)
    expect(fieldEditable("expires_on", "card")).toBe(true)
  })

  it("the meter's total follows the balance, not original_units", () => {
    expect(meterTotal({ used: 1, reserved: 1, available: 0 })).toBe(2)
    expect(meterTotal({ used: 1, reserved: 1, available: 3 })).toBe(5)
    expect(meterTotal({ used: 0, reserved: 0, available: -1 })).toBe(0)
  })
})

describe("purchase void (story 2.14)", () => {
  const PLAN = {
    ok: true,
    payment_id: "44444444-4444-4444-8444-444444444444",
    entitlement_id: ID,
    kind: "card",
    customer_id: CUSTOMER,
    customer_label: "  ",
    product_name: "כרטיסייה 4",
    amount_agorot: 47200,
    paid_on: "2026-10-01",
    link_will_be_revoked: false,
    bookings: [
      {
        booking_id: "b1",
        event_id: EVENT,
        starts_at: "2026-10-16T07:00:00Z",
        concept_name: "שישי מיוחד",
        party_size: 2,
        guest_details: " Dana ",
      },
      {
        booking_id: "b2",
        event_id: EVENT,
        starts_at: "2026-10-23T07:00:00Z",
        concept_name: "שישי מיוחד",
        party_size: 1,
        guest_details: null,
      },
    ],
  }

  it("a voided purchase shows no balance (meter, summary, entries)", () => {
    expect(showsBalance(PAGE)).toBe(true)
    expect(showsBalance({ payment_status: "approved" })).toBe(true)
    expect(showsBalance({ ...PAGE, payment_status: "voided" })).toBe(false)
  })

  it("the section shows only for an approved payment and an active entitlement", () => {
    expect(canVoid(PAGE)).toBe(true)
    expect(canVoid({ ...PAGE, status: "revoked" })).toBe(false)
    expect(canVoid({ ...PAGE, payment_status: "voided" })).toBe(false)
  })

  it("a voided purchase: its date and its reason, when given", () => {
    expect(voidLines(PAGE)).toBeNull()
    expect(
      voidLines({
        ...PAGE,
        payment_status: "voided",
        voided_at: "2026-10-26T08:00:00Z",
        void_reason: "  לקוחה לא נכונה ",
      })
    ).toEqual({
      on: "הרכישה בוטלה ב-26.10.26",
      at: "2026-10-26T08:00:00Z",
      reason: "סיבה: לקוחה לא נכונה",
    })
    expect(
      voidLines({
        ...PAGE,
        payment_status: "voided",
        voided_at: "2026-10-26T08:00:00Z",
        void_reason: " ",
      })?.reason
    ).toBeNull()
  })

  it("parses the plan; a couple booking reads זוגית with the partner", () => {
    const plan = parseVoidPlan(PLAN)
    expect(plan).toMatchObject({
      ok: true,
      kind: "card",
      customerLabel: "לקוחה חדשה",
      amountAgorot: 47200,
      linkWillBeRevoked: false,
    })
    if (!plan.ok) throw new Error("plan")
    expect(plan.bookings).toHaveLength(2)
    expect(voidBookingLine(plan.bookings[0]).couple).toBe("זוגית, Dana")
    expect(voidBookingLine(plan.bookings[1]).couple).toBeNull()
    expect(voidBookingLine(plan.bookings[1]).session).toContain("שישי מיוחד")
    expect(parseVoidPlan({ ok: false, code: "PURCHASE_ENTRY_USED" })).toEqual({
      ok: false,
      code: "PURCHASE_ENTRY_USED",
    })
    expect(parseVoidPlan({ ok: false, code: "WHAT" })).toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })

  it("the notification lines: the card line only for a card with bookings", () => {
    const none = "הלקוחה לא תקבל התראה"
    const tell = "כבר בוצע רישום בכרטיסייה, יש לעדכן את הלקוחה על הביטול"
    const booking = parseVoidPlan(PLAN)
    if (!booking.ok) throw new Error("plan")
    expect(voidNotificationLines(booking)).toEqual([none, tell])
    expect(voidNotificationLines({ kind: "card", bookings: [] })).toEqual([
      none,
    ])
    for (const kind of ["single", "intro", "couple"]) {
      expect(
        voidNotificationLines({ kind, bookings: booking.bookings })
      ).toEqual([none])
    }
  })
})
