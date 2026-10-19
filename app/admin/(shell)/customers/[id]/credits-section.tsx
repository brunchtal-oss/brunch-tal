import { ResultNoticeHost } from "@/components/shared/result-notice"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"

import { RefundComplete } from "../../payments/refund-complete"
import type { CustomerCreditItem } from "./credit-items"
import { CreditManage } from "./credit-manage"

const copy = adminCopy.customers.card.credits

// The body of "זיכויים והחזרים" on the customer card (story 3.9), after
// the balances: one muted plate per credit, newest first, like the single
// plates above it: the cancelled session and its chip (זיכוי פעיל / נוצל /
// ממתינה לבחירה / בקשת החזר / הוחזר), one line, the reference of a
// refund, and "סימון שההחזר בוצע" on an open request (the same dialog as
// /admin/payments). The host stays mounted across the refresh (the credit
// stays in the list, now refunded), so "ההחזר נרשם" stays on screen.
// Story 3.16: an active credit also lists its alternatives and offers
// "שינוי חלופות" and "החזר במקום זיכוי" (CreditManage), or says why not.
// The plate's id is the booking history's "לזיכוי" target.
export function CreditsSection({
  items,
  customerName,
}: {
  items: readonly CustomerCreditItem[]
  customerName: string
}) {
  return (
    <ResultNoticeHost>
      {items.length === 0 ? (
        <p className="text-base text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.key}
              id={`credit-${item.key}`}
              className="flex flex-col gap-1 rounded-lg bg-muted p-4"
            >
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-[17px] leading-[1.35] font-semibold">
                  <bdi className="break-words">{item.title}</bdi>
                  {item.couple && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {copy.couple}
                    </span>
                  )}
                </p>
                <StatusChip tone={item.chip.tone} className="mt-0.5">
                  {item.chip.label}
                </StatusChip>
              </div>
              <p className="text-[15px] text-muted-foreground">
                <bdi>{item.line}</bdi>
              </p>
              {item.reference && (
                <p className="text-[13px] text-muted-foreground">
                  <bdi>{item.reference}</bdi>
                </p>
              )}
              {item.options.length > 0 && (
                <div className="flex flex-col gap-1 pt-2">
                  <p className="text-[13px] text-muted-foreground">
                    {copy.optionsTitle}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {item.options.map((option) => (
                      <li key={option.key} className="text-base">
                        <time dateTime={option.startsAt}>
                          <bdi>{option.line}</bdi>
                        </time>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {item.manage && (
                <CreditManage
                  creditId={item.key}
                  title={item.title}
                  customerName={customerName}
                  manage={item.manage}
                />
              )}
              {item.openRefundId && (
                <div className="pt-2">
                  <RefundComplete
                    refundRequestId={item.openRefundId}
                    name={customerName}
                    pendingJoin={false}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </ResultNoticeHost>
  )
}
