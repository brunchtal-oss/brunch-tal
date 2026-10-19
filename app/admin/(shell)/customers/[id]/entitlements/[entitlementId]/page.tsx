import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { EntryMeter, METER_MAX } from "@/components/customer/balance-card"
import { PageHeading } from "@/components/shared/page-heading"
import { ResultNoticeHost } from "@/components/shared/result-notice"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { formatLocalDate, formatShortDate } from "@/lib/time"

import { PageSection } from "../../../../home/home-section"
import { customerHref } from "../../../../customers/customer-items"
import { EntryRow } from "../../../entry-lines"
import { OPEN_CARDS_PATH } from "../../../open-cards/open-cards-items"
import { BackLink } from "../../back-link"
import { CorrectionRow } from "./correction-row"
import {
  draftOf,
  fieldEditable,
  meterTotal,
  historyItems,
  nameOf,
  pageEntries,
  segmentMatches,
  sessionOptions,
  termRows,
} from "./entitlement-items"
import { loadEntitlement } from "./load-entitlement"

const copy = adminCopy.customers.entitlement
const cardCopy = adminCopy.customers.card

export const metadata: Metadata = {
  title: copy.title,
}

// One card and its corrections (story 3.13, AD-2 seed
// customers/[id]/entitlements/[entitlementId]): the header (product,
// customer, when bought), the balance as on the customer card, then "תוקף
// ותנאים": one row per correctable field with "שינוי" (each a sensitive
// action: entitlement_expiry, entitlement_units, entitlement_terms), then
// the history of corrections, newest first. A purchase not bound yet sits
// under customers/unbound/…. All values come from admin_get_entitlement.
export default function EntitlementPage({
  params,
}: {
  params: Promise<{ id: string; entitlementId: string }>
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
  params: Promise<{ id: string; entitlementId: string }>
}) {
  const { id, entitlementId } = await params
  const page = await loadEntitlement(entitlementId)
  if (!segmentMatches(id, page)) notFound()

  const name = nameOf(page.customer_label)
  const terms = termRows(page)
  const history = historyItems(page)
  const entries = pageEntries(page)
  const sessions = sessionOptions(page)
  const initial = draftOf(page)
  const total = meterTotal(page)
  const chip =
    page.status !== "active"
      ? cardCopy.cancelled
      : page.is_expired
        ? cardCopy.expired
        : null

  return (
    <ResultNoticeHost className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <BackLink
          href={
            page.customer_id ? customerHref(page.customer_id) : OPEN_CARDS_PATH
          }
        >
          {page.customer_id ? copy.backToCustomer(name) : copy.backToOpenCards}
        </BackLink>
        <div className="flex items-start gap-2">
          <PageHeading className="min-w-0 flex-1">
            <bdi className="break-words">{page.product_name ?? copy.title}</bdi>
          </PageHeading>
          {chip && (
            <StatusChip tone="expired" className="mt-2">
              {chip}
            </StatusChip>
          )}
        </div>
        <p className="flex flex-wrap gap-x-3 text-base text-muted-foreground">
          <bdi className="font-semibold text-foreground">{name}</bdi>
          <time dateTime={formatLocalDate(page.paid_on)}>
            {copy.purchased(formatShortDate(page.paid_on))}
          </time>
        </p>
      </header>

      <section
        aria-label={cardCopy.balances}
        className="flex flex-col gap-3 rounded-lg bg-muted px-4 py-4"
      >
        {total > 0 && total <= METER_MAX && (
          <EntryMeter used={page.used} reserved={page.reserved} total={total} />
        )}
        <p className="text-base">
          <bdi>
            {cardCopy.balanceSummary(page.used, page.reserved, page.available)}
          </bdi>
        </p>
        {entries.length > 0 && (
          <ul className="flex flex-col gap-2">
            {entries.map((line) => (
              <EntryRow key={line.key} line={line} />
            ))}
          </ul>
        )}
      </section>

      <PageSection id="entitlement-terms" title={copy.termsTitle}>
        {!page.correctable && (
          <p className="text-base text-muted-foreground">
            {copy.notCorrectable}
          </p>
        )}
        <ul className="flex flex-col">
          {terms.map((row) => (
            <CorrectionRow
              key={row.field}
              entitlementId={page.entitlement_id}
              field={row.field}
              label={row.label}
              value={row.value}
              note={row.note}
              initial={initial}
              validFrom={page.valid_from}
              reserved={page.reserved}
              sessions={sessions}
              customerName={name}
              hasCustomer={page.customer_id !== null}
              editable={page.correctable && fieldEditable(row.field, page.kind)}
            />
          ))}
        </ul>
      </PageSection>

      <PageSection id="entitlement-history" title={copy.historyTitle}>
        {history.length === 0 ? (
          <p className="text-base text-muted-foreground">{copy.historyEmpty}</p>
        ) : (
          <ol className="flex flex-col">
            {history.map((item) => (
              <li
                key={item.key}
                className="flex flex-col gap-1 border-b border-border py-3 first:border-t"
              >
                <p className="text-base font-semibold break-words">
                  <bdi>{item.change}</bdi>
                </p>
                {item.week && (
                  <p className="text-[15px] break-words">
                    <bdi>{item.week}</bdi>
                  </p>
                )}
                {item.session && (
                  <p className="text-[15px] break-words">
                    <bdi>{item.session}</bdi>
                  </p>
                )}
                {item.reason && (
                  <p className="text-[15px] break-words">
                    <bdi>{item.reason}</bdi>
                  </p>
                )}
                <p className="text-[13px] text-muted-foreground">
                  <time dateTime={item.at}>
                    <bdi>{item.who}</bdi>
                  </time>
                </p>
              </li>
            ))}
          </ol>
        )}
      </PageSection>
    </ResultNoticeHost>
  )
}
