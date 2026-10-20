import { shownCount, type ShownList } from "@/lib/admin/customer-export"
import { adminCopy } from "@/lib/copy/admin"
import { formatLocalPhone } from "@/lib/phone"
import { formatShortDate } from "@/lib/time"

// What /admin/customers shows (pure: the URL's q and activity in, rows in,
// items out). Who matches, who is inactive, the last activity and the order
// are decided in SQL (admin_list_customers). The search is live (phone
// check, user decision 2026-10-07): nothing until she types 2 characters,
// and then it searches every customer. Story 5.13 (user decision 2026-10-20):
// three category buttons each list a whole category; an inactive customer is
// never hidden, only marked.

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
  inactive: boolean
}

export type CustomerList = {
  customers: CustomerListRow[]
  has_more: boolean
}

// A category (story 5.13, CAP-28), in the buttons' reading order; "all" =
// active and inactive. Who is inactive is decided in SQL
// (private.customer_activity).
export type CustomerActivity = "all" | "active" | "inactive"
export const CUSTOMER_ACTIVITIES: readonly CustomerActivity[] = [
  "all",
  "active",
  "inactive",
]

export function isCustomerActivity(value: unknown): value is CustomerActivity {
  return value === "all" || value === "active" || value === "inactive"
}

// What the screen asks admin_list_customers for: a search (2+ characters
// after trimming) over every customer, or, with an empty field, the open
// category (query ""). One character, or an empty field without a category:
// nothing.
export type ListRequest = { query: string; activity: CustomerActivity }

export function listRequest(
  query: string,
  category: CustomerActivity | null
): ListRequest | null {
  const asked = query.trim()
  if (asked.length >= 2) return { query: asked, activity: "all" }
  if (asked === "" && category) return { query: "", activity: category }
  return null
}

// The live answer, shown only for the request it answers: while a new query
// or category waits or runs, the old results are gone.
export function answerForFilter<A extends ListRequest>(
  request: ListRequest | null,
  answer: A | null
): A | null {
  return request &&
    answer?.query === request.query &&
    answer.activity === request.activity
    ? answer
    : null
}

// The empty text of an answer: a search, or the category's own.
export function emptyText(request: ListRequest): string {
  return request.query === ""
    ? copy.emptyCategory[request.activity]
    : copy.empty
}

// What the export exports (story 5.13), from the current request (also
// while its answer is pending or failed): the open category, or the search
// over every customer, with the count when the answer for that search is
// shown. The untouched screen (no category, under 2 characters) -> null,
// every customer.
export function shownList(
  request: ListRequest | null,
  shown: (ListRequest & { list: CustomerList }) | null
): ShownList | null {
  if (!request) return null
  if (request.query === "") {
    return { kind: "category", activity: request.activity }
  }
  const answered =
    shown?.query === request.query && shown.activity === request.activity
  return {
    kind: "search",
    query: request.query,
    count: answered
      ? shownCount(shown.list.customers.length, shown.list.has_more, LIST_LIMIT)
      : null,
  }
}

export type CustomerItem = {
  key: string
  href: string
  name: string
  phone: string | null
  activity: string
  activityOn: string | null
  notActivated: boolean
  inactive: boolean
}

type SearchParams = Record<string, string | string[] | undefined>

// The query kept in the URL (?q=), cut to the field's limit.
export function parseQuery(params: SearchParams): string {
  const value = params.q
  const q = (Array.isArray(value) ? value[0] : value) ?? ""
  return q.slice(0, QUERY_MAX)
}

// The open category in the URL (?activity=all|active|inactive); absent or
// anything else is none (the screen opens with the search alone).
export function parseActivity(params: SearchParams): CustomerActivity | null {
  const value = params.activity
  const activity = Array.isArray(value) ? value[0] : value
  return isCustomerActivity(activity) ? activity : null
}

// The search's address (history.replaceState while she types): only q.
export function listHref(query: string): string {
  return query.trim() === ""
    ? "/admin/customers"
    : `/admin/customers?q=${encodeURIComponent(query)}`
}

// A category button's address.
export function categoryHref(activity: CustomerActivity): string {
  return `/admin/customers?activity=${activity}`
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
    inactive: row.inactive === true,
  }
}
