"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { QUERY_MAX, type CustomerList } from "./customer-items"

// The live search of /admin/customers (story 4.2, phone check). The RPC
// runs with the admin's own session (private.is_admin() inside) and decides
// everything; this checks only the shape. An empty or 1-character query is
// an empty list (the RPC answers so too, without a round trip here).

const EMPTY: CustomerList = { customers: [], has_more: false }

export async function listCustomersAction(
  query: string
): Promise<ActionResult<CustomerList>> {
  if (typeof query !== "string" || query.trim().length > QUERY_MAX) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const q = query.trim()
  if (q.length < 2) return { ok: true, data: EMPTY }
  const result = await callRpc(await createClient(), "admin_list_customers", {
    p_query: q,
  })
  if (!result.ok) return result
  return { ok: true, data: result.data as unknown as CustomerList }
}
