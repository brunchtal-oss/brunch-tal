import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { StatusChip, type StatusTone } from "@/components/shared/status-chip"

export type TaskRowProps = {
  href: string
  title: string
  detail?: string | null
  // A meta line ("מאז DD.MM"); metaAt is its local date for <time>.
  meta?: string | null
  metaAt?: string | null
  chip?: { tone: StatusTone; label: string } | null
}

// DESIGN.md › task-row (story 4.1): a "לטיפול" row with the look of
// notification-item. A divider, 16px padding, the title in body-strong
// (what happened), the detail in body-sm (what to do), the meta in label
// ink-muted, a status-chip at inline-end and a decorative chevron (mirrored
// in RTL). The whole row is one target: the title link's ::after covers
// it; no buttons inside. The link's accessible name is the title plus the
// status (EXPERIENCE › task-row).
// Each sentence of the detail on its own line, without its closing period
// (user decision 2026-10-06: break at the period). Only ". " splits, so a
// date such as "16.10" stays whole.
export function detailLines(detail: string): string[] {
  return detail
    .split(/\.\s+/)
    .map((line) => line.replace(/\.$/, "").trim())
    .filter((line) => line !== "")
}

export function TaskRow({
  href,
  title,
  detail,
  meta,
  metaAt,
  chip,
}: TaskRowProps) {
  return (
    <li className="relative flex min-h-11 flex-col gap-0.5 border-b border-border py-4 first:border-t">
      {/* Only the title shares its line with the chip and the chevron; the
          detail and the meta take the row's full width (phone check
          2026-10-06). */}
      <div className="flex items-start gap-2.5">
        <Link
          href={href}
          className="min-w-0 flex-1 rounded-[4px] text-base leading-[1.35] font-semibold after:absolute after:inset-0 after:content-['']"
        >
          <bdi className="break-words">{title}</bdi>
          {chip && <span className="sr-only">{`, ${chip.label}`}</span>}
        </Link>
        {/* Read once, as part of the link's name. */}
        {chip && (
          <span aria-hidden className="mt-0.5 shrink-0">
            <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
          </span>
        )}
        <ChevronLeftIcon
          aria-hidden
          strokeWidth={1.5}
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
      </div>
      {detail && (
        <p className="text-[15px]">
          {detailLines(detail).map((line, i) => (
            <bdi key={i} className="block">
              {line}
            </bdi>
          ))}
        </p>
      )}
      {meta && (
        <p className="mt-1 text-[13px] leading-[1.4] text-muted-foreground">
          {metaAt ? (
            <time dateTime={metaAt}>
              <bdi>{meta}</bdi>
            </time>
          ) : (
            <bdi>{meta}</bdi>
          )}
        </p>
      )}
    </li>
  )
}
