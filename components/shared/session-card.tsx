import Link from "next/link"

import { customerCopy } from "@/lib/copy/customer"
import type { SessionPhotoData } from "@/lib/media/photo"
import { formatAccessibleDateTime, formatSessionDateTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { SessionPhoto } from "./session-photo"

// One uniform card for every session (user's decision 2026-10-04, UX
// memlog; replaces the concept band of DESIGN.md › session-card): a wide
// photo at 2:1 on top (a low, rectangular card), then "בראנץ׳", the concept
// name in the site's heading face and ink, and the date with, for a
// signed-in customer, the status-chip. No concept colour or face. A single
// target: one link on the concept name whose ::after covers the card; its
// accessible name is the title, the full date and the status. No
// regular/couple label and no number of places. The photo is the session's,
// else its concept's (story 5.4), at its focus point, lazy, alt "" (it only
// goes with the name; the session page has the alt text).
//
// horizontal (the home page's upcoming sessions, story 5.4, DESIGN ›
// session-card): a low rectangle with a square photo at inline-end.
export function SessionCard({
  href,
  conceptName,
  photo = null,
  startsAt,
  status,
  statusText,
  headingLevel = 2,
  photoAspect = "aspect-[2/1]",
  layout = "stacked",
}: {
  href: string
  conceptName: string
  photo?: SessionPhotoData | null
  startsAt: string
  // The visible chip, and its word for the link's accessible name.
  status?: React.ReactNode
  statusText?: string
  // The title's level: 3 under a section heading (the home page's upcoming
  // sessions), else 2.
  headingLevel?: 2 | 3
  // The photo's aspect ratio in the stacked card.
  photoAspect?: "aspect-[2/1]" | "aspect-[5/2]"
  layout?: "stacked" | "horizontal"
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2"
  const horizontal = layout === "horizontal"
  return (
    <article
      className={cn(
        "relative flex overflow-hidden rounded-lg border border-border bg-card",
        horizontal ? "flex-row items-stretch" : "flex-col"
      )}
    >
      {!horizontal && (
        <SessionPhoto
          src={photo?.photoUrl}
          focusX={photo?.focusX}
          focusY={photo?.focusY}
          sizes="(min-width: 640px) 560px, 100vw"
          className={photoAspect}
        />
      )}
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1 px-4 pt-3 pb-3.5",
          horizontal && "flex-1 justify-center py-4"
        )}
      >
        <span
          aria-hidden
          className="text-[15px] leading-none text-muted-foreground"
        >
          {customerCopy.brunch}
        </span>
        <Heading className="font-heading text-[22px] leading-tight font-light text-balance">
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
        </Heading>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <time
            dateTime={startsAt}
            aria-hidden
            className="text-[15px] text-foreground"
          >
            {formatSessionDateTime(startsAt)}
          </time>
          {status && <span aria-hidden>{status}</span>}
        </div>
      </div>
      {horizontal && (
        <SessionPhoto
          src={photo?.photoUrl}
          focusX={photo?.focusX}
          focusY={photo?.focusY}
          sizes="128px"
          className="aspect-square w-28 shrink-0 self-stretch sm:w-32"
        />
      )}
    </article>
  )
}
