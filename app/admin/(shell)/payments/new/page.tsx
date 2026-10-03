import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"
import { formatLocalDate } from "@/lib/time"

import { PaymentFormHost } from "./payment-form-host"

export const metadata: Metadata = {
  title: adminCopy.payments.newTitle,
}

// Rendered inside the admin shell's <Suspense> gate.
export default function NewPaymentPage() {
  return (
    <>
      <PageHeading>{adminCopy.payments.newTitle}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <NewPaymentContent />
      </Suspense>
    </>
  )
}

async function NewPaymentContent() {
  const supabase = await createClient()
  // Admin reads through RLS. Pinned products (validity_mode 'session') are
  // approved from E3; until then only days products are offered. Methods in
  // Tal's order, visible ones only (private.payment_method_selectable).
  const [products, methods] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, price_agorot")
      .eq("active", true)
      .eq("validity_mode", "days")
      .order("name")
      .order("id"),
    supabase
      .from("payment_methods")
      .select("id, name")
      .eq("hidden", false)
      .order("sort_order")
      .order("id"),
  ])
  if (products.error || methods.error) throw new Error("payment form failed")

  // One idempotency key per page load (AD-5), sent with every attempt.
  const idempotencyKey = randomUUID()
  // The default purchase date; plan_approve_payment checks the local today.
  const today = formatLocalDate(new Date())

  return (
    <PaymentFormHost
      products={products.data.map((p) => ({
        id: p.id,
        name: p.name,
        priceAgorot: p.price_agorot,
      }))}
      methods={methods.data}
      today={today}
      idempotencyKey={idempotencyKey}
    />
  )
}
