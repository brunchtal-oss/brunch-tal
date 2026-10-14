import "server-only"

import { formatLocalPhone } from "@/lib/phone"
import { createClient } from "@/lib/supabase/server"
import { localToday } from "@/lib/time"

import { countFreeEntries } from "./book-items"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type BookingCustomer = { id: string; name: string; phone: string }

// The customer of a manual booking (story 3.4): admin reads profiles through
// RLS. Not a UUID, unknown, not activated or anonymized: null (as
// admin_book_customer, which checks again under its lock).
export async function loadBookingCustomer(
  id: string | undefined
): Promise<BookingCustomer | null> {
  if (!id || !UUID.test(id)) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone_e164, activated_at, anonymized_at")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("customer read failed")
  if (!data || !data.activated_at || data.anonymized_at) return null
  return {
    id: data.id,
    name: data.full_name,
    phone: data.phone_e164 ? formatLocalPhone(data.phone_e164) : "",
  }
}

// The sessions she already has a confirmed booking for (story 4.3, user
// decision 2026-10-13), read by the admin through RLS.
export async function loadBookedEventIds(
  customerId: string
): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("bookings")
    .select("event_id")
    .eq("customer_id", customerId)
    .eq("status", "confirmed")
  if (error) throw new Error("customer bookings read failed")
  return data.map((row) => row.event_id)
}

// Her free entries, the cap of the selection (story 4.3, user decision
// 2026-10-13), read by the admin through RLS and counted by
// countFreeEntries as preview_book_sessions counts them.
export async function loadFreeEntries(customerId: string): Promise<number> {
  const supabase = await createClient()
  const [entitlements, balances, credits] = await Promise.all([
    supabase
      .from("entitlements")
      .select("id, status, pinned_event_id, expires_on")
      .eq("customer_id", customerId),
    supabase
      .from("entitlement_balances")
      .select("entitlement_id, available")
      .eq("customer_id", customerId),
    supabase
      .from("cancellation_credits")
      .select("id, status, choice_pending")
      .eq("customer_id", customerId)
      .eq("status", "active"),
  ])
  if (entitlements.error || balances.error || credits.error) {
    throw new Error("free entries read failed")
  }
  const creditIds = credits.data.map((c) => c.id)
  let fundingCreditIds: string[] = []
  if (creditIds.length > 0) {
    const allocations = await supabase
      .from("booking_allocations")
      .select("credit_id, booking_id")
      .in("credit_id", creditIds)
    if (allocations.error) throw new Error("free entries read failed")
    const bookingIds = allocations.data.map((a) => a.booking_id)
    if (bookingIds.length > 0) {
      const confirmed = await supabase
        .from("bookings")
        .select("id")
        .in("id", bookingIds)
        .eq("status", "confirmed")
      if (confirmed.error) throw new Error("free entries read failed")
      const live = new Set(confirmed.data.map((b) => b.id))
      fundingCreditIds = allocations.data
        .filter((a) => a.credit_id !== null && live.has(a.booking_id))
        .map((a) => a.credit_id as string)
    }
  }
  return countFreeEntries({
    entitlements: entitlements.data,
    balances: balances.data,
    credits: credits.data,
    fundingCreditIds,
    today: localToday(),
  })
}
