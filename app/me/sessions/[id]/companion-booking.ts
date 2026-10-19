import "server-only"

import { callRpc } from "@/lib/rpc"
import type { createClient } from "@/lib/supabase/server"

import {
  isCoupleBooking,
  parseMyBookings,
  type MyBooking,
} from "../../bookings/cancel-result"

// The booking whose companion note the session page shows (story 5.21, fix
// 7), read from get_my_bookings (her own rows; no preview_book_session
// change). The read starts with the page's other reads, before the preview
// tells which booking is hers here.

/**
 * Her upcoming bookings, only on a couple session (a regular session makes
 * no call: null). An empty list when the read fails (no note then).
 */
export async function coupleSessionBookings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionKind: "regular" | "couple"
): Promise<MyBooking[] | null> {
  if (sessionKind !== "couple") return null
  const result = await callRpc(supabase, "get_my_bookings")
  return result.ok ? parseMyBookings(result.data).upcoming : []
}

/**
 * The note's booking: her booking here (the preview's bookingId) when it is
 * a confirmed couple booking; null otherwise.
 */
export function companionNoteBooking(
  bookings: MyBooking[] | null,
  bookingId: string | null
): MyBooking | null {
  if (!bookings || !bookingId) return null
  const row = bookings.find((b) => b.bookingId === bookingId)
  return row && isCoupleBooking(row) ? row : null
}
