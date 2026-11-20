import { Suspense } from "react"
import type { Metadata } from "next"

import { ExpiredCardNote } from "@/components/customer/expired-card-note"
import { PurchaseRow } from "@/components/customer/purchase-row"
import { PageHeading } from "@/components/shared/page-heading"
import {
  PaymentNotice,
  paymentNoticeOf,
} from "@/components/shared/payment-notice"
import { readPaymentOutcome } from "@/lib/payments/payment-outcome"
import { PurchaseSheet } from "@/components/shared/purchase-sheet"
import { getWhatsappHref } from "@/lib/content/business-details"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { canBuy } from "@/lib/payments/purchase-options"
import { createClient } from "@/lib/supabase/server"

import { loadMyEntitlements, pinnedConceptNames } from "../load-entitlements"
import { loadCardPurchaseOptions, startCardPurchaseAction } from "./actions"
import {
  byPaidOnDesc,
  cardPurchaseButtonClass,
  creditChip,
  creditChipTone,
  entitlementName,
  pastStatus,
} from "../purchase-items"

export const metadata: Metadata = {
  title: shellCopy.nav.purchases,
}

// Purchase history (story 4.12, CAP-9, user decision 2026-10-06): every
// purchase of hers, newest first, one row each (PurchaseRow), linking to its
// detail. A tab of its own in the bottom bar. All values from
// get_my_entitlements. Rendered inside the layout's customer gate.
// Online payments (PR B): the outcome notice of a card payment
// (?payment=), and "רכישת כרטיסייה" at the top while online buying is on.
export default function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <>
      <PageHeading>{shellCopy.nav.purchases}</PageHeading>
      <Suspense fallback={null}>
        <BuyCard searchParams={searchParams} />
      </Suspense>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <Purchases />
      </Suspense>
    </>
  )
}

async function Purchases() {
  const supabase = await createClient()
  const entitlements = await loadMyEntitlements(supabase)
  if (entitlements.length === 0) {
    return <p className="text-[17px]">{customerCopy.purchasesEmpty}</p>
  }
  const hasExpired = entitlements.some((e) => e.expiredBeforeBound)
  const [names, contactHref] = await Promise.all([
    pinnedConceptNames(supabase, entitlements),
    hasExpired ? getWhatsappHref() : Promise.resolve(null),
  ])

  return (
    <ul className="flex flex-col divide-y divide-border border-y border-border pb-0">
      {[...entitlements].sort(byPaidOnDesc).map((e) => (
        <li key={e.id}>
          <PurchaseRow
            href={`/me/purchases/${e.id}`}
            productName={entitlementName(e, names)}
            amountAgorot={e.amountAgorot}
            paidOn={e.paidOn}
            expiresOn={e.expiresOn}
            status={pastStatus(e)}
            creditChip={creditChip(e)}
            creditChipTone={creditChipTone(e)}
            expiredNote={
              e.expiredBeforeBound ? (
                <ExpiredCardNote
                  days={e.validityDays}
                  contactHref={contactHref}
                />
              ) : null
            }
          />
        </li>
      ))}
    </ul>
  )
}

// The payment notice and the card purchase. Nothing while online buying is
// off (and no notice without ?payment=).
export async function BuyCard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [query, options] = await Promise.all([
    searchParams,
    loadCardPurchaseOptions(),
  ])
  const outcome = await readPaymentOutcome(query)
  const notice = paymentNoticeOf(outcome, "purchases")
  if (!notice && !canBuy(options)) return null
  const contactHref = await getWhatsappHref()
  return (
    <div className="flex flex-col items-start gap-4">
      <PaymentNotice
        outcome={outcome}
        surface="purchases"
        contactHref={contactHref}
        className="w-full"
      />
      {canBuy(options) && (
        <PurchaseSheet
          products={options.products}
          eventId={null}
          start={startCardPurchaseAction}
          contactHref={contactHref}
          trigger={customerCopy.purchase.buyCard}
          triggerClassName={cardPurchaseButtonClass}
        />
      )}
    </div>
  )
}
