import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { OccupancyBar } from "@/components/admin/occupancy-bar"
import { adminCopy } from "@/lib/copy/admin"
import { formatLocalDate } from "@/lib/time"

import {
  listOccupancy,
  listSummary,
  sessionTitle,
  type SessionRow,
} from "./session-draft"
import { SessionStatusChip } from "./session-status-chip"

const copy = adminCopy.sessions

// The rows of /admin/sessions (story 3.1; two lines since 2026-10-10):
// line 1 "בראנץ׳ {concept} · 8/12" (or "· מלא" in warning; nothing for a
// draft), the occupancy as bold as the title; line 2 the weekday and date
// with the status-chip at inline-end; under them the admin home's occupancy
// bar, so Tal reads how full each session is at a glance (user phone check
// 2026-10-10). A row leads to its details (story 3.4). By date. Empty: the
// line that points at "מפגש חדש".
// occupied: places taken by session id (private.occupied_places); a missing
// id is 0.
export function SessionsList({
  rows,
  occupied = {},
}: {
  rows: readonly SessionRow[]
  occupied?: Readonly<Record<string, number>>
}) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground">{copy.empty}</p>
  }
  return (
    <ul className="flex flex-col border-t border-border">
      {rows.map((row) => {
        const occupancy = listOccupancy(row, occupied[row.id] ?? 0)
        return (
          <li key={row.id} className="border-b border-border">
            <Link
              href={`/admin/sessions/${row.id}`}
              className="flex min-h-14 items-center gap-3 py-3"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-base font-semibold break-words">
                  <bdi>{sessionTitle(row.concept_name)}</bdi>
                  {occupancy && copy.occupancySeparator}
                  {occupancy &&
                    (occupancy.full ? (
                      <span className="text-warning">{copy.listFull}</span>
                    ) : (
                      <span className="tabular-nums">
                        <bdi dir="ltr">{occupancy.text}</bdi>
                        <span className="sr-only"> {copy.summary.places}</span>
                      </span>
                    ))}
                </span>
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-[13px] text-muted-foreground">
                    <time dateTime={formatLocalDate(row.starts_at)}>
                      <bdi>{listSummary(row)}</bdi>
                    </time>
                  </span>
                  <SessionStatusChip status={row.status} />
                </span>
                {occupancy && (
                  <span className="mt-1">
                    <OccupancyBar percent={occupancy.percent} />
                  </span>
                )}
              </span>
              <ChevronLeftIcon
                aria-hidden
                strokeWidth={1.5}
                className="size-5 shrink-0 text-muted-foreground"
              />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
