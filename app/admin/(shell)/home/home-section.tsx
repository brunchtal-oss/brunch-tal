import Link from "next/link"

import {
  cubeTitleClass,
  sectionTitleClass,
} from "@/components/shared/section-title"
import { cn } from "@/lib/utils"

// One part of /admin (story 4.1; design round, user decision 2026-10-07):
// a cube (DESIGN › card: card surface, 1px border, 8px corners, 16px
// padding), one under the other and never one inside another. The title a
// cube title (Heebo 20/500, fix 9) with an optional aside at inline-end (a
// counter), then the content 12px under it. Rows inside draw a rule above
// each one but the first (cubeRows).
export function HomeSection({
  id,
  title,
  aside,
  children,
  className,
}: {
  id: string
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={id} className={cubeTitleClass}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

// A section of an admin screen other than the home (the customer card): an
// h2 section title (Heebo 24/500, fix 9) with an optional aside at
// inline-end, then the content 12px under it. boxed: inside a cube (DESIGN ›
// card), as the card's "פרטים" (fix 9).
export function PageSection({
  id,
  title,
  aside,
  boxed = false,
  children,
}: {
  id: string
  title: string
  aside?: React.ReactNode
  boxed?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col gap-3",
        boxed && "rounded-xl border border-border bg-card p-4"
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className={sectionTitleClass}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

// A list of rows inside a cube: a rule between the rows, none above the
// first (the title is above it) and none under the last (the cube's edge).
export const cubeRows =
  "flex flex-col [&>li]:border-t [&>li]:border-b-0 [&>li]:border-border [&>li:first-child]:border-t-0"

// The counter of a cube (DESIGN › saffron, design round 2026-10-07): the
// number in ink on saffron, a pill; decorative when the count is said in
// words too.
export function CubeCounter({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-saffron px-2 text-[13px] leading-none font-semibold text-foreground tabular-nums"
    >
      {count}
    </span>
  )
}

// A text link (DESIGN › button-link) with a 44px target.
export function HomeLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center self-start rounded-lg text-[15px] underline underline-offset-[3px]"
    >
      {children}
    </Link>
  )
}
