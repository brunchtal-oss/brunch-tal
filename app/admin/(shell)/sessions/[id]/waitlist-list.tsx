import Link from "next/link"

import { sectionTitleClass } from "@/components/shared/section-title"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { formatDayMonth, formatTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import type { WaitlistRow } from "./load-details"

const copy = adminCopy.sessions

// "ממתינות ({n})" on the session's details (story 5.6), after "מי מגיעה";
// nothing when no one waits. Each row: her name, linking to her card, when
// she joined, and "קיבלה הודעה" once a waitlist_spot was sent to her. A
// list, not a queue: the place goes to whoever books first.
export function WaitlistList({ waitlist }: { waitlist: WaitlistRow[] }) {
  if (waitlist.length === 0) return null
  return (
    <section aria-labelledby="waitlist-heading" className="flex flex-col">
      <h2 id="waitlist-heading" className={cn(sectionTitleClass, "mb-2")}>
        {copy.waitlist.title(waitlist.length)}
      </h2>
      <ul className="flex flex-col border-t border-border">
        {waitlist.map((row) => (
          <li
            key={row.customerId}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border py-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              {row.name ? (
                <Link
                  href={`/admin/customers/${row.customerId}`}
                  className="self-start py-1 text-base leading-[1.35] font-semibold underline-offset-[3px] hover:underline"
                >
                  <bdi className="break-words">{row.name}</bdi>
                </Link>
              ) : (
                <p className="text-base text-muted-foreground">
                  {copy.detailsRemoved}
                </p>
              )}
              <p className="text-[15px] text-muted-foreground">
                {copy.waitlist.joinedAt}
                <time dateTime={row.joinedAt}>
                  <bdi>
                    {formatDayMonth(row.joinedAt)} {formatTime(row.joinedAt)}
                  </bdi>
                </time>
              </p>
            </div>
            {row.notified && (
              <StatusChip tone="pending">{copy.waitlist.notified}</StatusChip>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
