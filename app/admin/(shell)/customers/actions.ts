"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { parseSpecialBrunchInterests } from "@/lib/special-brunch"
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
// answers so too, without a round trip here). interests (story 2.16): the
// special brunches, [] for no filter (a customer matches with at least one);
// always sent, so only the overload with p_interests matches.

const EMPTY: CustomerList = { customers: [], has_more: false }

export async function listCustomersAction(
  query: string,
  activity: CustomerActivity,
  interests: readonly string[] = []
): Promise<ActionResult<CustomerList>> {
  const codes = Array.isArray(interests)
    ? parseSpecialBrunchInterests(interests)
    : null
  if (
    typeof query !== "string" ||
    query.trim().length > QUERY_MAX ||
    !isCustomerActivity(activity) ||
    codes === null ||
    codes.length !== interests.length
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const q = query.trim()
  if (q.length === 1) return { ok: true, data: EMPTY }
  const result = await callRpc(await createClient(), "admin_list_customers", {
    p_query: q,
    p_activity: activity,
    p_interests: codes,
  })
  if (!result.ok) return result
  return { ok: true, data: result.data as unknown as CustomerList }
}
