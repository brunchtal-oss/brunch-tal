import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { ContentStatusChip, type ChipStatus } from "./content-status-chip"

// DESIGN › content-section-row: one row of a list, the whole row one target
// (a link), its name in body-strong, a short detail in body-sm ink-muted,
// its chips at inline-end and a decorative chevron.
export function ContentRow({
  href,
  title,
  detail,
  chips = [],
}: {
  href: string
  title: string
  detail?: string
  chips?: readonly ChipStatus[]
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <Link href={href} className="flex min-h-12 items-center gap-3 py-3">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-base leading-[1.35] font-semibold">
            {title}
          </span>
          {detail && (
            <span className="text-[15px] text-pretty text-muted-foreground">
              {detail}
            </span>
          )}
        </span>
        {chips.length > 0 && (
          <span className="flex shrink-0 flex-col items-end gap-1">
            {chips.map((chip) => (
              <ContentStatusChip key={chip} status={chip} />
            ))}
          </span>
        )}
        <ChevronLeftIcon
          aria-hidden
          strokeWidth={1.5}
          className="size-5 shrink-0 text-muted-foreground"
        />
      </Link>
    </li>
  )
}
