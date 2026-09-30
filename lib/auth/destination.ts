import { safeNext } from "./safe-next"

// The value of get_my_session_role() (AD-2). Anything unknown counts as none.
export type SessionRole = "admin" | "customer" | "none"

export function toSessionRole(value: unknown): SessionRole {
  return value === "admin" || value === "customer" ? value : "none"
}

function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0]
}

function inAdmin(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/")
}

function isAdminArea(pathname: string): boolean {
  return (
    inAdmin(pathname) &&
    pathname !== "/admin/login" &&
    !pathname.startsWith("/admin/login/")
  )
}

// Where a signed-in user goes after login (or when she opens a login page
// with a session). An admin only follows a `next` inside /admin (never the
// login page itself); a customer only follows a safe `next` outside /admin.
// `none` has no destination: the caller shows a notice instead of looping.
export function destinationFor(
  role: SessionRole,
  next: unknown
): string | null {
  const safe = safeNext(next)

  if (role === "admin") {
    return safe && isAdminArea(pathnameOf(safe)) ? safe : "/admin"
  }
  if (role === "customer") {
    return safe && !inAdmin(pathnameOf(safe)) ? safe : "/me"
  }
  return null
}

// What /login or /admin/login does for a visitor with this role (null = guest
// or failed lookup). A role that belongs to the page (/login: customer or
// admin; /admin/login: admin) is sent on; any other session gets a notice
// above the form, never a redirect, so the shell guards cannot loop.
export function loginPageOutcome(
  area: "customer" | "admin",
  role: SessionRole | null,
  next: unknown
): { redirect: string | null; notice: SessionRole | null } {
  if (!role) return { redirect: null, notice: null }
  const belongs = area === "admin" ? role === "admin" : role !== "none"
  const destination = belongs ? destinationFor(role, next) : null
  return destination
    ? { redirect: destination, notice: null }
    : { redirect: null, notice: role }
}

// The login page of the area a path belongs to.
export function loginPathFor(pathname: string): "/admin/login" | "/login" {
  return inAdmin(pathname) ? "/admin/login" : "/login"
}
