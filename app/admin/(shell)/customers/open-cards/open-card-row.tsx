import Link from "next/link"

import { buttonClass } from "@/components/shared/button-class"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { formatLocalDate } from "@/lib/time"

import { EntryRow } from "../entry-lines"
import type { OpenCardItem } from "./open-cards-items"

const copy = adminCopy.customers.openCards

const SECONDARY = buttonClass({
  variant: "outline",
  size: "lg",
  className:
    "h-auto min-h-11 rounded-[4px] border-foreground bg-transparent px-3 text-[15px] leading-[1.2] font-semibold whitespace-normal text-foreground",
})

// DESIGN › open-card-row (story 4.3, CAP-42): not a link as a whole. The
// customer and the "expiring" chip, the product, when it was bought and
// until when it is valid, one line per entry (the customer card's lines),
// then "לרישום למפגש" and "לפרופיל" as two separate buttons. A purchase
// not bound yet has no buttons. The row targeted from the home
// (#card-{id}) is outlined in primary: by :target on a full load, and by
// data-targeted (OpenCardTarget) after a client navigation.
export function OpenCardRow({ item }: { item: OpenCardItem }) {
  return (
    <li
      id={item.anchor}
      className="flex scroll-mt-24 flex-col gap-3 rounded-md border border-border bg-card px-4 py-3 target:border-primary target:ring-2 target:ring-primary data-targeted:border-primary data-targeted:ring-2 data-targeted:ring-primary"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-base leading-[1.35] font-semibold">
            <bdi className="break-words">{item.name}</bdi>
          </p>
          {item.chip && (
            <StatusChip tone={item.chip.tone} className="mt-0.5">
              {item.chip.label}
            </StatusChip>
          )}
        </div>
        {item.productName && (
          <p className="text-[15px]">
            <bdi className="break-words">{item.productName}</bdi>
          </p>
        )}
        <p className="flex flex-wrap gap-x-3 text-[13px] text-muted-foreground">
          <time dateTime={formatLocalDate(item.paidOn)}>
            <bdi className="whitespace-nowrap">{item.purchased}</bdi>
          </time>
          <time dateTime={formatLocalDate(item.expiresOn)}>
            <bdi className="whitespace-nowrap">{item.until}</bdi>
          </time>
        </p>
      </div>
      {item.entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {item.entries.map((line) => (
            <EntryRow key={line.key} line={line} />
          ))}
        </ul>
      )}
      {/* A purchase not bound yet has no account to book or open (user
          decision 2026-10-13): say why there are no buttons. */}
      {!item.bookHref && (
        <p className="text-[15px] text-muted-foreground">{copy.notJoined}</p>
      )}
      {item.bookHref && item.profileHref && (
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={item.bookHref}
            aria-label={copy.bookFor(item.name)}
            className={SECONDARY}
          >
            {copy.book}
          </Link>
          <Link
            href={item.profileHref}
            aria-label={copy.profileOf(item.name)}
            className={SECONDARY}
          >
            {copy.profile}
          </Link>
        </div>
      )}
    </li>
  )
}
