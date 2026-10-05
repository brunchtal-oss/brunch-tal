import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { callRpc } from "@/lib/rpc"
import type { Database } from "@/lib/supabase/database.types"

import { parseMyEntitlements, type MyEntitlement } from "./purchase-items"

// Reads of the customer's home and entitlement screens (story 4.12), with
// her own session: get_my_entitlements (balances and derived state from the
// server) and, by RLS, the concepts of pinned sessions.

type Client = SupabaseClient<Database>

/** Every entitlement of hers, by expires_on; throws when the call fails. */
export async function loadMyEntitlements(
  supabase: Client
): Promise<MyEntitlement[]> {
  const result = await callRpc(supabase, "get_my_entitlements")
  if (!result.ok) throw new Error("get_my_entitlements failed")
  return parseMyEntitlements(result.data)
}

/** The concept name of each pinned purchase's session (started or not). */
export async function pinnedConceptNames(
  supabase: Client,
  entitlements: readonly MyEntitlement[]
): Promise<Map<string, string>> {
  const ids = [...new Set(entitlements.flatMap((e) => e.pinnedEventId ?? []))]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from("events")
    .select("id, concepts(name)")
    .in("id", ids)
  if (error) throw new Error("pinned sessions failed")
  return new Map(
    data.flatMap((e) => (e.concepts?.name ? [[e.id, e.concepts.name]] : []))
  )
}
