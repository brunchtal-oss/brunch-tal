"use client"

import { useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { sectionTitleClass } from "@/components/shared/section-title"
import { cn } from "@/lib/utils"

// The card's "היסטוריה" (fix 9, user decision 2026-10-19): closed at first,
// a chevron down; the title itself is the toggle (a button inside the h2,
// aria-expanded), and it opens to the rows (the bookings and purchases
// links). The rows stay in the markup, hidden while closed, so
// aria-controls always names them.
export function HistoryDisclosure({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  id: string
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = `${id}-panel`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 className={sectionTitleClass}>
        <button
          id={id}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="-mx-1 inline-flex min-h-11 items-center gap-2 rounded-sm px-1 text-start"
        >
          {title}
          <ChevronDownIcon
            aria-hidden
            strokeWidth={1.5}
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-180"
            )}
          />
        </button>
      </h2>
      <ul id={panelId} hidden={!open} className="-mx-3 flex flex-col">
        {children}
      </ul>
    </section>
  )
}
