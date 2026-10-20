import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { buttonClass } from "@/components/shared/button-class"
import { PageHeading } from "@/components/shared/page-heading"
import { sectionTitleClass } from "@/components/shared/section-title"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

import { CustomersSwitch } from "../customers-switch"
import { OpenCardRow } from "./open-card-row"
import { OpenCardTarget } from "./open-card-target"
import {
  filterHref,
  filterItems,
  parseFilter,
  toOpenCardItem,
  type OpenCardRow as OpenCardRowData,
  type OpenCardsFilter,
} from "./open-cards-items"

const copy = adminCopy.customers.openCards

export const metadata: Metadata = {
  title: copy.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// /admin/customers/open-cards (story 4.3, CAP-42): every open card with its
// entries, by expiry, filtered by ?filter= (all, free entries, expiring).
// The rows come from admin_list_open_cards; the home's "expiring" rows open
// it filtered, at one card. Rendered inside the admin shell's <Suspense>
// gate.
export default function OpenCardsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <CustomersSwitch current="open-cards" />
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <OpenCardsContent searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function loadOpenCards(
  filter: OpenCardsFilter
): Promise<OpenCardRowData[]> {
  const result = await callRpc(await createClient(), "admin_list_open_cards", {
    p_filter: filter,
  })
  if (!result.ok) throw new Error("admin_list_open_cards failed")
  return result.data as unknown as OpenCardRowData[]
}

async function OpenCardsContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const filter = parseFilter(await searchParams)
  const items = (await loadOpenCards(filter)).map(toOpenCardItem)

  return (
    <div className="flex flex-col gap-4">
      <Filters current={filter} />
      {items.length === 0 ? (
        <EmptyOpenCards filtered={filter !== "all"} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <OpenCardRow key={item.key} item={item} />
          ))}
        </ul>
      )}
      <OpenCardTarget key={filter} />
    </div>
  )
}

// One link per filter, wrapping; the selected one in primary with
// aria-current (as the notes' topics).
function Filters({ current }: { current: OpenCardsFilter }) {
  return (
    <nav aria-label={copy.filtersNav}>
      <ul className="flex flex-wrap gap-2">
        {filterItems(current).map((f) => (
          <li key={f.key}>
            <Link
              href={f.href}
              aria-current={f.current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-[4px] border px-4 text-[15px] font-semibold",
                f.current
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground text-foreground hover:bg-muted"
              )}
            >
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// DESIGN › empty-state: the sentence, and with a filter on, one action back
// to every card.
function EmptyOpenCards({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg bg-muted px-4 py-6 text-center">
      <p className={sectionTitleClass}>{copy.empty}</p>
      {filtered && (
        <Link
          href={filterHref("all")}
          className={buttonClass({
            className:
              "h-12 w-full rounded-[4px] px-6 text-base font-semibold sm:w-auto",
          })}
        >
          {copy.showAll}
        </Link>
      )}
    </div>
  )
}
