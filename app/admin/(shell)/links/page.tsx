import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { toLinkItem, type LinkRow } from "./link-items"
import { LinksList } from "./links-list"

export const metadata: Metadata = {
  title: adminCopy.links.title,
}

// Rendered inside the admin shell's <Suspense> gate.
export default function LinksPage() {
  return (
    <>
      <PageHeading>{adminCopy.links.title}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <LinksContent />
      </Suspense>
    </>
  )
}

async function LinksContent() {
  const result = await callRpc(await createClient(), "admin_list_links")
  if (!result.ok) throw new Error("admin_list_links failed")
  const rows = result.data as unknown as LinkRow[]

  // One idempotency key per action and page load (AD-5); a successful
  // action refreshes the page, which hands new keys.
  const items = rows.map((row) => ({
    ...toLinkItem(row),
    revokeKey: randomUUID(),
    replaceKey: randomUUID(),
  }))

  return <LinksList items={items} />
}
