import "server-only"

import { redirect } from "next/navigation"

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

  const { data: role, error } = await supabase.rpc("get_my_session_role")
  if (error || role !== "customer") redirect(loginUrl)
}
