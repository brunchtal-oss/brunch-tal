import type { EventKind, EventStatus, SessionRow } from "./session-draft"

// The columns the session screens read (public.events, admin RLS) with the
// concept's name (the title, AD-16).
export const SESSION_COLUMNS =
  "id, kind, description, starts_at, ends_at, capacity_adults, registration_closes_at, registration_close_overridden, status, display_price_agorot, concepts(name)"

// The generated row types its checked text columns as string; the table's
// checks guarantee the narrower values. The concept is never missing
// (concept_id is a required FK).
export function toSessionRow(row: {
  id: string
  kind: string
  description: string | null
  starts_at: string
  ends_at: string
  capacity_adults: number
  registration_closes_at: string
  registration_close_overridden: boolean
  status: string
  display_price_agorot: number | null
  concepts: { name: string } | null
}): SessionRow {
  const { concepts, ...rest } = row
  return {
    ...rest,
    kind: rest.kind as EventKind,
    status: rest.status as EventStatus,
    concept_name: concepts?.name ?? "",
  }
}

// The PostgREST filter of /admin/sessions: every draft, and every published
// session that has not ended by `now` (an ISO instant), so on the morning Tal
// still reaches a running session (manual booking until ends_at, story 3.4).
// Display only (which rows to list), not a business decision (AD-8).
export function sessionsListFilter(now: string): string {
  return `status.eq.draft,and(status.eq.published,ends_at.gt.${now})`
}

// A cancelled or completed session, or one whose end has passed by `now`, is
// shown read-only: no manual booking and no editing (user decision
// 2026-10-05). Display only; admin_book_customer checks the end again.
export function isReadOnlySession(
  row: { status: EventStatus; ends_at: string },
  now: Date
): boolean {
  return (
    row.status === "cancelled" ||
    row.status === "completed" ||
    Date.parse(row.ends_at) <= now.getTime()
  )
}
