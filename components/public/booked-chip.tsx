import "server-only"

import { cache } from "react"
import { unstable_rethrow } from "next/navigation"

import { StatusChip } from "@/components/shared/status-chip"
import { bookedEventIds } from "@/app/me/sessions/load-sessions"
import { getViewerRole } from "@/lib/auth/viewer-role"
import { customerCopy } from "@/lib/copy/customer"
import { createClient } from "@/lib/supabase/server"

// "נרשמת" on public /sessions for a signed-in customer (story 5.21). The
// list itself stays on the anon client (lib/sessions/public.ts); each row
// streams this chip in its own <Suspense>, so the list never waits on the
// session. Guests, admins and a failed read: no chip.

/**
 * Her confirmed bookings among the listed sessions (`eventIds`, joined by
 * ","), read once per request for all the rows (React cache): the viewer's
 * role, then her own bookings with the server client (RLS). Empty for
 * anyone who is not a customer, or when a read fails.
 */
export const myBookedEventIds = cache(async function myBookedEventIds(
  eventIds: string
): Promise<Set<string>> {
  try {
    if ((await getViewerRole()) !== "customer") return new Set()
    const ids = eventIds.split(",").filter(Boolean)
    return await bookedEventIds(await createClient(), ids)
  } catch (error) {
    // Next's own signals (dynamic rendering) pass through.
    unstable_rethrow(error)
    return new Set()
  }
})

export async function BookedChip({
  eventId,
  eventIds,
}: {
  eventId: string
  // Every session in the list, joined by "," (one read for all rows).
  eventIds: string
}) {
  const booked = await myBookedEventIds(eventIds)
  if (!booked.has(eventId)) return null
  return <StatusChip tone="booked">{customerCopy.booked}</StatusChip>
}
