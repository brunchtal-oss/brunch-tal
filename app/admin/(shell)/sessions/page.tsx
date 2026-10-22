import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { PageHeading } from "@/components/shared/page-heading"
import { buttonClass } from "@/components/shared/button-class"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import {
  SESSIONS_LIST_COLUMNS,
  sessionsListFilter,
  toSessionRow,
} from "./load-session"
import { occupancyById } from "./session-draft"
import { SessionsList } from "./sessions-list"

const copy = adminCopy.sessions

export const metadata: Metadata = {
  title: copy.title,
}

// The sessions (CAP-12): every draft and every published session that has
// not ended yet, by date, each with its status-chip and its occupancy
// (2026-10-10). Rendered inside the admin shell's <Suspense> gate.
// ?deleted=1: a session was just deleted (story 3.17).
export default function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string | string[] }>
}) {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <Suspense fallback={null}>
        <DeletedNotice searchParams={searchParams} />
      </Suspense>
      {/* button-primary at inline-start, 12px above the first session; the
          content starts at inline-start, a 16px plus 8px before the text
          (user decision 2026-10-08). */}
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/sessions/new"
          className={buttonClass({
            size: "lg",
            className:
              "h-12 items-center justify-start gap-2 self-start rounded-lg px-4 text-base font-semibold",
          })}
        >
          <PlusIcon aria-hidden strokeWidth={1.5} className="size-4" />
          {copy.addBrunch}
        </Link>
        <Suspense
          fallback={
            <p className="text-muted-foreground">{shellCopy.loading}</p>
          }
        >
          <SessionsContent />
        </Suspense>
      </div>
    </>
  )
}

async function DeletedNotice({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string | string[] }>
}) {
  const { deleted } = await searchParams
  if (deleted !== "1") return null
  return <InlineNotice tone="success">{copy.deleteEvent.done}</InlineNotice>
}

async function SessionsContent() {
  const supabase = await createClient()
  // Display only (which rows to list), not a business decision (AD-8).
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("events")
    .select(SESSIONS_LIST_COLUMNS)
    .or(sessionsListFilter(now))
    .order("starts_at")
    .order("id")
  if (error) throw new Error("sessions list failed")
  const rows = data.map((row) => toSessionRow(row, row.capacity_adults))
  // The places taken, only from private.occupied_places (AD-6), in one call
  // for the listed ids; none listed, no call.
  let occupied: Record<string, number> = {}
  if (rows.length > 0) {
    const result = await callRpc(supabase, "admin_list_session_occupancy", {
      p_event_ids: rows.map((row) => row.id),
    })
    if (!result.ok) throw new Error("sessions occupancy failed")
    occupied = occupancyById(result.data)
  }
  return <SessionsList rows={rows} occupied={occupied} />
}
