import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { loadEventDetails } from "../load-details"
import { loadWorkSheet } from "./load-work-sheet"
import { WorkSheetHead } from "./work-head"
import { WorkSheetView } from "./work-sheet"
import { tableAttendees } from "./work-sheet-data"

const copy = adminCopy.work
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: copy.title,
}

// A session's work sheet (stories 4.9, 4.10; CAP-38): dishes × prep days,
// the registrants with their photo consent, diet, and the shopping list,
// read in parallel (admin_get_work_sheet, admin_get_event_details). Dynamic
// and admin only: no 'use cache', and next.config sends "private, no-store"
// for /admin/:path*. Its own head (WorkSheetHead: the link back to the
// details, "בראנץ׳ {קונספט}", date and time) instead of a segmented-switch
// (the design round). Rendered inside the admin shell's <Suspense> gate.
export default function WorkSheetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <WorkSheetContent params={params} />
    </Suspense>
  )
}

async function WorkSheetContent({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const [sheet, details] = await Promise.all([
    loadWorkSheet(id),
    loadEventDetails(id),
  ])
  if (!sheet || !details) notFound()

  return (
    <>
      <WorkSheetHead
        eventId={id}
        conceptName={sheet.event.conceptName}
        startsAt={sheet.event.startsAt}
        endsAt={sheet.event.endsAt}
      />
      <WorkSheetView
        sheet={sheet}
        attendees={tableAttendees(details.attendees)}
      />
    </>
  )
}
