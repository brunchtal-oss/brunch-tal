import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"

import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { AttendeeList } from "../attendee-list"
import { loadEventDetails } from "../load-details"
import { SessionHeader } from "../session-header"

const copy = adminCopy.sessions
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: copy.title,
}

// The session-morning view (story 3.4, EXPERIENCE flow 5): the summary-card
// and the attendee rows only, from the same call as the details. Online
// only: no 'use cache' and nothing kept in the browser; next.config sends
// "private, no-store" for /admin/:path*. Rendered inside the admin shell's
// <Suspense> gate.
export default function SessionMorningPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <SessionMorningContent params={params} />
    </Suspense>
  )
}

async function SessionMorningContent({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const details = await loadEventDetails(id)
  if (!details) notFound()

  return (
    <>
      <Link
        href={`/admin/sessions/${id}`}
        className="-mb-4 inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold underline underline-offset-[3px]"
      >
        <ChevronRightIcon aria-hidden strokeWidth={1.5} className="size-5" />
        {copy.toDetails}
      </Link>
      <SessionHeader
        conceptName={details.conceptName}
        status={details.status}
        startsAt={details.startsAt}
        endsAt={details.endsAt}
      />
      <AttendeeList details={details} />
    </>
  )
}
