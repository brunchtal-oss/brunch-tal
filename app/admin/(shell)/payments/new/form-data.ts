import "server-only"

import { randomUUID } from "node:crypto"

import { createClient } from "@/lib/supabase/server"
import { formatLocalDate } from "@/lib/time"

import type { MethodOption, ProductOption } from "./payment-form"

export type PaymentFormData = {
  products: ProductOption[]
  methods: MethodOption[]
  today: string
  idempotencyKey: string
}

// What the payment form needs, for a new and an existing customer alike.
export async function loadPaymentFormData(): Promise<PaymentFormData> {
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

  return {
    products: products.data.map((p) => ({
      id: p.id,
      name: p.name,
      priceAgorot: p.price_agorot,
    })),
    methods: methods.data,
    // The default purchase date; plan_approve_payment checks the local today.
    today: formatLocalDate(new Date()),
    // One idempotency key per page load (AD-5), sent with every attempt.
    idempotencyKey: randomUUID(),
  }
}
