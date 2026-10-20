import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { buttonClass } from "@/components/shared/button-class"
import { PageHeading } from "@/components/shared/page-heading"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { localToday } from "@/lib/time"

import { PageSection } from "../../home/home-section"
import { CardActions, ContactRows } from "./account-section"
import { BabiesRow } from "./babies-row"
import { BackLink } from "./back-link"
import { BalancePlate, SinglePlate } from "./balance-plates"
import {
  accountView,
  balanceViews,
  cardHeader,
  detailRows,
  ACTION_BUTTON,
  historyHref,
  toBabyItems,
  toNoteItem,
} from "./card-items"
import { parseCustomerCredits, toCustomerCreditItem } from "./credit-items"
import { CreditsSection } from "./credits-section"
import { CustomerNotes } from "./customer-notes"
import { entitlementHref } from "./entitlements/[entitlementId]/entitlement-items"
import { HistoryDisclosure } from "./history-disclosure"
import { loadAccount, loadCardOrRemoved, loadCredits } from "./load-card"
import { RemovedCard, RemoveDetails } from "./remove-details"

const copy = adminCopy.customers.card

export const metadata: Metadata = {
  title: adminCopy.customers.title,
}

// The customer card (story 4.2, CAP-25; fix 9, user decision 2026-10-19):
// (1) the header: her name (and "not activated"), then side by side "reset
// link" (story 2.8) and "book for a session" (story 3.19), the link's
// status and the issued link under them; (2) "פרטים" in a cube: phone and
// email (a pencil each opens the 2.8 change), joined, last activity,
// dietary, photo consents (read only), babies; (3) balances and validity:
// each card plate one link to its page (story 3.13), opening in place to
// its entries, then the open singles; (4) credits and refunds (story 3.9,
// 3.16); (5) the history, closed, to the bookings and purchases pages;
// (6) internal notes, marked as Tal's only. No notifications. All values
// come from admin_get_customer. Rendered inside the admin shell's
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
  // The card first: a bad id or a non-customer is notFound(), and a removed
  // customer (story 4.6) is her tombstone only, without the account and
  // credits reads (both refuse a removed profile).
  const loaded = await loadCardOrRemoved(id)
  if ("removed" in loaded) return <RemovedCard profile={loaded.removed} />
  const { card } = loaded
  const [accountRow, creditRows] = await Promise.all([
    loadAccount(id),
    // Story 3.9: her credits and refunds (admin_list_customer_credits).
    loadCredits(id),
  ])
  const account = accountView(accountRow)
  const header = cardHeader(card.profile)
  const balances = balanceViews(card.entitlements)
  const babies = toBabyItems(card.babies, localToday())
  const credits = parseCustomerCredits(creditRows).map(toCustomerCreditItem)

  return (
    <>
      <header className="flex flex-col gap-1">
        <BackLink href="/admin/customers">{copy.back}</BackLink>
        <PageHeading>
          <bdi>{header.name}</bdi>
        </PageHeading>
        {header.notActivated && (
          <StatusChip tone="pending" className="self-start">
            {adminCopy.customers.notActivated}
          </StatusChip>
        )}
      </header>

      {/* The details with the card's two actions right under them (phone
          check, user decision 2026-10-21). */}
      <div className="flex flex-col gap-3">
        <PageSection id="card-details" title={copy.details} boxed>
          <dl className="flex flex-col divide-y divide-border [&>div]:py-3 [&>div:first-child]:pt-0 [&>div:last-child]:pb-0">
            <ContactRows
              customerId={card.profile.id}
              email={card.profile.email ?? ""}
              phone={header.phone ?? ""}
              view={account}
            />
            {detailRows(card.profile).map((row) => (
              <div key={row.label} className="flex flex-col gap-1">
                <dt className="text-[13px] text-muted-foreground">
                  {row.label}
                </dt>
                <dd className="text-base break-words">
                  {typeof row.value === "string" ? (
                    <bdi>{row.value}</bdi>
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
            <BabiesRow babies={babies} />
          </dl>
        </PageSection>

        {/* Story 3.19 (user decision 2026-10-19): the manual booking screen
            from her card; neither it nor the reset link before she is
            activated (both would refuse). */}
        {!header.notActivated && (
          <CardActions customerId={card.profile.id} view={account}>
            <Link
              href={`/admin/sessions/book?customer=${encodeURIComponent(card.profile.id)}`}
              className={buttonClass({ size: "lg", className: ACTION_BUTTON })}
            >
              {copy.book}
            </Link>
          </CardActions>
        )}
      </div>

      <PageSection id="card-balances" title={copy.balances}>
        {balances.length === 0 ? (
          <Muted>{copy.noBalances}</Muted>
        ) : (
          <ul className="flex flex-col gap-3">
            {balances.map((item) =>
              item.variant === "card" ? (
                <BalancePlate
                  key={item.key}
                  item={item}
                  href={entitlementHref(card.profile.id, item.key)}
                />
              ) : (
                <SinglePlate key={item.key} item={item} />
              )
            )}
          </ul>
        )}
      </PageSection>

      <PageSection id="card-credits" title={copy.credits.title}>
        <CreditsSection items={credits} customerName={header.name} />
      </PageSection>

      <HistoryDisclosure id="card-history" title={copy.history}>
        <HistoryLink href={historyHref(card.profile.id, "bookings")}>
          {copy.bookingsLink(card.bookings.length)}
        </HistoryLink>
        <HistoryLink href={historyHref(card.profile.id, "purchases")}>
          {copy.purchasesLink(card.payments.length)}
        </HistoryLink>
      </HistoryDisclosure>

      <PageSection
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
      </PageSection>

      {/* Story 4.6: removing her personal details, at the very bottom of the
          card, after the notes (phone check, user decision 2026-10-21). */}
      <div className="border-t border-border pt-6">
        <RemoveDetails customerId={card.profile.id} />
      </div>
    </>
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
