import "server-only"

import { formatLocalPhone } from "@/lib/phone"
import { createClient } from "@/lib/supabase/server"

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
