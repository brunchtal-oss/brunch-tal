import "server-only"

import { notFound } from "next/navigation"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import type { EntitlementPage } from "./entitlement-items"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// admin_get_entitlement for the card's page (story 3.13). A bad id or
// NOT_FOUND: 404.
export async function loadEntitlement(id: string): Promise<EntitlementPage> {
  if (!UUID.test(id)) notFound()
  const result = await callRpc(await createClient(), "admin_get_entitlement", {
    p_entitlement_id: id,
  })
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound()
    throw new Error("admin_get_entitlement failed")
  }
  return result.data as unknown as EntitlementPage
}
