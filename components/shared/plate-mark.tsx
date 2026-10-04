import { cn } from "@/lib/utils"

// The app icon's drawing without its olive field (story 5.9): a plate seen
// from above, a thin olive ring on cream. Decorative. On /offline it is the
// empty plate: nothing could be served.
export function PlateMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 96 96"
      className={cn("size-24", className)}
      fill="none"
    >
      <circle
        cx="48"
        cy="48"
        r="46"
        className="fill-card stroke-border"
        strokeWidth="1.5"
      />
      <circle
        cx="48"
        cy="48"
        r="33"
        className="stroke-brand-accent"
        strokeWidth="1.5"
      />
    </svg>
  )
}
