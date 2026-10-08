import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { adminCopy } from "@/lib/copy/admin"
import { formatLocalDate } from "@/lib/time"

import { listSummary, sessionTitle, type SessionRow } from "./session-draft"
import { SessionStatusChip } from "./session-status-chip"

const copy = adminCopy.sessions

// The rows of /admin/sessions (story 3.1): "בראנץ׳ {concept}" with its
// status-chip, then "{when} · {n} מקומות"; a row leads to its details
// (story 3.4). By
// date. Empty: the line that points at "מפגש חדש".
export function SessionsList({ rows }: { rows: readonly SessionRow[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground">{copy.empty}</p>
  }
  return (
    <ul className="flex flex-col border-t border-border">
      {rows.map((row) => (
        <li key={row.id} className="border-b border-border">
          <Link
            href={`/admin/sessions/${row.id}`}
            className="flex min-h-14 items-center justify-between gap-3 py-3"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold break-words">
                  <bdi>{sessionTitle(row.concept_name)}</bdi>
                </span>
                <SessionStatusChip status={row.status} />
              </span>
              <span className="text-[13px] text-muted-foreground">
                <time dateTime={formatLocalDate(row.starts_at)}>
                  <bdi>{listSummary(row)}</bdi>
                </time>
              </span>
            </span>
            <ChevronLeftIcon
              aria-hidden
              strokeWidth={1.5}
              className="size-5 shrink-0 text-muted-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}
