import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { CreditCard, ExhaustedCreditCard, RefundCard } from "./credit-cards"
import { parseMyCredits, type MyCredit } from "./credits"

const BASE = {
  credit_id: "c1",
  status: "active",
  party_size: 1,
  origin_starts_at: "2026-10-08T07:30:00Z",
  origin_concept_name: "Mothers",
  reserved_booking: null,
  options: [],
  waiting: false,
  exhausted: false,
  refund: null,
}

function credit(extra: Record<string, unknown>): MyCredit {
  return parseMyCredits([{ ...BASE, ...extra }])[0]
}

const CONTACT = "https://wa.me/972500000000"

describe("credit cards (story 3.7)", () => {
  it("a credit with options: its title, the line and a card per active option", () => {
    const html = renderToStaticMarkup(
      <CreditCard
        credit={credit({
          options: [
            {
              event_id: "e1",
              starts_at: "2026-10-12T07:30:00Z",
              concept_name: "Greek",
              state: "active",
            },
            {
              event_id: "e2",
              starts_at: "2026-10-15T07:30:00Z",
              concept_name: "Mothers",
              state: "used",
            },
          ],
        })}
        photos={new Map()}
      />
    )
    expect(html).toContain("זיכוי מהמפגש ב-08.10")
    expect(html).toContain(customerCopy.creditOptions)
    expect(html).toContain('href="/me/sessions/e1"')
    expect(html).not.toContain('href="/me/sessions/e2"')
    expect(html).not.toContain(customerCopy.creditWaiting)
  })

  it("a waiting credit: the waiting line, no option", () => {
    const html = renderToStaticMarkup(
      <CreditCard credit={credit({ waiting: true })} photos={new Map()} />
    )
    expect(html).toContain(customerCopy.creditWaiting)
    expect(html).not.toContain("/me/sessions/")
  })

  it("an exhausted credit: muted, its title, the line and the contact button", () => {
    const html = renderToStaticMarkup(
      <ExhaustedCreditCard
        credit={credit({ exhausted: true })}
        contactHref={CONTACT}
      />
    )
    expect(html).toContain("זיכוי מהמפגש ב-08.10")
    expect(html).toContain("המפגשים החלופיים עברו בלי הרשמה. אפשר לפנות אלינו")
    expect(html).toContain(`href="${CONTACT}"`)
    expect(html).toContain(customerCopy.contactPhrase)
    expect(html).toContain("bg-muted")
    expect(html).not.toContain(customerCopy.creditWaiting)
    // Without business details: no button.
    expect(
      renderToStaticMarkup(
        <ExhaustedCreditCard
          credit={credit({ exhausted: true })}
          contactHref={null}
        />
      )
    ).not.toContain(customerCopy.contactPhrase)
  })

  it("an open refund request: received, never done", () => {
    const html = renderToStaticMarkup(
      <RefundCard
        credit={credit({
          status: "refund_requested",
          refund: {
            amount_agorot: 12800,
            status: "requested",
            requested_at: "2026-10-10T07:00:00Z",
          },
        })}
      />
    )
    expect(html.replace(/\s/g, " ")).toContain("בקשת החזר של 128 ₪ התקבלה")
    expect(html).toContain(customerCopy.refundNote)
    expect(html).not.toContain("הוחזר")
  })
})
