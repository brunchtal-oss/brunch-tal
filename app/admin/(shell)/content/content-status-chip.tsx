import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

import type { PageStatus } from "./content-items"

// DESIGN.md › content-section-row: draft = pending, published = success,
// unpublished changes = warning. Always a word; the dot is decorative.
const CHIP: Record<PageStatus, { chip: string; dot: string }> = {
  draft: { chip: "bg-pending-tint text-pending", dot: "bg-pending-dot" },
  published: { chip: "bg-success-tint text-success", dot: "bg-success-dot" },
  changed: { chip: "bg-warning-tint text-warning", dot: "bg-warning-dot" },
}

export function ContentStatusChip({ status }: { status: PageStatus }) {
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

// The line under a page's name: what the chip means for the site.
export function statusHint(status: PageStatus): string {
  const copy = adminCopy.content
  if (status === "draft") return copy.notShown
  return status === "changed" ? copy.changedHint : copy.publishedHint
}
