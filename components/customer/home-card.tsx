import Link from "next/link"

import { StatusChip } from "@/components/shared/status-chip"
import { customerCopy } from "@/lib/copy/customer"
import { formatDayMonth, formatLocalDate } from "@/lib/time"
import { cn } from "@/lib/utils"

import { METER_MAX } from "./balance-card"

// DESIGN.md › home-card (design round, user decision 2026-10-07): "הכרטיסייה
// שלי" on the customer home, in place of balance-card there. No frame and
// no fill: it sits on the page. The product name (body-sm ink-muted) links
// to the purchase's detail and its ::after covers the card (one target).
// Then the free entries in numeral-xl with "כניסות זמינות" beside it in
// body (numeral-lg when another card already has the screen's one
// numeral-xl), a bar of one part per entry (free primary, booked accent,
// used border; decorative, the legend says it in words), the legend
// "נרשמת X/N" and "ניצלת X/N" with a key in each part's colour, and "בתוקף
// עד DD.MM" in ink-muted. Expiring (is_expiring from the server): "עוד n
// ימים" and a warning status-chip. Every value comes from
// get_my_entitlements (AD-14); nothing is computed here.
export function HomeCard({
  href,
  productName,
  available,
  reserved,
  used,
  total,
  expiresOn,
  daysLeft,
  isExpiring = false,
  prominent = true,
}: {
  href: string
  productName: string
  available: number
  reserved: number
  used: number
  total: number
  expiresOn: string
  daysLeft?: number
  isExpiring?: boolean
  // numeral-xl, at most once per screen; otherwise numeral-lg.
  prominent?: boolean
}) {
  return (
    <div className="relative flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link
          href={href}
          className="self-start rounded-lg text-[15px] leading-[1.5] text-muted-foreground after:absolute after:inset-0 after:content-['']"
        >
          <bdi>{productName}</bdi>
        </Link>
        <p className="flex items-baseline gap-2">
          <span
            data-numeral={prominent ? "xl" : "lg"}
            className={cn(
              "leading-none tabular-nums",
              prominent ? "text-[40px] font-light" : "text-[26px]"
            )}
          >
            {available}
          </span>
          <span className="text-base">
            {customerCopy.availableEntriesLabel}
          </span>
        </p>
      </div>
      {total > 0 && total <= METER_MAX && (
        <EntryBar available={available} reserved={reserved} total={total} />
      )}
      <div className="flex flex-col gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[15px] leading-[1.5]">
          <LegendItem keyClass="bg-brand-accent">
            {customerCopy.bookedOf(reserved, total)}
          </LegendItem>
          <LegendItem keyClass="bg-border">
            {customerCopy.usedOf(used, total)}
          </LegendItem>
        </ul>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-[1.5] text-muted-foreground">
          <span>
            {customerCopy.validUntil}{" "}
            <time dateTime={formatLocalDate(expiresOn)}>
              <bdi>{formatDayMonth(expiresOn)}</bdi>
            </time>
            {isExpiring && daysLeft !== undefined && (
              <> · {customerCopy.daysLeft(daysLeft)}</>
            )}
          </span>
          {isExpiring && (
            <StatusChip tone="warning">{customerCopy.expiring}</StatusChip>
          )}
        </p>
      </div>
    </div>
  )
}

function LegendItem({
  keyClass,
  children,
}: {
  keyClass: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className={cn("h-1.5 w-2.5 rounded-full", keyClass)} />
      <bdi>{children}</bdi>
    </li>
  )
}

// One equal part per entry, height 6 and 4 apart: the free ones first
// (primary), then the booked (accent), then the used (border).
export function EntryBar({
  available,
  reserved,
  total,
}: {
  available: number
  reserved: number
  total: number
}) {
  return (
    <span
      aria-hidden
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: total }, (_, i) => {
        const entry =
          i < available ? "free" : i < available + reserved ? "booked" : "used"
        return (
          <span
            key={i}
            data-entry={entry}
            className={cn(
              "h-1.5 rounded-full",
              entry === "free"
                ? "bg-primary"
                : entry === "booked"
                  ? "bg-brand-accent"
                  : "bg-border"
            )}
          />
        )
      })}
    </span>
  )
}
