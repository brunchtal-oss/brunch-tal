import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"

import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { SessionHeader } from "../session-header"
import { loadWorkSheet } from "./load-work-sheet"
import { WorkSheetView } from "./work-sheet"

const copy = adminCopy.work
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: copy.title,
}

// A session's work sheet (story 4.9, CAP-38): dishes × prep days. Dynamic
// and admin only: no 'use cache', and next.config sends "private, no-store"
// for /admin/:path*. A link back to the details instead of a
// segmented-switch (the design round). Rendered inside the admin shell's
// <Suspense> gate.
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
  const sheet = await loadWorkSheet(id)
  if (!sheet) notFound()

  return (
    <>
      <Link
        href={`/admin/sessions/${id}`}
        className="-mb-4 inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold underline underline-offset-[3px] print:hidden"
      >
        <ChevronRightIcon aria-hidden strokeWidth={1.5} className="size-5" />
        {adminCopy.sessions.toDetails}
      </Link>
      <SessionHeader
        conceptName={sheet.event.conceptName}
        status={sheet.event.status}
        startsAt={sheet.event.startsAt}
        endsAt={sheet.event.endsAt}
      />
      <WorkSheetView sheet={sheet} />
    </>
  )
}
