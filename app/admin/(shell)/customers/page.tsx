import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { parseActivity, parseQuery } from "./customer-items"
import { CustomersSwitch } from "./customers-switch"
import { CustomerLiveSearch } from "./customer-live-search"

const copy = adminCopy.customers

export const metadata: Metadata = {
  title: copy.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// /admin/customers (story 4.2, CAP-25; phone check, user decision
// 2026-10-07): a live search, and (story 5.13) three category buttons. No
// list until she types or taps a button; ?q= brings a search back (from a
// card), ?activity=all|active|inactive a category. The switch to the open
// cards (story 4.3) is under the heading. Rendered inside the admin shell's
// <Suspense> gate.
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
  const category = parseActivity(params)
  // A new category (a button, or "back") starts a fresh screen: the field
  // cleared and the old answer gone.
  return (
    <CustomerLiveSearch
      key={category ?? "none"}
      initialQuery={parseQuery(params)}
      category={category}
    />
  )
}
