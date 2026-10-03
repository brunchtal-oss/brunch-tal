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
]

export const customerNav: readonly NavItem[] = [
  { href: "/me", label: shellCopy.nav.home, icon: "home" },
  { href: "/me/sessions", label: shellCopy.nav.sessions, icon: "sessions" },
]

export const adminNav: readonly NavItem[] = [
  { href: "/admin", label: shellCopy.nav.home, icon: "home" },
  // Only the "add payment" screen exists so far; the payments list comes later.
  {
    href: "/admin/payments/new",
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
