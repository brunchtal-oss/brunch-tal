import Link from "next/link"
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react"

import { EntryMeter } from "@/components/customer/balance-card"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { formatLocalDate } from "@/lib/time"
import { cn } from "@/lib/utils"

import { EntryRow } from "../entry-lines"
import type { BalanceItem, SingleItem } from "./card-items"

const copy = adminCopy.customers.card

// One entitlement on a muted plate: the product and its state, the meter,
// one summary line and the validity. The whole plate is one link to the
// card's page (story 3.13; fix 9): the product name's link stretches over
// the plate (after:absolute after:inset-0), named by entitlementLinkFor.
// The entries' disclosure sits above it (relative z-10), so it opens in
// place without navigating.
export function BalancePlate({
  item,
  href,
}: {
  item: BalanceItem
  href: string
}) {
  return (
    <li
      className={cn(
        "relative flex flex-col gap-3 rounded-lg bg-muted px-4 pt-4",
        item.entries.length > 0 ? "pb-1" : "pb-4"
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[17px] leading-[1.35] font-semibold">
          <Link
            href={href}
            aria-label={copy.entitlementLinkFor(item.productName)}
            className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
          >
            <bdi className="break-words">{item.productName}</bdi>
          </Link>
        </p>
        {item.chip && (
          <StatusChip tone={item.chip.tone} className="mt-0.5">
            {item.chip.label}
          </StatusChip>
        )}
        <ChevronLeftIcon
          aria-hidden
          strokeWidth={1.5}
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
      </div>
      {item.meter && (
        <EntryMeter
          used={item.used}
          reserved={item.reserved}
          total={item.total}
        />
      )}
      <div className="flex flex-col gap-1">
        <p className="text-base">
          <bdi>{item.summary}</bdi>
        </p>
        <p className="text-[15px] text-muted-foreground">
          <time dateTime={formatLocalDate(item.expiresOn)}>
            <bdi className="whitespace-nowrap">{item.until}</bdi>
            {item.extended && (
              <span className="ms-1 whitespace-nowrap">{copy.extended}</span>
            )}
          </time>
        </p>
      </div>
      {item.entries.length > 0 ? (
        <details className="group relative z-10 self-start">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 self-start text-[15px] font-semibold underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
            {copy.entriesToggle}
            <ChevronDownIcon
              aria-hidden
              strokeWidth={1.5}
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ul className="flex flex-col gap-2 pt-1 pb-3">
            {item.entries.map((line) => (
              <EntryRow key={line.key} line={line} />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  )
}

// A single entitlement not used yet: the product (and "expiring"), then
// its booked session or "to book" with the validity. No meter or counts.
export function SinglePlate({ item }: { item: SingleItem }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg bg-muted p-4">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[17px] leading-[1.35] font-semibold">
          <bdi className="break-words">{item.productName}</bdi>
        </p>
        {item.chip && (
          <StatusChip tone={item.chip.tone} className="mt-0.5">
            {item.chip.label}
          </StatusChip>
        )}
      </div>
      <p className="text-[15px] text-muted-foreground">
        <bdi>{item.line}</bdi>
      </p>
    </li>
  )
}
