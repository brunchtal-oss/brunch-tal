import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const { AtRiskList } = await import("./at-risk-list")
const { cancelImpactRows, eventRefusal, rescheduleRefusal } =
  await import("./session-cancel")
const { errorMessage } = await import("@/lib/errors")
const { rescheduleImpactRows } = await import("./edit/reschedule-dialog")
const {
  parseAtRisk,
  parseCancelEventPlan,
  parseNotified,
  parseRescheduleEventPlan,
} = await import("./event-plan")

const copy = adminCopy.sessions
const CUSTOMER = "44444444-4444-4444-8444-444444444444"

const AT_RISK = [
  {
    customer_id: CUSTOMER,
    customer_label: "Dana",
    product_name: "Card of 4",
    expires_on: "2026-10-22",
    reason: "no_session_before_expiry",
  },
  {
    customer_id: null,
    customer_label: "Noa",
    product_name: "Card of 4",
    expires_on: "2026-10-01",
    reason: "expired",
  },
  { customer_id: CUSTOMER, expires_on: "2026-10-22", reason: "other" },
]

describe("parseCancelEventPlan (story 3.8)", () => {
  it("maps the plan; an unknown reason is skipped", () => {
    expect(
      parseCancelEventPlan({
        ok: true,
        booking_count: 3,
        places: 4,
        card_count: 1,
        choice_count: 2,
        unbound_count: 1,
        at_risk: AT_RISK,
        parked: [
          { customer_id: CUSTOMER, customer_label: "Dana", payment_id: "p1" },
          { customer_id: null, customer_label: "Payer", payment_id: "p2" },
          { customer_label: "No payment" },
        ],
        title: "הבראנץ׳ של 20.10 בוטל",
        body: "Body",
      })
    ).toEqual({
      ok: true,
      bookingCount: 3,
      places: 4,
      cardCount: 1,
      choiceCount: 2,
      unboundCount: 1,
      atRisk: [
        {
          customerId: CUSTOMER,
          customerLabel: "Dana",
          productName: "Card of 4",
          expiresOn: "2026-10-22",
          reason: "no_session_before_expiry",
        },
        {
          customerId: null,
          customerLabel: "Noa",
          productName: "Card of 4",
          expiresOn: "2026-10-01",
          reason: "expired",
        },
      ],
      parked: [
        { customerId: CUSTOMER, customerLabel: "Dana", paymentId: "p1" },
        { customerId: null, customerLabel: "Payer", paymentId: "p2" },
      ],
      title: "הבראנץ׳ של 20.10 בוטל",
      body: "Body",
    })
  })

  it("a refusal keeps its code and field; an unknown code is SERVER_ERROR", () => {
    expect(
      parseCancelEventPlan({ ok: false, code: "EVENT_NOT_CANCELLABLE" })
    ).toEqual({ ok: false, code: "EVENT_NOT_CANCELLABLE", field: null })
    expect(
      parseRescheduleEventPlan({
        ok: false,
        code: "INVALID_INPUT",
        field: "start_time",
      })
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "start_time" })
    expect(parseCancelEventPlan({ ok: false, code: "NOPE" })).toEqual({
      ok: false,
      code: "SERVER_ERROR",
      field: null,
    })
    expect(parseAtRisk(null)).toEqual([])
    expect(parseNotified({ notified: 2 })).toBe(2)
    expect(parseNotified(null)).toBe(0)
  })

  it("maps the reschedule plan", () => {
    expect(
      parseRescheduleEventPlan({
        ok: true,
        starts_at: "2026-10-20T07:30:00Z",
        ends_at: "2026-10-20T09:30:00Z",
        new_starts_at: "2026-10-20T08:00:00Z",
        new_ends_at: "2026-10-20T10:00:00Z",
        booking_count: 10,
        at_risk: [],
        title: "T",
        body: "B",
      })
    ).toMatchObject({
      ok: true,
      newStartsAt: "2026-10-20T08:00:00Z",
      bookingCount: 10,
      atRisk: [],
    })
  })
})

