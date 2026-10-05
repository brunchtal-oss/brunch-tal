import { PageHeading } from "@/components/shared/page-heading"
import { formatLocalDate, formatTime } from "@/lib/time"

import { sessionTitle, whenText, type EventStatus } from "../session-draft"
import { SessionStatusChip } from "../session-status-chip"

// The head of the session's pages (story 3.4): "בראנץ׳ {concept}" with its
// status-chip, then "{יום} DD.MM · 10:30–14:30".
export function SessionHeader({
  conceptName,
  status,
  startsAt,
  endsAt,
}: {
  conceptName: string
  status: EventStatus
  startsAt: string
  endsAt: string
}) {
  const day = formatLocalDate(startsAt)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PageHeading>
          <bdi>{sessionTitle(conceptName)}</bdi>
        </PageHeading>
        <SessionStatusChip status={status} />
      </div>
      <p className="text-base text-muted-foreground">
        <time dateTime={day}>
          <bdi>{whenText(day, formatTime(startsAt), formatTime(endsAt))}</bdi>
        </time>
      </p>
    </div>
  )
}
