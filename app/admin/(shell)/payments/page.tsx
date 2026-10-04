import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeading } from "@/components/shared/page-heading"
import { buttonVariants } from "@/components/ui/button"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { PAYMENTS_LIMIT, toPaymentItem, type PaymentRow } from "./payment-items"

const copy = adminCopy.paymentsList

export const metadata: Metadata = {
  title: copy.title,
}

// /admin/payments (story 2.5): "add payment", the links screen, and the 50
// latest payments as rows with a divider (DESIGN › content-section-row).
// Filters, search, sums and "recent payments" on the home arrive in E4.
// Rendered inside the admin shell's <Suspense> gate.
export default function PaymentsPage() {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link
          href="/admin/payments/new"
          className={buttonVariants({
            size: "lg",
            className: "h-12 text-base",
          })}
        >
          {copy.add}
        </Link>
        <Link
          href="/admin/links"
          className="inline-flex min-h-11 items-center text-[15px] underline underline-offset-4"
        >
          {adminCopy.payments.allLinks}
        </Link>
      </div>
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
          return (
            <li
              key={item.paymentId}
              className="flex flex-col gap-1 border-b border-border py-4 first:pt-0 last:border-b-0"
            >
              <p
                className={cn(
                  "text-base font-semibold",
                  item.unbound && "text-muted-foreground"
                )}
              >
                {item.title}
              </p>
              <p className="text-[15px]">
                <bdi>{item.details}</bdi>
              </p>
              {item.override && (
                <p className="text-[15px] text-warning">
                  <bdi>{item.override}</bdi>
                </p>
              )}
              {item.extra && (
                <p className="text-[13px] text-muted-foreground">
                  <bdi>{item.extra}</bdi>
                </p>
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
