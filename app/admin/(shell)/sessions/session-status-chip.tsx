import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

import type { EventStatus } from "./session-draft"

// DESIGN.md › status-chip: draft = pending, published = confirmed (success),
// cancelled = expired (story 3.8: listed until it ends). Always a word; the
// dot is decorative. A completed session is not listed, so it has no chip.
const CHIP = {
  draft: { chip: "bg-pending-tint text-pending", dot: "bg-pending-dot" },
  published: { chip: "bg-success-tint text-success", dot: "bg-success-dot" },
  cancelled: { chip: "bg-expired-tint text-expired", dot: "bg-expired-dot" },
} as const

export function SessionStatusChip({ status }: { status: EventStatus }) {
  if (status !== "draft" && status !== "published" && status !== "cancelled")
    return null
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
