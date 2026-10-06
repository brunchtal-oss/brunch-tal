import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

// Navigation of each shell. Only screens that already exist are listed
// (lib/nav.test.ts checks that every href has a page.tsx); a later story adds
// its item when it adds the screen. The icon is a key so the list stays plain
// data that a Server Component can pass to the client tab bar.
export type NavIcon =
  "home" | "sessions" | "payments" | "purchases" | "profile" | "more"

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

// The public pages, in the menu-sheet's fixed order (story 5.2). Each
// label is also the page's h1 and <title>. Only pages that exist; /sessions
// ("בראנצ׳ים", after home, story 5.16).
export const publicNav: readonly { href: string; label: string }[] = [
  { href: "/", label: shellCopy.nav.home },
  { href: "/sessions", label: shellCopy.nav.publicSessions },
  { href: "/how-it-works", label: shellCopy.nav.howItWorks },
  { href: "/gallery", label: shellCopy.nav.gallery },
  { href: "/contact", label: shellCopy.nav.contact },
]

// The legal pages linked from the public footer (user decision 2026-10-04),
// each by its content page slug: a link is shown only once its page is
// published. The pages and their routes arrive in 5.5.
export const publicLegalNav: readonly {
  slug: string
  href: string
  label: string
}[] = [
  { slug: "terms", href: "/terms", label: shellCopy.public.footer.terms },
  { slug: "privacy", href: "/privacy", label: shellCopy.public.footer.privacy },
  {
    slug: "accessibility",
    href: "/accessibility",
    label: shellCopy.public.footer.accessibility,
  },
]

// The public item that is current on a path: its own path, or below it
// (/sessions/[id] under /sessions); home only on "/".
export function currentPublicHref(
  pathname: string,
  items: readonly { href: string }[] = publicNav
): string | null {
  const match = items
    .filter((item) =>
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
    )
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.href ?? null
}

// The account link of the public top-bar and menu-sheet (story 5.7, from
// deferred-work): a signed-in customer goes to her area, an admin to the
// panel, anyone else (a guest, the fallback while the role streams in) to the
// login. `role` is get_my_session_role()'s value, or null for a guest.
export function publicAccountLink(role: string | null): {
  href: string
  label: string
} {
  if (role === "customer") {
    return { href: "/me", label: shellCopy.public.customerArea }
  }
  if (role === "admin") {
    return { href: "/admin", label: shellCopy.public.adminArea }
  }
  return { href: "/login", label: shellCopy.public.customerLogin }
}

// The public sessions list (story 5.16), linked from the home page's
// upcoming sessions. The hero has no button since 5.16 (user's decision
// 2026-10-05).
export const SESSIONS_HREF = "/sessions"

export function hasPublicSessions(
  items: readonly { href: string }[] = publicNav
): boolean {
  return items.some((item) => item.href === SESSIONS_HREF)
}

export const customerNav: readonly NavItem[] = [
  { href: "/me", label: shellCopy.nav.home, icon: "home" },
  {
    href: "/me/sessions",
    label: shellCopy.nav.customerSessions,
    icon: "sessions",
  },
  // Purchase history (story 4.12, user decision 2026-10-06): every purchase
  // with its receipt, and below it each purchase's detail.
  {
    href: "/me/purchases",
    label: shellCopy.nav.purchases,
    icon: "purchases",
  },
  // The profile, always the last tab (story 2.10, user decision 2026-10-06).
  { href: "/me/profile", label: shellCopy.nav.profile, icon: "profile" },
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
