import type { TaskRowProps } from "@/components/admin/task-row"
import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import {
  formatDayMonth,
  formatLocalDate,
  formatMonthYear,
  formatSessionDate,
} from "@/lib/time"

import { customerHref } from "./customers/customer-items"
import { sessionTitle } from "./sessions/session-draft"

// What /admin shows for the rows of admin_get_attention_items and
// admin_get_home (pure: rows in, items out). Every state, date boundary and
// sum is decided in SQL; this file only maps a kind to its title, detail,
// status-chip and destination, and formats.

const copy = adminCopy.home

export type AttentionKind = keyof typeof copy.items

export type AttentionRow = {
  kind: AttentionKind
  id: string
  customer_label: string | null
  since: string
  payment_id?: string
  conflict_reason?: string | null
  product_name?: string | null
  amount_agorot?: number
  paid_on?: string
  event_id?: string
  concept_name?: string
  starts_at?: string
  // push_failed: failed jobs of the last 7 days.
  count?: number
  // refund_requested (story 3.7): the customer's card.
  customer_id?: string | null
}

export type AttentionItem = TaskRowProps & { key: string }

export type UpcomingSessionRow = {
  event_id: string
  concept_name: string
  kind: string
  starts_at: string
  ends_at: string
  occupied: number
  capacity: number
}

export type ExpiringCardRow = {
  entitlement_id: string
  // The card's customer (story 4.2); null while the purchase is not bound.
  customer_id: string | null
  customer_label: string | null
  product_name: string | null
  available: number
  expires_on: string
  days_left: number
}

export type HomeTotals = {
  period_start: string
  period_end: string
  approved_count: number
  approved_agorot: number
  // Story 3.7: refunds completed in the month (3.9 completes them).
  refunded_count: number
  refunded_agorot: number
  net_agorot: number
}

// An open refund request (story 3.7).
export type OpenRefundRow = {
  refund_request_id: string
  customer_id: string | null
  customer_label: string | null
  amount_agorot: number
  requested_at: string
  event_id: string
  concept_name: string
  starts_at: string
}

export type HomeData = {
  upcoming_sessions: UpcomingSessionRow[]
  expiring_cards: ExpiringCardRow[]
  totals: HomeTotals
  open_refunds: OpenRefundRow[]
}

type Reason = keyof typeof copy.items.link_conflict.reasons

function nameOf(label: string | null | undefined): string {
  const trimmed = label?.trim() ?? ""
  return trimmed === "" ? copy.newCustomer : trimmed
}

// An unknown reason reads as a bind conflict (as on /join and the links
// screen).
function reasonOf(row: AttentionRow): Reason {
  return Object.hasOwn(
    copy.items.link_conflict.reasons,
    row.conflict_reason ?? ""
  )
    ? (row.conflict_reason as Reason)
    : "bind_conflict"
}

function sessionHref(row: AttentionRow): string {
  return row.event_id ? `/admin/sessions/${row.event_id}` : "/admin/sessions"
}

// The links screen filtered to one purchase (story 4.1, after the phone
// check): only that payment's links.
export function linksHref(paymentId: string | undefined): string {
  return paymentId
    ? `/admin/links?payment=${encodeURIComponent(paymentId)}`
    : "/admin/links"
}

function dayOf(value: string | undefined): string {
  return value ? formatDayMonth(value) : ""
}

