import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { callRpc } from "@/lib/rpc"
import type { Database } from "@/lib/supabase/database.types"

import { parseAvailability, type Availability } from "./session-status"

// Reads for the customer's session screens (story 3.2), with her own session
// (RLS): published sessions and their concept, her confirmed bookings, and
// the availability labels (get_event_availability; never a number).

export const SESSION_COLUMNS =
  "id, kind, status, description, starts_at, display_price_agorot, concepts(name, description)"

export type CustomerSession = {
  id: string
  kind: "regular" | "couple"
  status: string
  description: string | null
  starts_at: string
  display_price_agorot: number | null
  concept_name: string
}

// The concept is never missing (a required FK); the table's checks
// guarantee the kind. The description is the session's, else the concept's
// (user's decision 2026-10-05, as on the public session page); a blank text
// counts as not entered.
export function toCustomerSession(row: {
  id: string
  kind: string
  status: string
  description: string | null
  starts_at: string
  display_price_agorot: number | null
  concepts: {
    name: string
    description: string | null
  } | null
}): CustomerSession {
  const { concepts, ...rest } = row
  const text = (value: string | null | undefined) =>
    value && value.trim() ? value : null
  return {
    ...rest,
    kind: rest.kind === "couple" ? "couple" : "regular",
    description: text(rest.description) ?? text(concepts?.description),
    concept_name: concepts?.name ?? "",
  }
}

type Client = SupabaseClient<Database>

/** Her confirmed bookings among these sessions (RLS: only her own rows). */
export async function bookedEventIds(
  supabase: Client,
  eventIds: string[]
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from("bookings")
    .select("event_id")
    .eq("status", "confirmed")
    .in("event_id", eventIds)
  if (error) throw new Error("bookings read failed")
  return new Set(data.map((row) => row.event_id))
}

/** The availability labels; an empty map when the call fails (no chips). */
export async function availabilityOf(
  supabase: Client,
  eventIds: string[]
): Promise<Map<string, Availability>> {
  if (eventIds.length === 0) return new Map()
  const result = await callRpc(supabase, "get_event_availability", {
    p_event_ids: eventIds,
  })
  return result.ok ? parseAvailability(result.data) : new Map()
}
