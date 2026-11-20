import { InlineNotice } from "@/components/shared/inline-notice"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import type { PaymentOutcome } from "@/lib/payments/checkout-cookie"

const copy = customerCopy.purchase

// The outcome of an online payment, after the return or failure route sent
// her here with ?payment=<value> (spec-online-payments-grow-b.md). Shown
// only for a real return: the page passes the outcome read with
// readPaymentOutcome (lib/payments/payment-outcome.ts), which needs the
// one-minute outcome cookie to match the parameter, so a forged link shows
// nothing. A persistent inline-notice, never a toast; it stays until she
// leaves the page. A card gets its own wording (no seat, no registration).

export type PaymentSurface = "session" | "home" | "bookings" | "purchases"

export type PaymentNoticeView = {
  tone: "success" | "warning" | "info"
  text: string
  // "צרי קשר" after it (issue, no_place).
  contact: boolean
}

export function paymentNoticeOf(
  outcome: PaymentOutcome | null,
  surface: PaymentSurface
): PaymentNoticeView | null {
  if (!outcome) return null
  const card = outcome.kind === "card"
  switch (outcome.payment) {
    case "failed":
      return { tone: "warning", text: copy.notices.failed, contact: false }
    case "expired":
      return {
        tone: "warning",
        text: card ? copy.notices.expiredCard : copy.notices.expired,
        contact: false,
      }
    case "issue":
      return {
        tone: "info",
        text: card ? copy.notices.issueCard : copy.notices.issue,
        contact: true,
      }
    case "no_place":
      return { tone: "info", text: copy.notices.no_place, contact: true }
    case "not_found":
      return { tone: "info", text: copy.notices.not_found, contact: true }
    case "review":
      return { tone: "info", text: copy.notices.review, contact: true }
    case "paid":
      // A known customer's paid return: her bookings or her purchases.
      if (surface === "bookings") {
        return {
          tone: "success",
          text: copy.notices.paidBooking,
          contact: false,
        }
      }
      if (surface === "purchases") {
        return { tone: "success", text: copy.notices.paidCard, contact: false }
      }
      return null
    default:
      return null
  }
}

export function PaymentNotice({
  outcome,
  surface,
  contactHref,
  className,
}: {
  outcome: PaymentOutcome | null
  surface: PaymentSurface
  contactHref: string | null
  className?: string
}) {
  const view = paymentNoticeOf(outcome, surface)
  if (!view) return null
  return (
    <InlineNotice
      tone={view.tone}
      className={className}
      actions={
        view.contact && contactHref ? (
          <a
            href={contactHref}
            target="_blank"
            rel="noopener noreferrer"
            className="py-3 font-semibold underline underline-offset-[3px]"
          >
            {copy.contact}
            <span className="sr-only">
              {" "}
              {shellCopy.public.contact.opensOutside}
            </span>
          </a>
        ) : undefined
      }
    >
      {view.text}
    </InlineNotice>
  )
}

/** /pay/pending: the sentence, and "לבדוק שוב" for a valid checkout id. */
export function PendingNotice({ checkoutId }: { checkoutId: string | null }) {
  return (
    <InlineNotice
      tone="info"
      actions={
        checkoutId ? (
          // A route handler, not a page: a plain link, never prefetched.
          <a
            href={`/pay/return?c=${encodeURIComponent(checkoutId)}`}
            className="py-3 font-semibold underline underline-offset-[3px]"
          >
            {copy.checkAgain}
          </a>
        ) : undefined
      }
    >
      {copy.pending}
    </InlineNotice>
  )
}
