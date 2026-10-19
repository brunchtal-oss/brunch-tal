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
import { formatDayMonth } from "@/lib/time"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import {
  SESSION_COLUMNS,
  availabilityOf,
  toCustomerSession,
} from "../load-sessions"
import { sessionStatus } from "../session-status"
import { BookingPanel } from "./booking-panel"
import {
  companionNoteBooking,
  coupleSessionBookings,
} from "./companion-booking"
import { CompanionNote } from "./companion-note"
import { MovedNotice } from "./moved-notice"
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
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <SessionContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

async function SessionContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  // Story 3.10: arriving here after moving her booking to this session.
  const { moved } = await searchParams
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

  // Story 5.21 (fix 7): on a couple session her bookings are read with the
  // rest (the companion note); a regular session makes no call.
  const [previewResult, availability, contactHref, coupleBookings] =
    await Promise.all([
      callRpc(supabase, "preview_book_session", { p_event_id: id }),
      availabilityOf(supabase, [id]),
      getWhatsappHref(),
      coupleSessionBookings(supabase, session.kind),
    ])
  const preview: BookingPreview = previewResult.ok
    ? parsePreview(previewResult.data)
    : { kind: "blocked", code: previewResult.code }
  // The closed notice names the booking's own cancel window
  // (policy_snapshot; RLS: her own booking): past the boundary, or when a
  // move is refused at it (story 3.10).
  const bookingId = preview.kind === "booked" ? preview.bookingId : null
  const cancelWindowHours = bookingId
    ? await cancelWindowOf(supabase, bookingId)
    : null
  // The companion note of her couple booking here (no preview change).
  const coupleBooking = companionNoteBooking(coupleBookings, bookingId)
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
        <MovedNotice
          arrived={moved === "1" && preview.kind === "booked"}
          message={customerCopy.move.done(formatDayMonth(session.starts_at))}
        />
        <BookingPanel
          eventId={session.id}
          title={customerCopy.sessionTitle(session.concept_name)}
          startsAt={session.starts_at}
          preview={preview}
          cancelWindowHours={cancelWindowHours}
          contactHref={contactHref}
        />
        {coupleBooking && (
          <div className="mt-6">
            <CompanionNote
              bookingId={coupleBooking.bookingId}
              guestDetails={coupleBooking.guestDetails}
              editable={coupleBooking.guestDetailsEditable}
              contactHref={contactHref}
            />
          </div>
        )}
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
