import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

import { BackLink } from "../back-link"
import { customerHref } from "../../customer-items"
import { toPaymentLine } from "../card-items"
import { loadCard } from "../load-card"

const copy = adminCopy.customers.card

export const metadata: Metadata = {
  title: copy.purchasesTitle,
}

// A customer's purchase history (story 4.2, phone check, user decision
// 2026-10-07): newest first; product, amount and method as approved (the
// payment's snapshot). From admin_get_customer.
export default function CustomerPurchasesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <PurchasesContent params={params} />
    </Suspense>
  )
}

async function PurchasesContent({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const card = await loadCard(id)

  return (
    <>
      <header className="flex flex-col gap-1">
        <BackLink href={customerHref(card.profile.id)}>
          {copy.backToCard}
        </BackLink>
        <PageHeading>{copy.purchasesTitle}</PageHeading>
        <p className="text-base text-muted-foreground">
          <bdi>{card.profile.full_name}</bdi>
        </p>
      </header>
      {card.payments.length === 0 ? (
        <p className="text-base text-muted-foreground">{copy.noPurchases}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {card.payments.map((row) => {
            const line = toPaymentLine(row)
            return (
              <li key={line.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p
                    className={cn(
                      "text-base font-semibold",
                      line.voided && "text-muted-foreground line-through"
                    )}
                  >
                    <bdi>{line.product}</bdi>
                  </p>
                  {line.voided && (
                    <StatusChip tone="expired">{copy.voided}</StatusChip>
                  )}
                </div>
                <p className="text-[15px] text-muted-foreground">
                  <bdi>{line.detail}</bdi>
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
