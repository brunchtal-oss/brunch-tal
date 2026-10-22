import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

import type { PageStatus } from "./content-items"

// DESIGN.md › content-section-row: draft = pending, unpublished changes =
// warning, hidden = expired. Always a word; the dot is decorative. What is
// published with no pending draft has no chip (fix 17, user decision
// 2026-10-21): only what is not on the site yet is marked.
export type ChipStatus = Exclude<PageStatus, "published"> | "hidden"

const CHIP: Record<ChipStatus, { chip: string; dot: string }> = {
  draft: { chip: "bg-pending-tint text-pending", dot: "bg-pending-dot" },
  changed: { chip: "bg-warning-tint text-warning", dot: "bg-warning-dot" },
  hidden: { chip: "bg-expired-tint text-expired", dot: "bg-expired-dot" },
}

export function ContentStatusChip({ status }: { status: ChipStatus }) {
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
      {adminCopy.content.status[status]}
    </span>
  )
}

// The chips of a page or a section: its status unless published, then
// "hidden" when it is hidden.
export function statusChips(status: PageStatus, hidden = false): ChipStatus[] {
  const chips: ChipStatus[] = status === "published" ? [] : [status]
  if (hidden) chips.push("hidden")
  return chips
}

// The line under a page's name: what the chip means for the site; "" when
// it is published (no chip, nothing to say).
export function statusHint(status: PageStatus): string {
  const copy = adminCopy.content
  if (status === "draft") return copy.notShown
  return status === "changed" ? copy.changedHint : ""
}