describe("the dialogs' content (story 3.8)", () => {
  it("the cancel's impact rows show only the outcomes that have bookings", () => {
    const plan = parseCancelEventPlan({
      ok: true,
      booking_count: 2,
      places: 2,
      card_count: 2,
      choice_count: 0,
      unbound_count: 0,
      at_risk: [],
      title: "T",
      body: "B",
    })
    if (!plan.ok) throw new Error("plan")
    const rows = cancelImpactRows(plan, "Mothers", "2026-10-20T07:30:00Z")
    expect(rows.map((r) => r.label)).toEqual([
      copy.cancelEvent.session,
      copy.cancelEvent.bookings,
      copy.cancelEvent.cards,
    ])
    expect(rows[1].value).toBe(copy.cancelEvent.bookingsValue(2, 2))
  })

  it("the reschedule's rows: the old time, the new time and the bookings", () => {
    const plan = parseRescheduleEventPlan({
      ok: true,
      starts_at: "2026-10-20T07:30:00Z",
      ends_at: "2026-10-20T09:30:00Z",
      new_starts_at: "2026-10-20T08:00:00Z",
      new_ends_at: "2026-10-20T10:00:00Z",
      booking_count: 10,
      at_risk: [],
      title: "T",
      body: "B",
    })
    if (!plan.ok) throw new Error("plan")
    const html = renderToStaticMarkup(
      <dl>
        {rescheduleImpactRows(plan).map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    )
    expect(html).toContain("10:30")
    expect(html).toContain("11:00")
    expect(html).toContain(copy.reschedule.to)
  })

  it("the at-risk list: each customer with a link to her card, the product, expiry and reason", () => {
    const html = renderToStaticMarkup(
      <AtRiskList
        title={copy.atRisk.cancelTitle(2)}
        cards={parseAtRisk(AT_RISK)}
      />
    )
    expect(html).toContain(copy.atRisk.cancelTitle(2))
    expect(html).toContain(`href="/admin/customers/${CUSTOMER}"`)
    expect(html).toContain(copy.atRisk.line("Card of 4", "22.10"))
    expect(html).toContain(copy.atRisk.reason.no_session_before_expiry)
    expect(html).toContain(copy.atRisk.reason.expired)
    // No link without a customer.
    expect(html.match(/href=/g)).toHaveLength(1)
  })

  it("a refusal is worded for Tal only where lib/errors.ts speaks to the customer", () => {
    expect(eventRefusal("MANUAL_HANDLING_REQUIRED")).toBe(
      copy.eventRefusal.MANUAL_HANDLING_REQUIRED
    )
    expect(eventRefusal("EVENT_NOT_CANCELLABLE")).toBe(
      errorMessage("EVENT_NOT_CANCELLABLE")
    )
    expect(eventRefusal("CONCURRENT_CHANGE")).toBe(
      errorMessage("CONCURRENT_CHANGE")
    )
  })

  it("a refused time change says which field", () => {
    for (const field of [
      "event_id",
      "start_time",
      "end_time",
      "registration_closes_local",
    ]) {
      expect(rescheduleRefusal("INVALID_INPUT", field)).toBe(
        copy.reschedule.refusal[field]
      )
    }
    expect(rescheduleRefusal("INVALID_INPUT", null)).toBe(
      errorMessage("INVALID_INPUT")
    )
    expect(rescheduleRefusal("CONFIRM_REQUIRED", "start_time")).toBe(
      errorMessage("CONFIRM_REQUIRED")
    )
  })

  it("the done messages: no count when nobody was notified", () => {
    expect(copy.cancelEvent.done(0)).toBe("המפגש בוטל")
    expect(copy.cancelEvent.done(2)).toBe("המפגש בוטל ו-2 נרשמות קיבלו הודעה")
    expect(copy.reschedule.done(0)).toBe("המפגש הוזז")
    expect(copy.reschedule.done(10)).toBe("המפגש הוזז ו-10 נרשמות קיבלו הודעה")
  })
})
