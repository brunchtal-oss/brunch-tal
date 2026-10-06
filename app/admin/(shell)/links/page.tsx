import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { filterByPayment, toLinkItem, type LinkRow } from "./link-items"
import { LinksList } from "./links-list"

export const metadata: Metadata = {
  title: adminCopy.links.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// Rendered inside the admin shell's <Suspense> gate. ?payment=<id> (from
// "לטיפול", story 4.1) shows only that purchase's links.
export default function LinksPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageHeading>{adminCopy.links.title}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <LinksContent searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function LinksContent({ searchParams }: { searchParams: SearchParams }) {
  const { payment } = await searchParams
  const result = await callRpc(await createClient(), "admin_list_links")
  if (!result.ok) throw new Error("admin_list_links failed")
  const { rows, filtered } = filterByPayment(
    result.data as unknown as LinkRow[],
    payment
  )

  // One idempotency key per action and page load (AD-5); a successful
  // action refreshes the page, which hands new keys.
  const items = rows.map((row) => ({
    ...toLinkItem(row),
    revokeKey: randomUUID(),
    replaceKey: randomUUID(),
  }))

  return (
    <>
      {filtered && (
        <Link
          href="/admin/links"
          className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-4"
        >
          {adminCopy.links.allLinks}
        </Link>
      )}
      <LinksList items={items} />
    </>
  )
}
