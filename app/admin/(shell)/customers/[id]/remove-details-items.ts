import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import { formatSessionDate, formatShortDate } from "@/lib/time"

import { refundHref } from "../../payments/refund-items"

// What the card shows for preview_admin_anonymize_customer and for a removed
// customer (story 4.6; pure: rows in, items out). The blockers and the
// forfeits are decided in SQL (private.plan_admin_anonymize_customer); this
// file only words them and links each one where Tal handles it.

const copy = adminCopy.customers.card.remove

export type RemovalPlan = {
  blockers: {
    bookings: {
      booking_id: string
      event_id: string
      starts_at: string
      concept: string
    }[]
    refund_requests: { id: string; amount_agorot: number }[]
    pending_choices: { credit_id: string }[]
  }
  forfeits: { entries_left: number; active_credits: number }
}

// The tombstone admin_get_customer returns for a removed customer.
export type RemovedProfile = {
  id: string
  anonymized_at: string
  removal_pending: boolean
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function parseRemovalPlan(data: unknown): RemovalPlan {
  const row = (data ?? {}) as Record<string, Record<string, unknown>>
  const blockers = row.blockers ?? {}
  const forfeits = row.forfeits ?? {}
  return {
    blockers: {
      bookings: list(blockers.bookings),
      refund_requests: list(blockers.refund_requests),
      pending_choices: list(blockers.pending_choices),
    },
    forfeits: {
      entries_left: count(forfeits.entries_left),
      active_credits: count(forfeits.active_credits),
    },
  }
}

// A removed profile: admin_get_customer's tombstone (no full_name).
export function removedProfileOf(profile: unknown): RemovedProfile | null {
  const p = profile as Partial<RemovedProfile> | null | undefined
  return p && typeof p.id === "string" && typeof p.anonymized_at === "string"
    ? {
        id: p.id,
        anonymized_at: p.anonymized_at,
        removal_pending: p.removal_pending === true,
      }
    : null
}

export type BlockerLink = { key: string; href: string; text: string }
export type BlockerGroup = { key: string; title: string; items: BlockerLink[] }

// The open matters, grouped, each with its link; only non-empty groups.
export function blockerGroups(
  plan: RemovalPlan,
  customerId: string
): BlockerGroup[] {
  const groups: BlockerGroup[] = [
    {
      key: "bookings",
      title: copy.blockedBookings,
      items: plan.blockers.bookings.map((b) => ({
        key: b.booking_id,
        href: `/admin/sessions/${encodeURIComponent(b.event_id)}`,
        text: `${adminCopy.sessions.sessionTitle(b.concept)} · ${formatSessionDate(b.starts_at)}`,
      })),
    },
    {
      key: "refunds",
      title: copy.blockedRefunds,
      items: plan.blockers.refund_requests.map((r) => ({
        key: r.id,
        href: refundHref(r.id),
        text: copy.refundLine(formatAgorot(r.amount_agorot)),
      })),
    },
    {
      key: "choices",
      title: copy.blockedChoices,
      items: plan.blockers.pending_choices.map((c) => ({
        key: c.credit_id,
        href: `/admin/customers/${encodeURIComponent(customerId)}#credit-${c.credit_id}`,
        text: copy.choiceLine,
      })),
    },
  ]
  return groups.filter((g) => g.items.length > 0)
}

// "3 כניסות וזיכוי פתוח", or null when she loses nothing.
export function forfeitText(plan: RemovalPlan): string | null {
  const parts = [
    plan.forfeits.entries_left > 0
      ? copy.entries(plan.forfeits.entries_left)
      : null,
    plan.forfeits.active_credits > 0
      ? copy.credits(plan.forfeits.active_credits)
      : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return null
  return parts.length === 1 ? parts[0] : copy.joinForfeits(parts[0], parts[1])
}

export function removedOnText(profile: RemovedProfile): string {
  return copy.removedOn(formatShortDate(profile.anonymized_at))
}
