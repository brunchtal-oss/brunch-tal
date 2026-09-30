import { type NextRequest } from "next/server"

import { checkSiteLock, siteLockDeniedResponse } from "@/lib/site-lock"
import { updateSession } from "@/lib/supabase/proxy"

// Static files never carry a Supabase session, so they skip the refresh.
const STATIC_ASSET =
  /^\/(?:_next\/static|_next\/image|favicon\.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$)/

export async function proxy(request: NextRequest) {
  // Site lock first (AD-22): applies to every path, static files included.
  const decision = checkSiteLock(
    request.nextUrl.pathname,
    request.headers.get("authorization"),
    process.env
  )
  if (decision === "deny") return siteLockDeniedResponse()

  if (STATIC_ASSET.test(request.nextUrl.pathname)) return

  return await updateSession(request)
}

export const config = {
  // Every path, so the lock also covers static files.
  matcher: ["/:path*"],
}
