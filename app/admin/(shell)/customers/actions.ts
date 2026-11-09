"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { isSpecialBrunchCode } from "@/lib/special-brunch"
import { createClient } from "@/lib/supabase/server"

import {
  isCustomerActivity,
  QUERY_MAX,
  type CustomerActivity,
  type CustomerList,
} from "./customer-items"

// The live search and the categories of /admin/customers (stories 4.2,
// 5.13). The RPC runs with the admin's own session (private.is_admin()
// inside) and decides everything; this checks only the shape. An empty query
// lists the whole category; a 1-character query is an empty list (the RPC
// answers so too, without a round trip here). interest (story 2.16): one
// special brunch, or null for no filter; always sent, so only the overload
// with p_interest matches.

const EMPTY: CustomerList = { customers: [], has_more: false }

// The generated type has no null for p_interest; null is "no filter".
const NO_INTEREST = null as unknown as string

export async function listCustomersAction(
  query: string,
  activity: CustomerActivity,
  interest: string | null = null
): Promise<ActionResult<CustomerList>> {
  if (
    typeof query !== "string" ||
    query.trim().length > QUERY_MAX ||
    !isCustomerActivity(activity) ||
    (interest !== null && !isSpecialBrunchCode(interest))
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const q = query.trim()
  if (q.length === 1) return { ok: true, data: EMPTY }
  const result = await callRpc(await createClient(), "admin_list_customers", {
    p_query: q,
    p_activity: activity,
    p_interest: interest ?? NO_INTEREST,
  })
  if (!result.ok) return result
  return { ok: true, data: result.data as unknown as CustomerList }
}
