import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"

import { EntryMeter, METER_MAX } from "@/components/customer/balance-card"
import { PageHeading } from "@/components/shared/page-heading"
import { StatusChip } from "@/components/shared/status-chip"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"
import { formatDayMonth, formatLocalDate } from "@/lib/time"

import { loadMyEntitlements, pinnedConceptNames } from "../../load-entitlements"
import { creditChip, entitlementName, pastStatus } from "../../purchase-items"
import { buildHistory } from "./history"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: shellCopy.nav.purchases,
}

// One purchase of hers (story 4.12, CAP-9; below the purchase history,
// user decision 2026-10-06): back to the history, the name (h1), one line
// with the purchase date and the validity (or the word of an ended one; no
// price, user decision 2026-10-08), and for a card its entries ("ניצלת X/N
// · נרשמת Y/N" with the plates); then the movement log: one row per
// booking by its state, with the session's day and title. Every balance comes from
// get_my_entitlements; the movements, bookings and sessions from RLS. An id
// that is not hers, or does not exist, is a plain 404 (nothing about it is
// shown). Rendered inside the layout's customer gate.
export default function EntitlementPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <EntitlementContent params={params} />
    </Suspense>
  )
}

async function EntitlementContent({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const supabase = await createClient()
  const entitlement = (await loadMyEntitlements(supabase)).find(
    (e) => e.id === id
  )
  if (!entitlement) notFound()

  const [names, movementsResult] = await Promise.all([
    pinnedConceptNames(supabase, [entitlement]),
    supabase
      .from("entitlement_movements")
      .select("id, booking_id, action, units, created_at")
      .eq("entitlement_id", id)
      .order("created_at")
      .order("id"),
  ])
  if (movementsResult.error) throw new Error("movements failed")
  const movements = movementsResult.data

  const bookingIds = [...new Set(movements.flatMap((m) => m.booking_id ?? []))]
  const bookingsResult = bookingIds.length
    ? await supabase
        .from("bookings")
        .select("id, event_id")
        .in("id", bookingIds)
    : { data: [], error: null }
  if (bookingsResult.error) throw new Error("bookings failed")
  const eventIds = [...new Set(bookingsResult.data.map((b) => b.event_id))]
  const sessionsResult = eventIds.length
    ? await supabase
        .from("events")
        .select("id, starts_at, concepts(name)")
        .in("id", eventIds)
    : { data: [], error: null }
  if (sessionsResult.error) throw new Error("sessions failed")

  const history = buildHistory({
    movements,
    bookings: bookingsResult.data,
    sessions: sessionsResult.data.map((e) => ({
      id: e.id,
      starts_at: e.starts_at,
      concept_name: e.concepts?.name ?? "",
    })),
  })
  const past = pastStatus(entitlement)
  const isCard = entitlement.kind === "card"
  // Story 3.7: a pinned purchase that became a credit or a refund request.
  const chip = creditChip(entitlement)

  return (
    <div className="flex flex-col gap-8 pb-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/me/purchases"
          className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] text-muted-foreground"
        >
          <ChevronRightIcon aria-hidden strokeWidth={1.5} className="size-4" />
          {customerCopy.backToPurchases}
        </Link>
        <PageHeading>
          <bdi>{entitlementName(entitlement, names)}</bdi>
        </PageHeading>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-muted-foreground">
          <span>
            {customerCopy.purchasedOn}{" "}
            <time dateTime={entitlement.paidOn}>
              <bdi>{formatDayMonth(entitlement.paidOn)}</bdi>
            </time>
          </span>
          {chip ? (
            <StatusChip tone="pending">{chip}</StatusChip>
          ) : past ? (
            <span>{past}</span>
          ) : (
            <span>
              {customerCopy.validUntil}{" "}
              <time dateTime={formatLocalDate(entitlement.expiresOn)}>
                <bdi>{formatDayMonth(entitlement.expiresOn)}</bdi>
              </time>
              {entitlement.isExpiring && (
                <> · {customerCopy.daysLeft(entitlement.daysLeft)}</>
              )}
            </span>
          )}
          {!past && entitlement.isExpiring && (
            <StatusChip tone="warning">{customerCopy.expiring}</StatusChip>
          )}
        </div>
        {isCard && (
          <div className="mt-2 flex flex-col gap-2">
            {entitlement.originalUnits > 0 &&
              entitlement.originalUnits <= METER_MAX && (
                <EntryMeter
                  used={entitlement.used}
                  reserved={entitlement.reserved}
                  total={entitlement.originalUnits}
                />
              )}
            <p className="flex flex-wrap gap-x-4 text-base">
              <bdi>
                {customerCopy.usedOf(
                  entitlement.used,
                  entitlement.originalUnits
                )}
              </bdi>
              <bdi>
                {customerCopy.bookedOf(
                  entitlement.reserved,
                  entitlement.originalUnits
                )}
              </bdi>
            </p>
          </div>
        )}
      </div>

      <section aria-labelledby="history-title" className="flex flex-col gap-3">
        <h2
          id="history-title"
          className="font-heading text-[22px] leading-[1.25] font-light"
        >
          {customerCopy.historyTitle}
        </h2>
        {history.length === 0 ? (
          <p className="text-[15px]">{customerCopy.historyEmpty}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border border-y border-border">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 py-3">
                {entry.kind === "booking" ? (
                  <>
                    <span className="text-base font-semibold">
                      {entry.label}
                      {entry.day && entry.startsAt && (
                        <>
                          {" · "}
                          <time dateTime={formatLocalDate(entry.startsAt)}>
                            <bdi>{entry.day}</bdi>
                          </time>
                        </>
                      )}
                    </span>
                    {entry.title && (
                      <bdi className="text-[15px] text-muted-foreground">
                        {entry.title}
                      </bdi>
                    )}
                  </>
                ) : (
                  <span className="flex items-baseline justify-between gap-4 text-base font-semibold">
                    <span>
                      {entry.label}
                      {" · "}
                      <time dateTime={formatLocalDate(entry.createdAt)}>
                        <bdi>{formatDayMonth(entry.createdAt)}</bdi>
                      </time>
                    </span>
                    {entry.units && (
                      <bdi dir="ltr" className="tabular-nums">
                        {entry.units}
                      </bdi>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
