import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ConceptHeader } from "@/components/shared/concept-header"
import { ResultNoticeHost } from "@/components/shared/result-notice"
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
// concept-header (the concept name is the h1), the status-chip, the display
// price when Tal set one, the description (the session's, else the
// concept's), then the action (BookingPanel: the booking sheet, her booking,
// or the reason she cannot book). No "with the babies" line (user's decision
// 2026-10-05, as on the public session page). Every value comes from the server
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
  const session = toCustomerSession(
    data as unknown as Parameters<typeof toCustomerSession>[0]
  )

  const [previewResult, availability, contactHref] = await Promise.all([
    callRpc(supabase, "preview_book_session", { p_event_id: id }),
    availabilityOf(supabase, [id]),
    getWhatsappHref(),
  ])
  const preview: BookingPreview = previewResult.ok
    ? parsePreview(previewResult.data)
    : { kind: "blocked", code: previewResult.code }
  // Past the self-cancel boundary the notice names the booking's own
  // cancel window (policy_snapshot; RLS: her own booking).
  const cancelWindowHours =
    preview.kind === "booked" && preview.bookingId && !preview.canSelfCancel
      ? await cancelWindowOf(supabase, preview.bookingId)
      : null
  const status = sessionStatus({
    booked: preview.kind === "booked",
    availability: availability.get(id),
  })

  return (
    <>
      <ConceptHeader
        conceptName={session.concept_name}
        photo={session.photo}
        startsAt={session.starts_at}
      >
        {status && <StatusChip tone={status.tone}>{status.text}</StatusChip>}
      </ConceptHeader>
      {session.display_price_agorot !== null && (
        <p className="text-base">
          <bdi>{formatAgorot(session.display_price_agorot)}</bdi>
        </p>
      )}
      {session.description && (
        <p className="text-[17px] leading-relaxed text-pretty whitespace-pre-line">
          {session.description}
        </p>
      )}
      <ResultNoticeHost className="pb-8">
        <BookingPanel
          eventId={session.id}
          title={customerCopy.sessionTitle(session.concept_name)}
          startsAt={session.starts_at}
          preview={preview}
          cancelWindowHours={cancelWindowHours}
          contactHref={contactHref}
        />
      </ResultNoticeHost>
    </>
  )
}

async function cancelWindowOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bookingId: string
): Promise<number | null> {
  const { data } = await supabase
    .from("bookings")
    .select("policy_snapshot")
    .eq("id", bookingId)
    .maybeSingle()
  const snapshot = data?.policy_snapshot
  const hours =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>).cancel_window_hours
      : undefined
  return typeof hours === "number" && Number.isInteger(hours) && hours > 0
    ? hours
    : null
}
