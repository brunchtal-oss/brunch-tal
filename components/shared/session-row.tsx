import Link from "next/link"

import { customerCopy } from "@/lib/copy/customer"
import type { SessionPhotoData } from "@/lib/media/photo"
import { formatAccessibleDate, formatSessionDate } from "@/lib/time"

import { SessionPhoto } from "./session-photo"

// DESIGN.md › session-row (design round, user decision 2026-10-07): the one
// row of every list of sessions, the public /sessions and the customer's
// "לו״ז בראנצ׳ים". An 84px square photo (the session's, else its
// concept's; without one the muted square of SessionPhoto, never an empty
// frame), 16px, then "בראנץ׳" in label ink-muted, the concept name in
// display-sm and the weekday and date in body-sm ink, never the time (user
// decision 2026-10-08). A signed-in customer also sees her status-chip at
// inline-end of the name's line (2026-10-08). Thin rules between the rows (the list draws them). The
// whole row is one link: the title link's ::after covers it, and its
// accessible name is the title, the date and the status.
export function SessionRow({
  href,
  conceptName,
  photo = null,
  startsAt,
  status,
  statusText,
  headingLevel = 2,
}: {
  href: string
  conceptName: string
  photo?: SessionPhotoData | null
  startsAt: string
  // The visible chip, and its word for the link's accessible name.
  status?: React.ReactNode
  statusText?: string
  headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2"
  return (
    <article className="relative flex items-center gap-4 py-3">
      <SessionPhoto
        src={photo?.photoUrl}
        focusX={photo?.focusX}
        focusY={photo?.focusY}
        sizes="84px"
        className="aspect-square size-[84px] shrink-0 rounded-lg"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          aria-hidden
          className="text-[13px] leading-[1.4] text-muted-foreground"
        >
          {customerCopy.brunch}
        </span>
        {/* The chip at inline-end of the name's line, centred with it; the
            name wraps first, the chip never does (2026-10-08). */}
        <div className="flex items-center gap-3">
          <Heading className="min-w-0 flex-1 font-heading text-[22px] leading-[1.25] font-light text-balance">
            <Link
              href={href}
              className="rounded-lg after:absolute after:inset-0 after:content-['']"
            >
              <span className="sr-only">{customerCopy.brunch} </span>
              <bdi>{conceptName}</bdi>
              <span className="sr-only">
                , {formatAccessibleDate(startsAt)}
                {statusText ? `, ${statusText}` : ""}
              </span>
            </Link>
          </Heading>
          {status && (
            <span aria-hidden className="flex shrink-0 whitespace-nowrap">
              {status}
            </span>
          )}
        </div>
        <time
          dateTime={startsAt}
          aria-hidden
          className="text-[15px] leading-[1.5] text-foreground"
        >
          {formatSessionDate(startsAt)}
        </time>
      </div>
    </article>
  )
}

// The list around the rows: a thin rule between them, on top of the first
// and under the last (DESIGN.md › session-row › divider).
export function SessionRowList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="flex flex-col divide-y divide-border border-y border-border">
      {children}
    </ul>
  )
}
