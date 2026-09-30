import "server-only"

import { redirect } from "next/navigation"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// /me requires an active customer: get_my_session_role() = 'customer' (AD-2).
// Guests, admins, users without an active profile and any RPC error go to
// the login page. This guard is a convenience; the real authorization is RLS
// and the checks inside RPCs.
export async function requireCustomer(next = "/me"): Promise<void> {
  const loginUrl = `/login?next=${encodeURIComponent(next)}`
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) redirect(loginUrl)

  const role = await callRpc(supabase, "get_my_session_role")
  if (!role.ok || role.data !== "customer") redirect(loginUrl)
}
