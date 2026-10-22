import { cn } from "@/lib/utils"

// The meter is drawn only for a card of a few entries; beyond that the text
// alone says it.
export const METER_MAX = 12

// One plate per entry, in order: used (filled), booked (accent), free (an
// empty ring). Decorative: the line after it says it in words. All values
// come from the server (AD-14); nothing is computed here.
export function EntryMeter({
  used,
  reserved,
  total,
}: {
  used: number
  reserved: number
  total: number
}) {
  return (
    <span aria-hidden className="flex gap-2">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          data-entry={
            i < used ? "used" : i < used + reserved ? "booked" : "free"
          }
          className={cn(
            "size-4 rounded-full",
            i < used
              ? "bg-primary"
              : i < used + reserved
                ? "bg-brand-accent"
                : "border border-brand-accent"
          )}
        />
      ))}
    </span>
  )
}
