"use server"

import { redirect } from "next/navigation"

import { isPushEndpoint } from "@/lib/push/server"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { toSessionRole } from "./destination"
import { safeNext } from "./safe-next"

// Shared sign-out for every shell and login notice. An admin lands on
// /admin/login, everyone else on /login. The role is read before signing out
// (afterwards there is no session to ask about). An optional `next` field
// (e.g. /join/<token> on the "another account" screen) is kept for the next
// login when it passes safeNext; an admin ignores it.
// The top-bar's form also sends this device's push endpoint
// (`push_endpoint`, story 5.8): its subscription is removed first, so the
// device stops getting this account's pushes. A failure there never blocks
// signing out; the browser keeps its subscription.
export async function signOutAction(formData?: FormData): Promise<void> {
  const supabase = await createClient()
  const result = await callRpc(supabase, "get_my_session_role")
  const role = result.ok ? toSessionRole(result.data) : "none"

  const endpoint = formData?.get("push_endpoint")
  if (isPushEndpoint(endpoint)) {
    await callRpc(supabase, "unregister_push_subscription", {
      p_endpoint: endpoint,
    })
  }

  await supabase.auth.signOut()
  if (role === "admin") redirect("/admin/login")

  const next = safeNext(formData?.get("next"))
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login")
}
