import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeading } from "@/components/shared/page-heading"
import { ResultNoticeHost } from "@/components/shared/result-notice"
import { StatusChip } from "@/components/shared/status-chip"
import { buttonClass } from "@/components/shared/button-class"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { PAYMENTS_LIMIT, toPaymentItem, type PaymentRow } from "./payment-items"
import { RefundsSection } from "./refunds-section"

const copy = adminCopy.paymentsList

export const metadata: Metadata = {
  title: copy.title,
}

// /admin/payments (story 2.5): "add payment", the links screen, the refund
// requests (story 3.9), and the 50 latest payments as rows with a divider (DESIGN › content-section-row).
// Filters, search, sums and "recent payments" on the home arrive in E4.
// Rendered inside the admin shell's <Suspense> gate.
export default function PaymentsPage() {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      {/* The links screen right under "הוספת תשלום" (user decision
          2026-10-08). */}
      <div className="flex flex-col items-start gap-1">
        <Link
          href="/admin/payments/new"
          className={buttonClass({
            size: "lg",
            className: "h-12 text-base",
          })}
        >
          {copy.add}
        </Link>
        <Link
          href="/admin/links"
          className="inline-flex min-h-11 items-center text-[15px] underline underline-offset-[3px]"
        >
          {adminCopy.payments.allLinks}
        </Link>
      </div>
      {/* Story 3.9: the open refund requests above the payments (user
          decisions 2026-10-13, 2026-10-14); the home and "לטיפול" link to a
          row here. The host keeps "ההחזר נרשם" on screen after the section
          disappears with its last open request. */}
      <ResultNoticeHost>
        <Suspense fallback={null}>
          <RefundsSection />
        </Suspense>
      </ResultNoticeHost>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <PaymentsContent />
      </Suspense>
    </>
  )
}

async function PaymentsContent() {
  const result = await callRpc(await createClient(), "admin_list_payments")
  if (!result.ok) throw new Error("admin_list_payments failed")
  const rows = result.data as unknown as PaymentRow[]

  if (rows.length === 0) {
    return <p className="text-base text-muted-foreground">{copy.empty}</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col">
        {rows.map((row) => {
          const item = toPaymentItem(row)
          const body = (
            <>
              <span className="flex items-start gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 text-base font-semibold break-words",
                    item.unbound && "text-muted-foreground",
                    item.href && "underline underline-offset-4"
                  )}
                >
                  <bdi>{item.title}</bdi>
                </span>
                {item.voided && (
                  <StatusChip tone="expired">{copy.voided}</StatusChip>
                )}
              </span>
              <span className="text-[15px]">
                <bdi>
                  {item.detailsBefore}
                  {item.voided ? (
                    <s className="text-muted-foreground">{item.amount}</s>
                  ) : (
                    item.amount
                  )}
                  {item.detailsAfter}
                </bdi>
              </span>
              {item.override && (
                <span className="text-[15px] text-warning">
                  <bdi>{item.override}</bdi>
                </span>
              )}
              {item.extra && (
                <span className="text-[13px] text-muted-foreground">
                  <bdi>{item.extra}</bdi>
                </span>
              )}
            </>
          )
          // Story 2.14 (user decision 2026-10-26): the whole row opens the
          // purchase page, where a void or a correction is made.
          return (
            <li
              key={item.paymentId}
              className="border-b border-border last:border-b-0"
            >
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex flex-col gap-1 rounded-[4px] py-4 transition-colors hover:bg-muted/60"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex flex-col gap-1 py-4">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
      {rows.length >= PAYMENTS_LIMIT && (
        <p className="text-[13px] text-muted-foreground">{copy.limit}</p>
      )}
    </div>
  )
}
