"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { isCurrent, type NavItem } from "@/lib/nav"
import { cn } from "@/lib/utils"

import { NavIcon } from "./nav-icon"

// Fixed bottom navigation (DESIGN.md › bottom-tab-bar): card background, top
// border, min-height 64px + safe area. Icon 24px above a 13px label; the
// current item is ink, 600, with a 24px olive bar above the icon. While the
// bar is shown, globals.css reserves its height at the bottom of the page
// (padding-bottom and scroll-padding-bottom, [data-tab-bar]), so no content
// or focused control hides under it. `mobileOnly` hides it from lg (admin).
export function BottomTabBar({
  items,
  label,
  mobileOnly = false,
}: {
  items: readonly NavItem[]
  label: string
  mobileOnly?: boolean
}) {
  const pathname = usePathname()

  return (
    <nav
      aria-label={label}
      data-tab-bar={mobileOnly ? "mobile" : "always"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]",
        mobileOnly && "lg:hidden"
      )}
    >
      <ul className="mx-auto flex min-h-16 max-w-[720px] items-stretch justify-around">
        {items.map((item) => {
          const current = isCurrent(items, item, pathname)
          return (
            <li key={item.href} className="flex min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-sm px-1 py-2 text-center text-[13px] leading-[1.4]",
                  current
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 w-6 rounded-full",
                    current ? "bg-brand-accent" : "bg-transparent"
                  )}
                />
                <NavIcon icon={item.icon} className="size-6" />
                <span>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
