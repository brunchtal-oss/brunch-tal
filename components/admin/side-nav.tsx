"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { NavIcon } from "@/components/shared/nav-icon"
import { isCurrent, type NavItem } from "@/lib/nav"
import { cn } from "@/lib/utils"

// Admin navigation from lg (DESIGN.md › side-nav): 240px, card background,
// border at inline-end; the current item on muted with an olive bar at
// inline-start. Sticky right under the 64px top-bar, which holds sign-out
// (story 5.7).
export function SideNav({
  items,
  label,
}: {
  items: readonly NavItem[]
  label: string
}) {
  const pathname = usePathname()

  return (
    <nav
      aria-label={label}
      className="sticky top-16 hidden h-[calc(100svh-4rem)] w-60 shrink-0 flex-col gap-6 overflow-y-auto border-e border-border bg-card px-3 py-6 lg:flex"
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const current = isCurrent(items, item, pathname)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative flex min-h-11 items-center gap-3 rounded-sm px-3 text-base",
                  current
                    ? "bg-muted font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {current && (
                  <span
                    aria-hidden
                    className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-brand-accent"
                  />
                )}
                <NavIcon icon={item.icon} className="size-5" />
                <span>{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
