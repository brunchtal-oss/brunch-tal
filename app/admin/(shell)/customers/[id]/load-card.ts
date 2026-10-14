import "server-only"

import { notFound } from "next/navigation"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import type { CardAccount, CustomerCard } from "./card-items"

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
