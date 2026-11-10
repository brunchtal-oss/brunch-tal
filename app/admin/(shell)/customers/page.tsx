import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { getSpecialBrunchContent } from "@/lib/content/join-form"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { parseActivity, parseInterests, parseQuery } from "./customer-items"
import { CustomersSwitch } from "./customers-switch"
import { CustomerLiveSearch } from "./customer-live-search"

const copy = adminCopy.customers

export const metadata: Metadata = {
  title: copy.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// /admin/customers (story 4.2, CAP-25; phone check, user decision
// 2026-10-07): a live search, and (story 5.13) three category buttons. No
// list until she types or applies the "סינון" sheet; ?q= brings a search
// back (from a card), ?activity=all|active|inactive a category, and
// ?interest= (story 2.16) narrows it to the special brunches (at least one;
// alone: every customer). The switch to the open cards (story 4.3) is under
// the heading. Rendered inside the admin shell's <Suspense> gate.
export default function CustomersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <CustomersSwitch current="customers" />
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <CustomersContent searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function CustomersContent({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const interests = parseInterests(params)
  const category =
    parseActivity(params) ?? (interests.length > 0 ? "all" : null)
  const specialBrunch = await getSpecialBrunchContent()
  // A new filter (the sheet, or "back") starts a fresh screen: the field
  // cleared and the old answer gone.
  return (
    <CustomerLiveSearch
      key={`${category ?? "none"}:${interests.join(",")}`}
      initialQuery={parseQuery(params)}
      category={category}
      interests={interests}
      specialBrunch={specialBrunch}
    />
  )
}
