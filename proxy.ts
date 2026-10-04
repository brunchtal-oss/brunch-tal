import { type NextRequest } from "next/server"

import { REQUEST_PATH_HEADER, requestPathOf } from "@/lib/auth/request-path"
import {
  handleSiteLockPost,
  isSiteLocked,
  SITE_LOCK_COOKIE,
  SITE_LOCK_FORM_PATH,
  siteLockAccess,
  siteLockCookieHeader,
  siteLockDeniedResponse,
  siteLockFormResponse,
  wantsLockForm,
} from "@/lib/site-lock"
import { updateSession } from "@/lib/supabase/proxy"

// Static files never carry a Supabase session, so they skip the refresh.
const STATIC_ASSET =
  /^\/(?:_next\/static|_next\/image|favicon\.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$)/

const SHELL_PATH = /^\/(me|admin)(\/|$)/

export async function proxy(request: NextRequest) {
  // Site lock first (AD-22): applies to every path, static files included.
  // The sign-in form posts here without credentials (story 5.9).
  if (
    request.method === "POST" &&
    request.nextUrl.pathname === SITE_LOCK_FORM_PATH &&
    isSiteLocked(process.env)
  ) {
    const form = await request.formData().catch(() => null)
    const field = (name: string) => {
      const value = form?.get(name)
      return typeof value === "string" ? value : null
    }
    return handleSiteLockPost(
      { user: field("user"), password: field("password"), next: field("next") },
      process.env,
      request.nextUrl.origin
    )
  }

  const { decision, issueCookie } = siteLockAccess(
    request.nextUrl.pathname,
    request.headers.get("authorization"),
    request.cookies.get(SITE_LOCK_COOKIE)?.value ?? null,
    process.env
  )
  if (decision === "deny") {
    return wantsLockForm(request.method, request.headers.get("accept"))
      ? siteLockFormResponse(requestPathOf(request.nextUrl))
      : siteLockDeniedResponse()
  }

  // The cookie is stored on the next page response; a static file never
  // arrives first in a browser.
  if (STATIC_ASSET.test(request.nextUrl.pathname)) return

  // The shell guards need the requested path for the login `next`; always
  // overwritten here, never trusted from the browser.
  // Set only for the two guarded shells (token routes never carry it).
  request.headers.delete(REQUEST_PATH_HEADER)
  if (SHELL_PATH.test(request.nextUrl.pathname)) {
    request.headers.set(REQUEST_PATH_HEADER, requestPathOf(request.nextUrl))
  }

  const response = await updateSession(request)
  if (issueCookie) {
    response.headers.append("Set-Cookie", siteLockCookieHeader(issueCookie))
  }
  return response
}

export const config = {
  // Every path, so the lock also covers static files.
  matcher: ["/:path*"],
}
