import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { parseQuery } from "./customer-items"
import { CustomerLiveSearch } from "./customer-live-search"

const copy = adminCopy.customers

export const metadata: Metadata = {
  title: copy.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// /admin/customers (story 4.2, CAP-25; phone check, user decision
// 2026-10-07): a live search and nothing else. No list until she types;
// ?q= brings a search back (from a card). Rendered inside the admin shell's
// <Suspense> gate.
export default function CustomersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
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
  const query = parseQuery(await searchParams)
  return <CustomerLiveSearch initialQuery={query} />
}
