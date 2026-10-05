import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

const copy = adminCopy.sessions.summary

export type SessionSummary = {
  occupied: number
  capacity: number
  bookings: number
  babies: number
  allergies: number
}

// DESIGN.md › summary-card (story 3.4): card with a border, four columns
// (places · bookings · babies · allergies), the number in numeral-lg and its
// label in label ink-muted; the allergies number in warning. Not
// interactive; each number is read with its label ("6 תינוקות"). Places come
// from private.occupied_places (a couple booking = 2); babies never count.
export function SummaryCard({ summary }: { summary: SessionSummary }) {
  const items = [
    {
      key: "places",
      value: `${summary.occupied}/${summary.capacity}`,
      label: copy.places,
    },
    { key: "bookings", value: String(summary.bookings), label: copy.bookings },
    { key: "babies", value: String(summary.babies), label: copy.babies },
    {
      key: "allergies",
      value: String(summary.allergies),
      label: copy.allergies,
      highlight: true,
    },
  ]
  return (
    <ul className="grid grid-cols-4 rounded-xl border border-border bg-card px-2 py-3">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex min-w-0 flex-col items-center gap-1.5 text-center"
        >
          <span
            className={cn(
              "text-[26px] leading-none tabular-nums",
              item.highlight && "text-warning"
            )}
          >
            <bdi dir="ltr">{item.value}</bdi>
          </span>{" "}
          <span className="text-[13px] leading-[1.4] text-muted-foreground">
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  )
}