export function toAttentionItem(row: AttentionRow): AttentionItem {
  const name = nameOf(row.customer_label)
  const base = {
    key: `${row.kind}:${row.id}`,
    meta: copy.since(formatDayMonth(row.since)),
    metaAt: formatLocalDate(row.since),
  }
  switch (row.kind) {
    case "link_conflict": {
      const c = copy.items.link_conflict
      const reason = c.reasons[reasonOf(row)]
      return {
        ...base,
        href: linksHref(row.payment_id),
        title: reason.title(name),
        detail: reason.detail,
        chip: { tone: "error", label: c.chip },
      }
    }
    case "link_stuck": {
      const c = copy.items.link_stuck
      return {
        ...base,
        href: linksHref(row.payment_id),
        title: c.title(name),
        detail: c.detail,
        chip: { tone: "warning", label: c.chip },
      }
    }
    case "purchase_without_link": {
      const c = copy.items.purchase_without_link
      return {
        ...base,
        // The item's id is the payment.
        href: linksHref(row.payment_id ?? row.id),
        title: c.title(name),
        detail: c.detail,
        chip: { tone: "expired", label: c.chip },
      }
    }
    case "paid_without_place": {
      const c = copy.items.paid_without_place
      return {
        ...base,
        href: sessionHref(row),
        title: c.title(name),
        detail: c.detail(row.concept_name ?? "", dayOf(row.starts_at)),
        chip: { tone: "warning", label: c.chip },
      }
    }
    case "pinned_seat_held": {
      const c = copy.items.pinned_seat_held
      return {
        ...base,
        href: sessionHref(row),
        title: c.title(name),
        detail: c.detail(row.concept_name ?? "", dayOf(row.starts_at)),
        chip: { tone: "warning", label: c.chip },
      }
    }
    case "media_stuck": {
      const c = copy.items.media_stuck
      return {
        ...base,
        href: "/admin/content",
        title: c.title(),
        detail: c.detail,
        chip: { tone: "warning", label: c.chip },
      }
    }
    case "accessibility_unpublished": {
      const c = copy.items.accessibility_unpublished
      return {
        ...base,
        href: "/admin/content/accessibility",
        title: c.title(),
        detail: c.detail,
        chip: { tone: "warning", label: c.chip },
      }
    }
    case "refund_requested": {
      const c = copy.items.refund_requested
      return {
        ...base,
        href: row.customer_id
          ? customerHref(row.customer_id)
          : sessionHref(row),
        title: c.title(
          name,
          formatAgorot(row.amount_agorot ?? 0),
          row.concept_name ?? "",
          dayOf(row.starts_at)
        ),
      }
    }
    case "push_failed": {
      const c = copy.items.push_failed
      return {
        ...base,
        href: "/admin/notifications",
        title: c.title(row.count ?? 1),
        detail: c.detail,
        chip: { tone: "warning", label: c.chip },
      }
    }
  }
}

// A kind this version does not know yet (a later story added it to the
// RPC before this screen) is skipped rather than shown wrong.
export function toAttentionItems(rows: AttentionRow[]): AttentionItem[] {
  return rows
    .filter((row) => Object.hasOwn(copy.items, row.kind))
    .map(toAttentionItem)
}

// The home shows the newest items only (the RPC orders them); the rest are
// on /admin/attention.
export const HOME_ATTENTION_LIMIT = 3

// One session-tile of the home (design round, user decision 2026-10-07):
// the title, the weekday and date (never the time, 2026-10-08), the places
// "{occupied}/{capacity}" from the server, and how full it is for the
// decorative occupancy bar (0-100).
export type SessionTileItem = {
  id: string
  href: string
  title: string
  day: string
  dayAt: string
  places: string
  fillPercent: number
}

export function toSessionTile(row: UpcomingSessionRow): SessionTileItem {
  const fill =
    row.capacity > 0
      ? Math.round((Math.min(row.occupied, row.capacity) / row.capacity) * 100)
      : 0
  return {
    id: row.event_id,
    href: `/admin/sessions/${row.event_id}`,
    title: sessionTitle(row.concept_name),
    day: formatSessionDate(row.starts_at),
    dayAt: formatLocalDate(row.starts_at),
    places: `${row.occupied}/${row.capacity}`,
    fillPercent: Math.max(0, fill),
  }
}

export type ExpiringCardItem = {
  key: string
  title: string
  // The customer's card (story 4.2); null for a purchase not bound yet.
  href: string | null
  entries: string
  until: string
}

export function toExpiringCard(row: ExpiringCardRow): ExpiringCardItem {
  return {
    key: row.entitlement_id,
    title: nameOf(row.customer_label),
    href: row.customer_id ? customerHref(row.customer_id) : null,
    entries: copy.expiringEntries(row.available),
    until: copy.expiringUntil(formatDayMonth(row.expires_on)),
  }
}

export type TotalsView = {
  period: string
  periodStart: string
  net: string
  approvedLabel: string
  approved: string
  refundedLabel: string
  refunded: string
}

export function totalsView(totals: HomeTotals): TotalsView {
  return {
    period: copy.totalsPeriod(formatMonthYear(totals.period_start)),
    periodStart: totals.period_start,
    net: formatAgorot(totals.net_agorot),
    approvedLabel: copy.totalsApproved(totals.approved_count),
    approved: formatAgorot(totals.approved_agorot),
    refundedLabel: copy.totalsRefunded(totals.refunded_count ?? 0),
    refunded: formatAgorot(totals.refunded_agorot ?? 0),
  }
}

export type OpenRefundItem = {
  key: string
  // The customer's card; null while the purchase is not bound.
  href: string | null
  text: string
}

export function toOpenRefund(row: OpenRefundRow): OpenRefundItem {
  return {
    key: row.refund_request_id,
    href: row.customer_id ? customerHref(row.customer_id) : null,
    text: copy.openRefundRow(
      nameOf(row.customer_label),
      formatAgorot(row.amount_agorot),
      row.concept_name,
      formatDayMonth(row.starts_at)
    ),
  }
}
