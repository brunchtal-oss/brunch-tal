import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { formatLocalDate, formatTime } from "@/lib/time"

import { sessionTitle, whenText } from "../../session-draft"

// The work sheet's head on screen (story 4.10, second phone check
// 2026-10-07; in place of SessionHeader on this page): "לפרטי המפגש"
// without an underline, then "בראנץ׳ {קונספט}" as the page's title and
// under it the date and time. No status-chip. Hidden in print (the printed
// head is in WorkSheetView).
export function WorkSheetHead({
  eventId,
  conceptName,
  startsAt,
  endsAt,
}: {
  eventId: string
  conceptName: string
  startsAt: string
  endsAt: string
}) {
  const day = formatLocalDate(startsAt)
  return (
    <div className="flex flex-col gap-1 print:hidden">
      <Link
        href={`/admin/sessions/${eventId}`}
        className="-ms-1 inline-flex min-h-11 items-center gap-1 self-start rounded-[4px] text-[15px] font-semibold text-muted-foreground no-underline hover:text-foreground"
      >
        <ChevronRightIcon aria-hidden strokeWidth={1.5} className="size-5" />
        {adminCopy.sessions.toDetails}
      </Link>
      <PageHeading>
        <bdi>{sessionTitle(conceptName)}</bdi>
      </PageHeading>
      <p className="text-base text-muted-foreground">
        <time dateTime={day}>
          <bdi>{whenText(day, formatTime(startsAt), formatTime(endsAt))}</bdi>
        </time>
      </p>
    </div>
  )
}
