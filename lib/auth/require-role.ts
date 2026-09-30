import "server-only"

import { redirect } from "next/navigation"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { toSessionRole } from "./destination"

type ShellRole = "customer" | "admin"

const SHELL = {
  customer: { home: "/me", login: "/login" },
  admin: { home: "/admin", login: "/admin/login" },
} as const

// Shell guard (AD-2): /me needs get_my_session_role() = 'customer' and
// /admin needs 'admin'. Runs inside <Suspense> (cacheComponents), so the
// redirect is streamed. A convenience only: the real authorization is RLS and
// the checks inside RPCs.
//
// - guest or RPC error      -> this shell's login page with ?next=
// - admin in /me            -> /admin
// - customer in /admin      -> /admin/login?next= (the page shows a notice)
// - none (no active profile) -> this shell's login page (shows a notice, so
//                               there is no loop back here)
export async function requireRole(
  required: ShellRole,
  next: string = SHELL[required].home
): Promise<void> {
  const shell = SHELL[required]
  const loginWithNext = `${shell.login}?next=${encodeURIComponent(next)}`
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) redirect(loginWithNext)

  const result = await callRpc(supabase, "get_my_session_role")
  if (!result.ok) redirect(loginWithNext)

  const role = toSessionRole(result.data)
  if (role === required) return

  if (role === "admin") redirect(SHELL.admin.home)
  if (role === "customer") redirect(loginWithNext)
  redirect(shell.login)
}
