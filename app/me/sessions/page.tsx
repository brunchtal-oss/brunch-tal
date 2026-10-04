import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { SessionCard } from "@/components/shared/session-card"
import { StatusChip } from "@/components/shared/status-chip"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import {
  SESSION_COLUMNS,
  availabilityOf,
  bookedEventIds,
  toCustomerSession,
} from "./load-sessions"
import { sessionStatus } from "./session-status"

export const metadata: Metadata = {
  title: customerCopy.sessionsTitle,
}

// The sessions (CAP-13, story 3.2): every published session that has not
// started, by date, as a session-card with its status-chip ("נרשמת" for her
// own confirmed booking, including one placed for her before she joined;
// otherwise the availability label, never a number). Rendered inside the
// layout's <Suspense> customer gate.
export default function MeSessionsPage() {
  return (
    <>
      <PageHeading>{customerCopy.sessionsTitle}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <SessionsList />
      </Suspense>
    </>
  )
}

async function SessionsList() {
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
  const sessions = data.map(toCustomerSession)

  if (sessions.length === 0) {
    return <p className="text-[17px]">{customerCopy.sessionsEmpty}</p>
  }

  const ids = sessions.map((s) => s.id)
  const [booked, availability] = await Promise.all([
    bookedEventIds(supabase, ids),
    availabilityOf(supabase, ids),
  ])

  return (
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
  )
}
