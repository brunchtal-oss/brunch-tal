import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

// Navigation of each shell. Only screens that already exist are listed
// (lib/nav.test.ts checks that every href has a page.tsx); a later story adds
// its item when it adds the screen. The icon is a key so the list stays plain
// data that a Server Component can pass to the client tab bar.
export type NavIcon = "home" | "sessions" | "payments" | "more"

export type NavItem = {
  href: string
  label: string
  icon: NavIcon
  // Screens reached from this item (the rows of "more"): the item is current
  // on them too.
  covers?: readonly string[]
}

// The rows of the admin's "more" screen (app/admin/(shell)/more/page.tsx).
export const adminMoreNav: readonly { href: string; label: string }[] = [
  { href: "/admin/links", label: adminCopy.links.title },
  { href: "/admin/products", label: adminCopy.products.title },
  { href: "/admin/content", label: adminCopy.content.title },
]

// The public pages (the menu-sheet comes in 5.2). Only pages that exist;
// 3.2 adds /sessions with its page, and the hero's button appears with it.
export const publicNav: readonly { href: string; label: string }[] = [
  { href: "/", label: shellCopy.nav.home },
]

// The hero's button leads to /sessions, so it is shown only once that page
// is in the public navigation (and therefore exists, lib/nav.test.ts).
export const SESSIONS_HREF = "/sessions"

export function hasPublicSessions(
  items: readonly { href: string }[] = publicNav
): boolean {
  return items.some((item) => item.href === SESSIONS_HREF)
}

export const customerNav: readonly NavItem[] = [
  { href: "/me", label: shellCopy.nav.home, icon: "home" },
  { href: "/me/sessions", label: shellCopy.nav.sessions, icon: "sessions" },
]

export const adminNav: readonly NavItem[] = [
  { href: "/admin", label: shellCopy.nav.home, icon: "home" },
  {
    href: "/admin/sessions",
    label: shellCopy.nav.sessions,
    icon: "sessions",
  },
  // The payments list; "add payment" and its steps are below it.
  {
    href: "/admin/payments",
    label: shellCopy.nav.payments,
    icon: "payments",
  },
  {
    href: "/admin/more",
    label: shellCopy.nav.more,
    icon: "more",
    covers: adminMoreNav.map((row) => row.href),
  },
]

// An item is current on its own path and below it; a shell's home ("/me",
// "/admin") only on itself when a sibling item covers the deeper path.
export function isCurrent(
  items: readonly NavItem[],
  item: NavItem,
  pathname: string
): boolean {
  const under = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)
  if (pathname === item.href) return true
  if (item.covers?.some(under)) return true
  // Another item covers this path (a row of "more").
  if (items.some((other) => other !== item && other.covers?.some(under))) {
    return false
  }
  if (!pathname.startsWith(`${item.href}/`)) return false
  // A longer matching item wins (/admin/more over /admin).
  return !items.some(
    (other) =>
      other.href.length > item.href.length &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`))
  )
}
