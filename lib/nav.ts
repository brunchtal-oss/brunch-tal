import { shellCopy } from "@/lib/copy/shell"

// Navigation of each shell. Only screens that already exist are listed
// (lib/nav.test.ts checks that every href has a page.tsx); a later story adds
// its item when it adds the screen. The icon is a key so the list stays plain
// data that a Server Component can pass to the client tab bar.
export type NavIcon = "home" | "more"

export type NavItem = {
  href: string
  label: string
  icon: NavIcon
}

export const customerNav: readonly NavItem[] = [
  { href: "/me", label: shellCopy.nav.home, icon: "home" },
]

export const adminNav: readonly NavItem[] = [
  { href: "/admin", label: shellCopy.nav.home, icon: "home" },
  { href: "/admin/more", label: shellCopy.nav.more, icon: "more" },
]

// An item is current on its own path and below it; a shell's home ("/me",
// "/admin") only on itself when a sibling item covers the deeper path.
export function isCurrent(
  items: readonly NavItem[],
  item: NavItem,
  pathname: string
): boolean {
  if (pathname === item.href) return true
  if (!pathname.startsWith(`${item.href}/`)) return false
  // A longer matching item wins (/admin/more over /admin).
  return !items.some(
    (other) =>
      other.href.length > item.href.length &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`))
  )
}
