import "server-only"

import type { createClient } from "@/lib/supabase/server"
import { localToday } from "@/lib/time"

import type { EventKind, ProductChoice } from "./session-draft"

type Client = Awaited<ReturnType<typeof createClient>>

// The products the session field "מוצרים תקפים" offers (story 3.18), read
// through admin RLS: every active product, and every hidden one that is
// selected (`selected`) or still has an active entitlement (status active,
// not expired by the local today; display only, the RPC checks each
// product's kind again). The screen keeps those of the session's kind.
export async function loadProductChoices(
  supabase: Client,
  selected: readonly string[] = []
): Promise<ProductChoice[]> {
  const products = await supabase
    .from("products")
    .select("id, name, eligible_event_kind, active")
    .order("name")
    .order("id")
  if (products.error) throw new Error("products read failed")

  const hiddenIds = products.data.filter((p) => !p.active).map((p) => p.id)
  const inUse = new Set<string>(selected)
  if (hiddenIds.length > 0) {
    const entitlements = await supabase
      .from("entitlements")
      .select("product_id:eligibility_snapshot->>product_id")
      .eq("status", "active")
      .gte("expires_on", localToday())
      .in("eligibility_snapshot->>product_id", hiddenIds)
    if (entitlements.error) throw new Error("entitlements read failed")
    for (const row of entitlements.data as { product_id: string | null }[]) {
      if (row.product_id) inUse.add(row.product_id)
    }
  }

  return products.data
    .filter((p) => p.active || inUse.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: (p.eligible_event_kind === "couple"
        ? "couple"
        : "regular") as EventKind,
      hidden: !p.active,
    }))
}
