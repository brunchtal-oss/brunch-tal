import { nonEmptyText } from "@/lib/form-values"

// get_my_waitlist's jsonb as "ההרשמות שלי" shows it (story 5.6): her
// active entries in published, still open sessions, by start. A malformed
// row is skipped.
export type MyWaitlistEntry = {
  eventId: string
  startsAt: string
  conceptName: string
}

export function parseMyWaitlist(data: unknown): MyWaitlistEntry[] {
  if (!Array.isArray(data)) return []
  const entries: MyWaitlistEntry[] = []
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    const eventId = nonEmptyText(row.event_id)
    const startsAt = nonEmptyText(row.starts_at)
    const conceptName = nonEmptyText(row.concept_name)
    if (!eventId || !startsAt || !conceptName) continue
    entries.push({ eventId, startsAt, conceptName })
  }
  return entries
}
