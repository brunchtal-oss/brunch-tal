import Link from "next/link"

import { customerCopy } from "@/lib/copy/customer"
import type { SessionPhotoData } from "@/lib/media/photo"
import {
  formatAccessibleDate,
  formatAccessibleDateTime,
  formatSessionDate,
  formatSessionDateTime,
} from "@/lib/time"
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
//
// The brunch time shows only where it serves the customer (design round,
// user decision 2026-10-08): showTime on her next session and her upcoming
// bookings; never on the home page's cards or a past booking. Without it,
// the visible date and the accessible name have no time.
//
// framed = false: the customer home's "המפגש הקרוב שלי" (DESIGN ›
// session-card › nextSession; user decision 2026-10-08): no card frame, the
// photo full width with its own corners, then "בראנץ׳ {קונספט}" on one line
// in display-sm with the chip at inline-end, and under it the weekday, date
// and time.
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
  showTime = false,
  framed = true,
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
  showTime?: boolean
  framed?: boolean
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2"
  const horizontal = layout === "horizontal"
  return (
    <article
      className={cn(
        "relative flex",
        framed && "overflow-hidden rounded-lg border border-border bg-card",
        horizontal ? "flex-row items-stretch" : "flex-col"
      )}
    >
      {!horizontal && (
        <SessionPhoto
          src={photo?.photoUrl}
          focusX={photo?.focusX}
          focusY={photo?.focusY}
          sizes="(min-width: 640px) 560px, 100vw"
          className={cn(photoAspect, !framed && "rounded-xl")}
        />
      )}
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1",
          framed ? "px-4 pt-3 pb-3.5" : "pt-3",
          horizontal && "flex-1 justify-center py-4"
        )}
      >
        {framed && (
          <span
            aria-hidden
            className="text-[15px] leading-none text-muted-foreground"
          >
            {customerCopy.brunch}
          </span>
        )}
        <div
          className={cn(!framed && "flex items-start justify-between gap-3")}
        >
          <Heading className="min-w-0 font-heading text-[22px] leading-tight font-light text-balance">
            <Link
              href={href}
              className="rounded-[4px] after:absolute after:inset-0 after:content-['']"
            >
              {framed ? (
                <span className="sr-only">{customerCopy.brunch} </span>
              ) : (
                <>{customerCopy.brunch} </>
              )}
              <bdi>{conceptName}</bdi>
              <span className="sr-only">
                ,{" "}
                {showTime
                  ? formatAccessibleDateTime(startsAt)
                  : formatAccessibleDate(startsAt)}
                {statusText ? `, ${statusText}` : ""}
              </span>
            </Link>
          </Heading>
          {!framed && status && (
            <span aria-hidden className="shrink-0 pt-1">
              {status}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <time
            dateTime={startsAt}
            aria-hidden
            className="text-[15px] text-foreground"
          >
            {showTime
              ? formatSessionDateTime(startsAt)
              : formatSessionDate(startsAt)}
          </time>
          {framed && status && <span aria-hidden>{status}</span>}
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
