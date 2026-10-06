import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { StatusChip } from "@/components/shared/status-chip"
import { customerCopy } from "@/lib/copy/customer"
import { formatDayMonth, formatLocalDate } from "@/lib/time"
import { cn } from "@/lib/utils"

// The meter is drawn only for a card of a few entries; beyond that the text
// alone says it.
export const METER_MAX = 12

// DESIGN.md › balance-card, on home only: the active card (user decision
// 2026-10-06). The product name links to the purchase's detail (a single
// target: its ::after covers the card; the chevron is decorative). Under
// it, one plate per entry: filled for used, accent for booked, an empty
// ring for free (decorative: the line after it says it in words), then
// "ניצלת X/N · נרשמת Y/N" and "בתוקף עד DD.MM". Expiring (is_expiring from
// the server): "עוד n ימים" and a warning status-chip, no button. All
// values come from get_my_entitlements (AD-14); nothing is computed here.
export function BalanceCard({
  href,
  productName,
  used,
  reserved,
  total,
  expiresOn,
  daysLeft,
  isExpiring = false,
  awaiting = false,
}: {
  href: string
  productName: string
  used: number
  reserved: number
  total: number
  expiresOn: string
  daysLeft?: number
  isExpiring?: boolean
  // A returned entry that waits for the next sessions (story 3.6): the
  // words in place of the validity.
  awaiting?: boolean
}) {
  return (
    <div className="relative flex flex-col gap-3 rounded-lg bg-muted px-4 py-4 pe-10">
      <Link
        href={href}
        className="self-start rounded-[4px] text-[17px] font-semibold after:absolute after:inset-0 after:rounded-lg after:content-['']"
      >
        <bdi>{productName}</bdi>
      </Link>
      {total > 0 && total <= METER_MAX && (
        <EntryMeter used={used} reserved={reserved} total={total} />
      )}
      <div className="flex flex-col gap-0.5">
        <p className="flex flex-wrap gap-x-4 text-base">
          <bdi>{customerCopy.usedOf(used, total)}</bdi>
          <bdi>{customerCopy.bookedOf(reserved, total)}</bdi>
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted-foreground">
          {awaiting ? (
            <span>{customerCopy.awaitingSessions}</span>
          ) : (
            <span>
              {customerCopy.validUntil}{" "}
              <time dateTime={formatLocalDate(expiresOn)}>
                <bdi>{formatDayMonth(expiresOn)}</bdi>
              </time>
              {isExpiring && daysLeft !== undefined && (
                <> · {customerCopy.daysLeft(daysLeft)}</>
              )}
            </span>
          )}
          {isExpiring && !awaiting && (
            <StatusChip tone="warning">{customerCopy.expiring}</StatusChip>
          )}
        </p>
      </div>
      <ChevronLeftIcon
        aria-hidden
        strokeWidth={1.5}
        className="absolute end-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

// One plate per entry, in order: used, then booked, then free.
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
