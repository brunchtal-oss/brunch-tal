import { customerCopy } from "@/lib/copy/customer"
import type { SessionPhotoData } from "@/lib/media/photo"
import { formatAccessibleDateTime, formatSessionDateTime } from "@/lib/time"

import { SessionPhoto } from "./session-photo"

// The top of a session page, in the same uniform style as the session-card
// (user's decision 2026-10-04, UX memlog; replaces the concept field of
// DESIGN.md › concept-header): the photo at 4:3, full-bleed inside the 24px
// gutter of the customer shell, then "בראנץ׳", the concept name (the page's
// h1) in the site's heading face (display-lg) and the date, in the site's
// ink. No concept colour or face. The photo (story 5.4) is the session's,
// else its concept's, with its alt text, at its focus point; loaded first.
export function ConceptHeader({
  conceptName,
  photo = null,
  startsAt,
  children,
}: {
  conceptName: string
  photo?: SessionPhotoData | null
  startsAt: string
  // Under the date (e.g. the status-chip).
  children?: React.ReactNode
}) {
  return (
    <header className="-mx-6 -mt-2">
      <SessionPhoto
        src={photo?.photoUrl}
        alt={photo?.photoAlt}
        focusX={photo?.focusX}
        focusY={photo?.focusY}
        sizes="(min-width: 640px) 640px, 100vw"
        priority
      />
      <div className="px-6 pt-6">
        <h1 tabIndex={-1} className="flex flex-col gap-2 outline-offset-4">
          <span className="text-[15px] leading-none text-muted-foreground">
            {customerCopy.brunch}
          </span>
          <span className="font-heading text-[40px] leading-[1.15] font-light text-balance">
            <bdi>{conceptName}</bdi>
          </span>
        </h1>
        <p className="mt-3 text-base">
          <time dateTime={startsAt}>
            <span className="sr-only">
              {formatAccessibleDateTime(startsAt)}
            </span>
            <span aria-hidden>{formatSessionDateTime(startsAt)}</span>
          </time>
        </p>
        {children && (
          <div className="mt-4 flex flex-wrap gap-2">{children}</div>
        )}
      </div>
    </header>
  )
}
