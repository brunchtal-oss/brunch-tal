import Link from "next/link"

import { conceptTheme } from "@/lib/concepts/themes"
import { customerCopy } from "@/lib/copy/customer"
import { formatAccessibleDateTime, formatSessionDateTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { conceptFaceClass, conceptStyle } from "./concept-header"

// DESIGN.md › session-card, EXPERIENCE.md › session-card. No photo yet
// (5.4), so the concept band takes the photo's 4:3 place with the name at
// 52px on its bottom edge, in the concept face and ink. Under it the date
// and, for a signed-in customer, the status-chip. A single target: one link
// on the concept name whose ::after covers the card; its accessible name is
// the title, the full date and the status. No regular/couple label and no
// number of places.
export function SessionCard({
  href,
  conceptName,
  themeKey,
  paperKey,
  startsAt,
  status,
  statusText,
}: {
  href: string
  conceptName: string
  themeKey: string | null
  paperKey: string | null
  startsAt: string
  // The visible chip, and its word for the link's accessible name.
  status?: React.ReactNode
  statusText?: string
}) {
  const theme = conceptTheme(themeKey, paperKey)
  return (
    <article className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div
        style={conceptStyle(theme.field, theme.ink)}
        className="flex aspect-[4/3] flex-col justify-end gap-2 bg-[var(--concept-field)] px-[18px] pt-4 pb-[18px] text-[var(--concept-ink)]"
      >
        <span aria-hidden className="text-[15px] leading-none">
          {customerCopy.brunch}
        </span>
        <h2
          className={cn(
            "text-[52px] leading-none",
            conceptFaceClass(theme.face)
          )}
        >
          <Link
            href={href}
            className="rounded-[4px] after:absolute after:inset-0 after:content-['']"
          >
            <span className="sr-only">{customerCopy.brunch} </span>
            <bdi>{conceptName}</bdi>
            <span className="sr-only">
              , {formatAccessibleDateTime(startsAt)}
              {statusText ? `, ${statusText}` : ""}
            </span>
          </Link>
        </h2>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-[18px] pt-3 pb-4">
        <time
          dateTime={startsAt}
          aria-hidden
          className="text-[15px] text-foreground"
        >
          {formatSessionDateTime(startsAt)}
        </time>
        {status && <span aria-hidden>{status}</span>}
      </div>
    </article>
  )
}
