import { cn } from "@/lib/utils"

// DESIGN.md › status-chip: a pill with the status tint, the word in the
// status colour (label-strong) and a 7px dot. The word is the information;
// the dot is decorative (aria-hidden). "Full" is expired (muted), never red.
const TONES = {
  success: { chip: "bg-success-tint text-success", dot: "bg-success-dot" },
  warning: { chip: "bg-warning-tint text-warning", dot: "bg-warning-dot" },
  pending: { chip: "bg-pending-tint text-pending", dot: "bg-pending-dot" },
  expired: { chip: "bg-expired-tint text-expired", dot: "bg-expired-dot" },
  // A conflict that stops a join ("לטיפול", DESIGN › status-chip error).
  error: { chip: "bg-error-tint text-error", dot: "bg-error-dot" },
} as const

export type StatusTone = keyof typeof TONES

export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold",
        TONES[tone].chip,
        className
      )}
    >
      <span
        aria-hidden
        className={cn("size-[7px] rounded-full", TONES[tone].dot)}
      />
      {children}
    </span>
  )
}
