import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeading } from "@/components/shared/page-heading"
import { SessionCard } from "@/components/shared/session-card"
import { StatusChip } from "@/components/shared/status-chip"
import { buttonVariants } from "@/components/ui/button"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import {
  SESSION_COLUMNS,
  availabilityOf,
  bookedEventIds,
  toCustomerSession,
} from "./load-sessions"
import { SessionSelector } from "./select/session-selector"
import {
  parseSelectionPreview,
  selectableRows,
  showsSelectEntry,
} from "./select/selection"
import { sessionStatus } from "./session-status"

export const metadata: Metadata = {
  title: customerCopy.sessionsTitle,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// The sessions (CAP-13, story 3.2): every published session that has not
// started, by date, as a session-card with its status-chip ("נרשמת" for her
// own confirmed booking, including one placed for her before she joined;
// otherwise the availability label, never a number). Story 3.3: with 2 or
// more available entries, "לבחור כמה תאריכים" opens the selection mode
// (?select=1), where she chooses several dates for one summary and one
// confirm. Rendered inside the layout's <Suspense> customer gate.
export default function MeSessionsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageHeading>
        <Suspense fallback={customerCopy.sessionsTitle}>
          <Heading searchParams={searchParams} />
        </Suspense>
      </PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <SessionsList searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function isSelectMode(searchParams: SearchParams): Promise<boolean> {
  const { select } = await searchParams
  return select === "1"
}

async function Heading({ searchParams }: { searchParams: SearchParams }) {
  return (await isSelectMode(searchParams))
    ? customerCopy.selectTitle
    : customerCopy.sessionsTitle
}

async function SessionsList({ searchParams }: { searchParams: SearchParams }) {
  const select = await isSelectMode(searchParams)
  const supabase = await createClient()
  // Display only (which sessions to list), not a business decision (AD-8).
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("events")
    .select(SESSION_COLUMNS)
    .eq("status", "published")
    .gt("starts_at", now)
    .order("starts_at")
    .order("id")
    .limit(100)
  if (error) throw new Error("sessions list failed")
  const sessions = (
    data as unknown as Parameters<typeof toCustomerSession>[0][]
  ).map(toCustomerSession)

  if (sessions.length === 0) {
    return <p className="text-[17px]">{customerCopy.sessionsEmpty}</p>
  }

  const ids = sessions.map((s) => s.id)

  if (select) {
    const [previewResult, availability] = await Promise.all([
      callRpc(supabase, "preview_book_sessions", { p_items: ids }),
      availabilityOf(supabase, ids),
    ])
    if (!previewResult.ok) throw new Error("selection preview failed")
    const preview = parseSelectionPreview(previewResult.data)
    const rows = selectableRows(sessions, preview, availability)
    return (
      <div className="flex flex-col gap-4">
        <p className="-mt-4 text-[15px] text-muted-foreground">
          {customerCopy.availableEntries(preview.available)}
        </p>
        <SessionSelector sessions={rows} available={preview.available} />
      </div>
    )
  }

  const [booked, availability, entries] = await Promise.all([
    bookedEventIds(supabase, ids),
    availabilityOf(supabase, ids),
    // Only her available entries: no date is checked here.
    callRpc(supabase, "preview_book_sessions", { p_items: [] }),
  ])
  const available = entries.ok
    ? parseSelectionPreview(entries.data).available
    : 0

  return (
    <div className="flex flex-col gap-6">
      {showsSelectEntry(available) && (
        <Link
          href="/me/sessions?select=1"
          className={buttonVariants({
            variant: "outline",
            size: "lg",
            className:
              "h-12 max-w-xs rounded-[4px] border-foreground text-base font-semibold",
          })}
        >
          {customerCopy.selectDates}
        </Link>
      )}
      <ul className="flex flex-col gap-6 pb-8">
        {sessions.map((session) => {
          const status = sessionStatus({
            booked: booked.has(session.id),
            availability: availability.get(session.id),
          })
          return (
            <li key={session.id}>
              <SessionCard
                href={`/me/sessions/${session.id}`}
                conceptName={session.concept_name}
                photo={session.photo}
                startsAt={session.starts_at}
                statusText={status?.text}
                status={
                  status && (
                    <StatusChip tone={status.tone}>{status.text}</StatusChip>
                  )
                }
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
