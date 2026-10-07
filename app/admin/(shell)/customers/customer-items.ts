import { adminCopy } from "@/lib/copy/admin"
import { formatLocalPhone } from "@/lib/phone"
import { formatShortDate } from "@/lib/time"

// What /admin/customers shows (pure: the URL's q in, rows in, items out).
// Who matches, the last activity and the order are decided in SQL
// (admin_list_customers). The search is live (phone check, user decision
// 2026-10-07): nothing until she types 2 characters; q stays in the URL.

const copy = adminCopy.customers

// The search field's limit (admin_list_customers refuses more).
export const QUERY_MAX = 100

// admin_list_customers returns at most this many rows (then has_more).
export const LIST_LIMIT = 200

export type CustomerListRow = {
  id: string
  full_name: string
  phone_e164: string | null
  activated: boolean
  last_activity_on: string | null
}

export type CustomerList = { customers: CustomerListRow[]; has_more: boolean }

export type CustomerItem = {
  key: string
  href: string
  name: string
  phone: string | null
  activity: string
  activityOn: string | null
  notActivated: boolean
}

type SearchParams = Record<string, string | string[] | undefined>

// The query kept in the URL (?q=), cut to the field's limit.
export function parseQuery(params: SearchParams): string {
  const value = params.q
  const q = (Array.isArray(value) ? value[0] : value) ?? ""
  return q.slice(0, QUERY_MAX)
}

// The list's address for a query (router.replace while she types).
export function listHref(query: string): string {
  return query.trim() === ""
    ? "/admin/customers"
    : `/admin/customers?q=${encodeURIComponent(query)}`
}

// The card of a customer (also linked from the home and the payments).
export function customerHref(id: string): string {
  return `/admin/customers/${encodeURIComponent(id)}`
}

export function toCustomerItem(row: CustomerListRow): CustomerItem {
  return {
    key: row.id,
    href: customerHref(row.id),
    name: row.full_name,
    phone: row.phone_e164 ? formatLocalPhone(row.phone_e164) : null,
    activity: row.last_activity_on
      ? copy.lastActivity(formatShortDate(row.last_activity_on))
      : copy.noActivity,
    activityOn: row.last_activity_on,
    notActivated: !row.activated,
  }
}
