import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

import type { EventStatus } from "./session-draft"

// DESIGN.md › status-chip: draft = pending, published = confirmed (success).
// Always a word; the dot is decorative. Cancelled and completed sessions are
// not listed in 3.1, so they have no chip yet.
const CHIP = {
  draft: { chip: "bg-pending-tint text-pending", dot: "bg-pending-dot" },
  published: { chip: "bg-success-tint text-success", dot: "bg-success-dot" },
} as const

export function SessionStatusChip({ status }: { status: EventStatus }) {
  if (status !== "draft" && status !== "published") return null
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold",
        CHIP[status].chip
      )}
    >
      <span
        aria-hidden
        className={cn("size-[7px] rounded-full", CHIP[status].dot)}
      />
      {adminCopy.sessions.status[status]}
    </span>
  )
}
