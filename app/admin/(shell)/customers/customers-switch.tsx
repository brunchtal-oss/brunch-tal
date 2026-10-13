import Link from "next/link"

import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

import { OPEN_CARDS_PATH } from "./open-cards/open-cards-items"

const copy = adminCopy.customers

const VIEWS = [
  { key: "customers", href: "/admin/customers", label: copy.title },
  { key: "open-cards", href: OPEN_CARDS_PATH, label: copy.openCards.title },
] as const

export type CustomersView = (typeof VIEWS)[number]["key"]

// DESIGN › segmented-switch "לקוחות | כרטיסיות פתוחות" (story 4.3, CAP-42):
// two sibling routes, so two links in a nav; the current one in primary
// with aria-current. One 1px ink-muted frame, 4px corners, each half at
// least 44px.
export function CustomersSwitch({ current }: { current: CustomersView }) {
  return (
    <nav aria-label={copy.switchNav}>
      <ul className="grid grid-cols-2 overflow-hidden rounded-[4px] border border-muted-foreground sm:inline-grid sm:min-w-80">
        {VIEWS.map((view) => {
          const selected = view.key === current
          return (
            <li key={view.key} className="min-w-0">
              <Link
                href={view.href}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  // The frame clips outside, so the focus ring sits inside.
                  "flex min-h-11 items-center justify-center px-3 text-center text-[15px] font-semibold focus-visible:-outline-offset-4",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                )}
              >
                {view.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
