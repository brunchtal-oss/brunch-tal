"use server"

import { redirect } from "next/navigation"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { toSessionRole } from "./destination"

// Shared sign-out for every shell and login notice. An admin lands on
// /admin/login, everyone else on /login. The role is read before signing out
// (afterwards there is no session to ask about).
export async function signOutAction(): Promise<void> {
  const supabase = await createClient()
  const result = await callRpc(supabase, "get_my_session_role")
  const role = result.ok ? toSessionRole(result.data) : "none"

  await supabase.auth.signOut()
  redirect(role === "admin" ? "/admin/login" : "/login")
}
