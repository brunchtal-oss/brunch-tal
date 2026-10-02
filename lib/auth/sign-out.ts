"use server"

import { redirect } from "next/navigation"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { toSessionRole } from "./destination"
import { safeNext } from "./safe-next"

// Shared sign-out for every shell and login notice. An admin lands on
// /admin/login, everyone else on /login. The role is read before signing out
// (afterwards there is no session to ask about). An optional `next` field
// (e.g. /join/<token> on the "another account" screen) is kept for the next
// login when it passes safeNext; an admin ignores it.
export async function signOutAction(formData?: FormData): Promise<void> {
  const supabase = await createClient()
  const result = await callRpc(supabase, "get_my_session_role")
  const role = result.ok ? toSessionRole(result.data) : "none"

  await supabase.auth.signOut()
  if (role === "admin") redirect("/admin/login")

  const next = safeNext(formData?.get("next"))
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login")
}
