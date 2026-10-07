import "server-only"

import { notFound } from "next/navigation"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import type { CustomerCard } from "./card-items"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// admin_get_customer for the card and its history pages. A bad id or
// NOT_FOUND (not a customer): 404.
export async function loadCard(id: string): Promise<CustomerCard> {
  if (!UUID.test(id)) notFound()
  const result = await callRpc(await createClient(), "admin_get_customer", {
    p_customer_id: id,
  })
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound()
    throw new Error("admin_get_customer failed")
  }
  return result.data as unknown as CustomerCard
}
