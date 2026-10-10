import { Suspense } from "react"
import type { Metadata } from "next"

import { InlineNotice } from "@/components/shared/inline-notice"
import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"
import { localToday } from "@/lib/time"

import { loadAuditAction } from "./actions"
import {
  auditHref,
  auditKeys,
  dateErrorOf,
  parseAuditParams,
  toSessionOptions,
} from "./audit-data"
import { AuditFilterPanel } from "./audit-filters"
import { AuditList, EmptyAudit } from "./audit-list"

const copy = adminCopy.audit

export const metadata: Metadata = {
  title: copy.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// /admin/audit (story 4.5, CAP-26, Flow 9), from "עוד": the audit log, read
// only. Filters in the URL; the first page is read here, "טעינת עוד" in
// the list. Every row comes from admin_list_audit (admin only, names
// derived now, no raw before/after); the sessions and the chosen customer's
// name are read with the admin's RLS. Rendered inside the admin shell's
// <Suspense> gate; no cache.
export default function AuditPage({
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
        <AuditContent searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function AuditContent({ searchParams }: { searchParams: SearchParams }) {
  // The request's params first: "today" is read at request time.
  const params = await searchParams
  const today = localToday()
  const filters = parseAuditParams(params, today)
  const href = auditHref(filters, today)
  const supabase = await createClient()

  const [eventsRead, customerRead, page] = await Promise.all([
    supabase
      .from("events")
      .select("id, starts_at, concepts(name)")
      .order("starts_at", { ascending: false })
      .order("id", { ascending: false }),
    filters.customerId
      ? supabase
          .from("profiles")
          .select("full_name, anonymized_at")
          .eq("id", filters.customerId)
          .maybeSingle()
      : Promise.resolve(null),
    loadAuditAction(filters, null),
  ])
  if (eventsRead.error) throw new Error("audit sessions read failed")
  if (customerRead?.error) throw new Error("audit customer read failed")
  const customer = customerRead?.data ?? null
  const customerName =
    customer && !customer.anonymized_at ? customer.full_name : null

  const dateError = dateErrorOf(page)

  return (
    <div className="flex flex-col gap-6">
      <AuditFilterPanel
        href={href}
        filters={filters}
        today={today}
        sessions={toSessionOptions(eventsRead.data)}
        customerName={customerName}
        dateError={dateError}
      />
      {!page.ok && !dateError && (
        <InlineNotice tone="error">{errorMessage(page.code)}</InlineNotice>
      )}
      {page.ok && page.data.items.length === 0 && <EmptyAudit />}
      {page.ok && page.data.items.length > 0 && (
        <AuditList
          key={auditKeys(href).list}
          filters={filters}
          initial={page.data}
        />
      )}
    </div>
  )
}
