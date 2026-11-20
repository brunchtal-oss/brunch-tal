import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"
import type { PaymentOutcome } from "@/lib/payments/checkout-cookie"

import { PaymentNotice, paymentNoticeOf, PendingNotice } from "./payment-notice"

const copy = customerCopy.purchase
const CONTACT = "https://wa.me/972500000000"
const CHECKOUT = "11111111-1111-4111-8111-111111111111"
const TAL = /(^|[\s>"(])טל($|[\s.,)<])/

const session = (payment: string): PaymentOutcome => ({
  payment,
  kind: "session",
})
const card = (payment: string): PaymentOutcome => ({ payment, kind: "card" })

describe("paymentNoticeOf", () => {
  it.each([
    ["failed", "warning", copy.notices.failed, false],
    ["expired", "warning", copy.notices.expired, false],
    ["issue", "info", copy.notices.issue, true],
    ["no_place", "info", copy.notices.no_place, true],
  ] as const)("session %s: %s, persistent", (payment, tone, text, contact) => {
    for (const surface of [
      "session",
      "home",
      "bookings",
      "purchases",
    ] as const) {
      expect(paymentNoticeOf(session(payment), surface)).toEqual({
        tone,
        text,
        contact,
      })
    }
  })

  it("a card: no seat, no registration", () => {
    expect(paymentNoticeOf(card("expired"), "purchases")?.text).toBe(
      "עבר הזמן לתשלום. אפשר להתחיל מחדש."
    )
    expect(paymentNoticeOf(card("issue"), "purchases")).toEqual({
      tone: "info",
      text: "התשלום התקבל. נחזור אלייך בקרוב כדי להשלים את הרכישה.",
      contact: true,
    })
    expect(paymentNoticeOf(card("failed"), "home")?.text).toBe(
      copy.notices.failed
    )
  })

  it("the exact session wording", () => {
    expect(copy.notices.failed).toBe(
      "התשלום לא הושלם ולא חויבת. אפשר לנסות שוב."
    )
    expect(copy.notices.expired).toBe(
      "עבר הזמן לתשלום והמקום שוחרר. אפשר להתחיל מחדש."
    )
    expect(copy.notices.issue).toBe(
      "התשלום התקבל. נחזור אלייך בקרוב כדי להשלים את ההרשמה."
    )
    expect(copy.notices.no_place).toBe(
      "התשלום התקבל, אבל המקום במפגש כבר נתפס. נחזור אלייך כדי לבחור מפגש אחר או החזר."
    )
  })

  it("paid: the booking or the card line by the page, nothing elsewhere", () => {
    expect(paymentNoticeOf(session("paid"), "bookings")?.text).toBe(
      "התשלום התקבל ונרשמת למפגש."
    )
    expect(paymentNoticeOf(card("paid"), "purchases")?.text).toBe(
      "התשלום התקבל והכרטיסייה נוספה לחשבון שלך."
    )
    expect(paymentNoticeOf(session("paid"), "session")).toBeNull()
  })

  it("review pass 2: not_found and review are neutral, with 'צרי קשר', never 'לא חויבת'", () => {
    for (const outcome of [session("not_found"), card("not_found")]) {
      expect(paymentNoticeOf(outcome, "session")).toEqual({
        tone: "info",
        text: "לא מצאנו תשלום על הרכישה הזו. אם חויבת, צרי קשר ונבדוק.",
        contact: true,
      })
    }
    expect(paymentNoticeOf(session("review"), "session")).toEqual({
      tone: "info",
      text: "נחזור אלייך בקרוב לגבי הרכישה.",
      contact: true,
    })
    expect(copy.notices.not_found).not.toContain("לא חויבת")
    expect(copy.notices.review).not.toContain("התשלום התקבל")
  })

  it("no outcome (no real return) or an unknown value: nothing", () => {
    expect(paymentNoticeOf(null, "session")).toBeNull()
    expect(paymentNoticeOf(session("whatever"), "session")).toBeNull()
  })
})

describe("PaymentNotice", () => {
  it("issue: the line and 'צרי קשר' to WhatsApp with the new-tab note, no 'טל'", () => {
    const html = renderToStaticMarkup(
      <PaymentNotice
        outcome={session("issue")}
        surface="session"
        contactHref={CONTACT}
      />
    )
    expect(html).toContain(copy.notices.issue)
    expect(html).toContain(`href="${CONTACT}"`)
    expect(html).toContain("צרי קשר")
    expect(html).toContain("(נפתח בחלון חדש)")
    expect(html).toContain('role="status"')
    expect(html).not.toMatch(TAL)
  })

  it("failed: no contact; nothing without an outcome", () => {
    const html = renderToStaticMarkup(
      <PaymentNotice
        outcome={session("failed")}
        surface="home"
        contactHref={CONTACT}
      />
    )
    expect(html).toContain(copy.notices.failed)
    expect(html).not.toContain(CONTACT)
    expect(
      renderToStaticMarkup(
        <PaymentNotice outcome={null} surface="home" contactHref={CONTACT} />
      )
    ).toBe("")
  })
})

describe("PendingNotice", () => {
  it("the sentence and 'לבדוק שוב' back to the return, no timer", () => {
    const html = renderToStaticMarkup(<PendingNotice checkoutId={CHECKOUT} />)
    expect(html).toContain("התשלום שלך בבדיקה. זה לוקח בדרך כלל דקה.")
    expect(html).toContain(`href="/pay/return?c=${CHECKOUT}"`)
    expect(html).toContain("לבדוק שוב")
    expect(html).not.toMatch(/\d+:\d\d/)
  })

  it("without a checkout id: the sentence alone", () => {
    const html = renderToStaticMarkup(<PendingNotice checkoutId={null} />)
    expect(html).toContain(copy.pending)
    expect(html).not.toContain("href")
  })
})
