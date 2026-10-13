import { cn } from "@/lib/utils"

import type { EntryLine } from "./[id]/card-items"

// One entry of a card, on the customer card and in the open cards list
// (story 4.3: moved here unchanged, so a card reads the same in both). The
// dot repeats the meter's plate (decorative; the words say it). A used or
// booked entry has the session's title under it, as in the customer's log.
export function EntryRow({ line }: { line: EntryLine }) {
  return (
    <li className="flex items-start gap-2 text-[15px]">
      <span
        aria-hidden
        className={cn(
          "mt-1 size-3 shrink-0 rounded-full",
          line.kind === "used"
            ? "bg-primary"
            : line.kind === "booked"
              ? "bg-brand-accent"
              : "border border-brand-accent"
        )}
      />
      <span className="flex min-w-0 flex-col">
        <bdi>{line.text}</bdi>
        {line.title && (
          <bdi className="text-muted-foreground">{line.title}</bdi>
        )}
      </span>
    </li>
  )
}
