import "server-only"

import { notFound } from "next/navigation"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import type { CardAccount, CustomerCard } from "./card-items"
import { removedProfileOf, type RemovedProfile } from "./remove-details-items"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// admin_get_customer for the card. A bad id or NOT_FOUND (not a customer):
// 404. A removed customer (story 4.6) comes back as her tombstone only.
export async function loadCardOrRemoved(
  id: string
): Promise<{ card: CustomerCard } | { removed: RemovedProfile }> {
  if (!UUID.test(id)) notFound()
  const result = await callRpc(await createClient(), "admin_get_customer", {
    p_customer_id: id,
  })
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound()
    throw new Error("admin_get_customer failed")
  }
  const data = result.data as unknown as CustomerCard
  const removed = removedProfileOf(data?.profile)
  return removed ? { removed } : { card: data }
}

// The history pages: a removed customer has none (404).
export async function loadCard(id: string): Promise<CustomerCard> {
  const loaded = await loadCardOrRemoved(id)
  if ("removed" in loaded) notFound()
  return loaded.card
}

// admin_get_customer_account for the account section (story 2.8). Called
// after loadCard, so the id is already a customer.
export async function loadAccount(id: string): Promise<CardAccount> {
  const result = await callRpc(
    await createClient(),
    "admin_get_customer_account",
    { p_customer_id: id }
  )
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound()
    throw new Error("admin_get_customer_account failed")
  }
  return result.data as unknown as CardAccount
}

// admin_list_customer_credits for the credits-and-refunds section (story
// 3.9). Read together with loadCard, which answers a bad id or a
// non-customer with notFound() (here: [] for either).
export async function loadCredits(id: string): Promise<unknown> {
  if (!UUID.test(id)) return []
  const result = await callRpc(
    await createClient(),
    "admin_list_customer_credits",
    { p_customer_id: id }
  )
  if (!result.ok) throw new Error("admin_list_customer_credits failed")
  return result.data
}
