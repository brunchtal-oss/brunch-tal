import { headers } from "next/headers"

import { REQUEST_PATH_HEADER, shellPath } from "@/lib/auth/request-path"
import { requireRole } from "@/lib/auth/require-role"

// Shell guard, rendered inside <Suspense> by the /me and /admin layouts.
// Convenience only; the authorization is RLS and the RPCs.
export async function RoleGate({
  role,
  children,
}: {
  role: "customer" | "admin"
  children: React.ReactNode
}) {
  const area = role === "admin" ? "/admin" : "/me"
  const path = shellPath((await headers()).get(REQUEST_PATH_HEADER), area)
  await requireRole(role, path)
  return children
}
