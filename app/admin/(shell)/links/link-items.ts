import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import { formatDayMonth, formatTime, formatWeekday } from "@/lib/time"

// What /admin/links shows for each row of admin_list_links (pure: rows in,
// items out). Status and detail come from private.join_link_status in SQL;
// nothing about the link's state is decided here.

const copy = adminCopy.links

export type LinkStatus = "pending" | "consumed" | "expired" | "revoked"
type Reason = keyof typeof copy.reasons

export type LinkRow = {
  token_id: string
  payment_id: string
  status: LinkStatus
  detail: "awaiting_login" | "stuck" | "conflict" | null
  detail_name: string | null
  conflict_reason: string | null
  product_name: string | null
  // The payment's payer label (a new customer, story 2.5), or null.
  payer_label?: string | null
  amount_agorot: number
  paid_on: string
  created_at: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  customer_name: string | null
  can_revoke: boolean
  can_replace: boolean
}

export type LinkItem = {
  tokenId: string
  paymentId: string
  title: string
  purchase: string
  status: LinkStatus
  statusLabel: string
  // The instant of the time line, for <time dateTime>.
  timeAt: string
  timeLine: string
  // A stuck or stopped link needs Tal's attention (warning).
  detail: { text: string; attention: boolean } | null
  canRevoke: boolean
  canReplace: boolean
}

function detailOf(row: LinkRow): LinkItem["detail"] {
  if (row.status !== "pending") return null
  if (row.detail === "awaiting_login" && row.detail_name) {
    return {
      text: copy.detail.awaitingLogin(row.detail_name),
      attention: false,
    }
  }
  if (row.detail === "stuck")
    return { text: copy.detail.stuck, attention: true }
  if (row.detail === "conflict") {
    // An unknown reason reads as a bind conflict (as on /join).
    const reason: Reason = Object.hasOwn(
      copy.reasons,
      row.conflict_reason ?? ""
    )
      ? (row.conflict_reason as Reason)
      : "bind_conflict"
    return { text: copy.detail.conflict(copy.reasons[reason]), attention: true }
  }
  return null
}

function timeOf(row: LinkRow): { at: string; line: string } {
  switch (row.status) {
    case "consumed": {
      const at = row.consumed_at ?? row.expires_at
      return { at, line: copy.consumedOn(formatDayMonth(at)) }
    }
    case "revoked": {
      const at = row.revoked_at ?? row.expires_at
      return { at, line: copy.revokedOn(formatDayMonth(at)) }
    }
    case "expired":
      return {
        at: row.expires_at,
        line: copy.expiredOn(formatDayMonth(row.expires_at)),
      }
    default:
      return {
        at: row.expires_at,
        line: copy.validUntil(
          formatWeekday(row.expires_at),
          formatDayMonth(row.expires_at),
          formatTime(row.expires_at)
        ),
      }
  }
}

export function toLinkItem(row: LinkRow): LinkItem {
  const time = timeOf(row)
  return {
    tokenId: row.token_id,
    paymentId: row.payment_id,
    title:
      row.status === "consumed"
        ? (row.customer_name ?? "")
        : row.payer_label
          ? copy.rowTitleNamed(row.payer_label, copy.rowTitle[row.status])
          : copy.rowTitle[row.status],
    purchase: copy.purchase(
      row.product_name ?? "",
      formatAgorot(row.amount_agorot),
      formatDayMonth(row.paid_on)
    ),
    status: row.status,
    statusLabel: copy.status[row.status],
    timeAt: time.at,
    timeLine: time.line,
    detail: detailOf(row),
    canRevoke: row.can_revoke,
    canReplace: row.can_replace,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// /admin/links?payment=<id> (story 4.1): a "לטיפול" item opens only the
// links of its purchase. An invalid id, or a payment with no links, shows
// the full list (filtered: false).
export function filterByPayment(
  rows: LinkRow[],
  payment: string | string[] | undefined
): { rows: LinkRow[]; filtered: boolean } {
  const id = typeof payment === "string" ? payment : undefined
  if (!id || !UUID.test(id)) return { rows, filtered: false }
  const own = rows.filter(
    (row) => row.payment_id.toLowerCase() === id.toLowerCase()
  )
  return own.length > 0
    ? { rows: own, filtered: true }
    : { rows, filtered: false }
}
