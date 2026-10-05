import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ConceptHeader } from "@/components/shared/concept-header"
import { StatusChip } from "@/components/shared/status-chip"
import { getWhatsappHref } from "@/lib/content/business-details"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { formatAgorot } from "@/lib/money"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import {
  SESSION_COLUMNS,
  availabilityOf,
  toCustomerSession,
} from "../load-sessions"
import { sessionStatus } from "../session-status"
import { BookingPanel } from "./booking-panel"
import { parsePreview, type BookingPreview } from "./booking-preview"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: customerCopy.sessionsTitle,
}

// One session for the signed-in customer (CAP-13, story 3.2): the
// concept-header (the concept name is the h1), the status-chip, the
// description (the session's, else its concept's; in place of "with the
// babies", user decision 2026-10-05), the display price when Tal set one,
// then the action (BookingPanel: the booking sheet, her booking, or the
// reason she cannot book). Every value comes from the server
// (preview_book_session, get_event_availability). Rendered inside the
// layout's <Suspense> customer gate.
export default function MeSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <SessionContent params={params} />
    </Suspense>
  )
}

async function SessionContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const supabase = await createClient()
  // RLS: a draft is never returned to a customer.
  const { data, error } = await supabase
    .from("events")
    .select(SESSION_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("session read failed")
  if (!data) notFound()
  const session = toCustomerSession(data)

  const [previewResult, availability, contactHref] = await Promise.all([
    callRpc(supabase, "preview_book_session", { p_event_id: id }),
    availabilityOf(supabase, [id]),
    getWhatsappHref(),
  ])
  const preview: BookingPreview = previewResult.ok
    ? parsePreview(previewResult.data)
    : { kind: "blocked", code: previewResult.code }
  const status = sessionStatus({
    booked: preview.kind === "booked",
    availability: availability.get(id),
  })

  return (
    <>
      <ConceptHeader
        conceptName={session.concept_name}
        startsAt={session.starts_at}
      >
        {status && <StatusChip tone={status.tone}>{status.text}</StatusChip>}
      </ConceptHeader>
      <div className="flex flex-col gap-1 text-base">
        {session.description && (
          <p className="text-[17px] leading-relaxed whitespace-pre-line">
            {session.description}
          </p>
        )}
        {session.display_price_agorot !== null && (
          <p>
            <bdi>{formatAgorot(session.display_price_agorot)}</bdi>
          </p>
        )}
      </div>
      <BookingPanel
        eventId={session.id}
        title={customerCopy.sessionTitle(session.concept_name)}
        startsAt={session.starts_at}
        preview={preview}
        contactHref={contactHref}
      />
    </>
  )
}
