import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { BalanceCard } from "@/components/customer/balance-card"
import { ExpiredCardNote } from "@/components/customer/expired-card-note"
import { PageHeading } from "@/components/shared/page-heading"
import { SignOutButton } from "@/components/shared/sign-out-button"
import { buttonVariants } from "@/components/ui/button"
import { getWhatsappHref } from "@/lib/content/business-details"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { formatAgorot } from "@/lib/money"
import { createClient } from "@/lib/supabase/server"
import { formatDayMonth } from "@/lib/time"

import { buildPurchaseItems } from "./purchase-items"

export const metadata: Metadata = {
  title: shellCopy.customer.homeTitle,
}

// Rendered inside the layout's <Suspense> customer gate. Sign-out stays here
// until the profile screen exists.
export default function MePage() {
  return (
    <>
      <PageHeading>
        <Suspense fallback={shellCopy.customer.greeting("")}>
          <Greeting />
        </Suspense>
      </PageHeading>
      <Suspense fallback={null}>
        <Purchases />
      </Suspense>
      <SignOutButton className="max-w-xs" />
    </>
  )
}

async function Greeting() {
  const supabase = await createClient()
  // RLS returns only the signed-in customer's own profile row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .maybeSingle()

  return shellCopy.customer.greeting(profile?.full_name ?? "")
}

// Every active entitlement that has not expired, or that expired before it
// was bound (shown with "expired" and its toggletip, story 2.4; never
// extended): the purchase confirmation (from the
// payment and its product_snapshot), the balance (entitlement_balances), and
// the current product's message and button while nothing was reserved from
// it yet (CAP-4), built in purchase-items.ts. RLS limits every read to the
// customer's own rows.
async function Purchases() {
  const supabase = await createClient()
  const { data: balances, error } = await supabase
    .from("entitlement_balances")
    .select(
      "entitlement_id, payment_id, available, reserved, used, expires_on, expired_before_bound"
    )
    .eq("status", "active")
    .or("is_expired.eq.false,expired_before_bound.eq.true")
    .order("expires_on")
    .order("entitlement_id")
  if (error) throw new Error("entitlement_balances failed")
  if (!balances?.length) return null

  const paymentIds = balances.flatMap((b) => b.payment_id ?? [])
  const payments = await supabase
    .from("payments")
    .select("id, product_id, amount_agorot, paid_on, product_snapshot")
    .in("id", paymentIds)
  if (payments.error) throw new Error("purchases failed")

  const productIds = [...new Set(payments.data.map((p) => p.product_id))]
  const expiredIds = balances.flatMap((b) =>
    b.expired_before_bound && b.entitlement_id ? [b.entitlement_id] : []
  )
  const [products, entitlements, contactHref] = await Promise.all([
    supabase
      .from("products")
      .select("id, post_join_message, post_join_button_label")
      .in("id", productIds),
    expiredIds.length
      ? supabase
          .from("entitlements")
          .select("id, eligibility_snapshot")
          .in("id", expiredIds)
      : Promise.resolve({ data: [], error: null }),
    expiredIds.length ? getWhatsappHref() : Promise.resolve(null),
  ])
  if (products.error) throw new Error("products failed")
  if (entitlements.error) throw new Error("entitlements failed")

  const items = buildPurchaseItems({
    balances,
    payments: payments.data,
    products: products.data,
    entitlements: entitlements.data,
  })
  if (items.length === 0) return null

  return (
    <section aria-labelledby="balances-title" className="flex flex-col gap-6">
      <h2 id="balances-title" className="text-xl font-light">
        {customerCopy.balancesTitle}
      </h2>
      {items.map((item) => (
        <div key={item.id} className="flex flex-col gap-3">
          <p className="text-[15px] text-muted-foreground">
            {customerCopy.purchase} {item.productName} ·{" "}
            <bdi>{formatAgorot(item.amountAgorot)}</bdi> ·{" "}
            {customerCopy.purchasedOn}
            <time dateTime={item.paidOn}>
              <bdi>{formatDayMonth(item.paidOn)}</bdi>
            </time>
          </p>
          <BalanceCard
            available={item.available}
            reserved={item.reserved}
            expiresOn={item.expiresOn}
            expiredNote={
              item.expiredBeforeBound ? (
                <ExpiredCardNote
                  weeks={item.validityWeeks}
                  contactHref={contactHref}
                />
              ) : null
            }
          />
          {item.message && <p className="text-base">{item.message}</p>}
          {item.buttonLabel && (
            <Link
              href="/me/sessions"
              className={buttonVariants({
                size: "lg",
                className: "h-12 max-w-xs text-base",
              })}
            >
              {item.buttonLabel}
            </Link>
          )}
        </div>
      ))}
    </section>
  )
}
