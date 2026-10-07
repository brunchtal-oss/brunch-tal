import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react"

import { EntryMeter } from "@/components/customer/balance-card"
import { PageHeading } from "@/components/shared/page-heading"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { formatLocalDate, localToday } from "@/lib/time"
import { cn } from "@/lib/utils"

import { HomeSection } from "../../home/home-section"
import { BackLink } from "./back-link"
import {
  balanceViews,
  cardHeader,
  detailRows,
  historyHref,
  toBabyItems,
  toNoteItem,
  type BalanceItem,
  type EntryLine,
  type SingleItem,
} from "./card-items"
import { CustomerNotes } from "./customer-notes"
import { loadCard } from "./load-card"

const copy = adminCopy.customers.card

export const metadata: Metadata = {
  title: adminCopy.customers.title,
}

// The customer card (story 4.2, CAP-25; phone check, user decision
// 2026-10-07, and the second phone check): the header (name, phone, "not
// activated") → details (photo consent read only) and babies → balances
// and validity: each card opening in place to its entries, then the open
// singles → links to the booking and purchase histories → internal notes,
// marked as Tal's only. No notifications. All
// values come from admin_get_customer. Rendered inside the admin shell's
// <Suspense> gate.
export default function CustomerCardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <CustomerCardContent params={params} />
    </Suspense>
  )
}

async function CustomerCardContent({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const card = await loadCard(id)
  const header = cardHeader(card.profile)
  const balances = balanceViews(card.entitlements)
  const babies = toBabyItems(card.babies, localToday())

  return (
    <>
      <header className="flex flex-col gap-1">
        <BackLink href="/admin/customers">{copy.back}</BackLink>
        <PageHeading>
          <bdi>{header.name}</bdi>
        </PageHeading>
        {(header.phone || header.notActivated) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted-foreground">
            {header.phone && <bdi dir="ltr">{header.phone}</bdi>}
            {header.notActivated && (
              <StatusChip tone="pending">
                {adminCopy.customers.notActivated}
              </StatusChip>
            )}
          </p>
        )}
      </header>

      <HomeSection id="card-details" title={copy.details}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {detailRows(card.profile).map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5">
              <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
              <dd className="text-base break-words">
                {typeof row.value === "string" ? (
                  <bdi dir={row.ltr ? "ltr" : undefined}>{row.value}</bdi>
                ) : (
                  row.value.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))
                )}
              </dd>
            </div>
          ))}
        </dl>
      </HomeSection>

      <HomeSection id="card-babies" title={copy.babies}>
        {babies.length === 0 ? (
          <Muted>{copy.noBabies}</Muted>
        ) : (
          <ul className="flex flex-col gap-1">
            {babies.map((baby) => (
              <li key={baby.key} className="text-base">
                <bdi className="font-semibold">{baby.name}</bdi>
                {baby.age && (
                  <span className="text-muted-foreground">, {baby.age}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </HomeSection>

      <HomeSection id="card-balances" title={copy.balances}>
        {balances.length === 0 ? (
          <Muted>{copy.noBalances}</Muted>
        ) : (
          <ul className="flex flex-col gap-3">
            {balances.map((item) =>
              item.variant === "card" ? (
                <BalancePlate key={item.key} item={item} />
              ) : (
                <SinglePlate key={item.key} item={item} />
              )
            )}
          </ul>
        )}
      </HomeSection>

      <HomeSection id="card-history" title={copy.history}>
        <ul className="-mx-3 flex flex-col">
          <HistoryLink href={historyHref(card.profile.id, "bookings")}>
            {copy.bookingsLink(card.bookings.length)}
          </HistoryLink>
          <HistoryLink href={historyHref(card.profile.id, "purchases")}>
            {copy.purchasesLink(card.payments.length)}
          </HistoryLink>
        </ul>
      </HomeSection>

      <HomeSection
        id="card-notes"
        title={copy.notes}
        aside={
          <span className="text-[13px] text-muted-foreground">
            {copy.notesHint}
          </span>
        }
      >
        <CustomerNotes
          customerId={card.profile.id}
          notes={card.notes.map(toNoteItem)}
        />
      </HomeSection>
    </>
  )
}

// One entitlement on a muted plate: the product and its state, the meter,
// one summary line and the validity. A card opens in place (a native
// disclosure) to one line per entry.
function BalancePlate({ item }: { item: BalanceItem }) {
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg bg-muted px-4 pt-4",
        item.entries.length > 0 ? "pb-1" : "pb-4"
      )}
    >
      <div className="flex items-start gap-2.5">
        <p className="min-w-0 flex-1 text-[17px] leading-[1.35] font-semibold">
          <bdi className="break-words">{item.productName}</bdi>
        </p>
        {item.chip && (
          <StatusChip tone={item.chip.tone} className="mt-0.5">
            {item.chip.label}
          </StatusChip>
        )}
      </div>
      {item.meter && (
        <EntryMeter
          used={item.used}
          reserved={item.reserved}
          total={item.total}
        />
      )}
      <div className="flex flex-col gap-0.5">
        <p className="text-base">
          <bdi>{item.summary}</bdi>
        </p>
        <p className="text-[15px] text-muted-foreground">
          <time dateTime={formatLocalDate(item.expiresOn)}>
            <bdi className="whitespace-nowrap">{item.until}</bdi>
          </time>
        </p>
      </div>
      {item.entries.length > 0 ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 self-start text-[15px] font-semibold underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
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
function SinglePlate({ item }: { item: SingleItem }) {
  return (
    <li className="flex flex-col gap-1 rounded-lg bg-muted p-4">
      <div className="flex items-start gap-2.5">
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

// The dot repeats the meter's plate (decorative; the words say it).
function EntryRow({ line }: { line: EntryLine }) {
  return (
    <li className="flex items-center gap-2.5 text-[15px]">
      <span
        aria-hidden
        className={cn(
          "size-3 shrink-0 rounded-full",
          line.kind === "used"
            ? "bg-primary"
            : line.kind === "booked"
              ? "bg-brand-accent"
              : "border border-brand-accent"
        )}
      />
      <bdi>{line.text}</bdi>
    </li>
  )
}

function HistoryLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-3 text-base hover:bg-muted"
      >
        {children}
        <ChevronLeftIcon
          aria-hidden
          strokeWidth={1.5}
          className="size-5 shrink-0 text-muted-foreground"
        />
      </Link>
    </li>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-base text-muted-foreground">{children}</p>
}
