import "server-only"

import { randomUUID } from "node:crypto"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { localToday } from "@/lib/time"

import { toBookableEvents, type BookableEvent } from "./event-options"
import type { MethodOption, ProductOption } from "./payment-form"
import { toProductOptions } from "./product-options"

export type PaymentFormData = {
  products: ProductOption[]
  methods: MethodOption[]
  // The open sessions a pinned product can be approved for (story 3.11).
  events: BookableEvent[]
  today: string
  idempotencyKey: string
}

// What the payment form needs, for a new and an existing customer alike.
export async function loadPaymentFormData(): Promise<PaymentFormData> {
  const supabase = await createClient()
  // Admin reads through RLS. The products, hidden ones filtered out by
  // toProductOptions (tested). Methods in Tal's order, visible ones only
  // (private.payment_method_selectable).
  const [products, methods, events] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, price_agorot, validity_mode, eligible_event_kind, allowed_weekdays, party_size, active"
      )
      .order("name")
      .order("id"),
    supabase
      .from("payment_methods")
      .select("id, name")
      .eq("hidden", false)
      .order("sort_order")
      .order("id"),
    callRpc(supabase, "admin_list_bookable_events"),
  ])
  if (products.error || methods.error || !events.ok) {
    throw new Error("payment form failed")
  }

  return {
    products: toProductOptions(products.data),
    methods: methods.data,
    events: toBookableEvents(events.data),
    // The default purchase date; plan_approve_payment checks the local today.
    today: localToday(),
    // One idempotency key per page load (AD-5), sent with every attempt.
    idempotencyKey: randomUUID(),
  }
}
