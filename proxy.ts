import { type NextRequest } from "next/server"

import { REQUEST_PATH_HEADER, requestPathOf } from "@/lib/auth/request-path"
import { checkSiteLock, siteLockDeniedResponse } from "@/lib/site-lock"
import { updateSession } from "@/lib/supabase/proxy"

// Static files never carry a Supabase session, so they skip the refresh.
const STATIC_ASSET =
  /^\/(?:_next\/static|_next\/image|favicon\.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$)/

const SHELL_PATH = /^\/(me|admin)(\/|$)/

export async function proxy(request: NextRequest) {
  // Site lock first (AD-22): applies to every path, static files included.
  const decision = checkSiteLock(
    request.nextUrl.pathname,
    request.headers.get("authorization"),
    process.env
  )
  if (decision === "deny") return siteLockDeniedResponse()

  if (STATIC_ASSET.test(request.nextUrl.pathname)) return

  // The shell guards need the requested path for the login `next`; always
  // overwritten here, never trusted from the browser.
  // Set only for the two guarded shells (token routes never carry it).
  request.headers.delete(REQUEST_PATH_HEADER)
  if (SHELL_PATH.test(request.nextUrl.pathname)) {
    request.headers.set(REQUEST_PATH_HEADER, requestPathOf(request.nextUrl))
  }

  return await updateSession(request)
}

export const config = {
  // Every path, so the lock also covers static files.
  matcher: ["/:path*"],
}
