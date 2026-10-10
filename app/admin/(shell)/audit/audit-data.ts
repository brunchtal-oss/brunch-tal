import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import {
  formatClockTime,
  formatShortDate,
  formatTime,
  isPlainDate,
} from "@/lib/time"

// The audit log viewer (story 4.5): the URL's filters, the RPC's rows
// (admin_list_audit) and what each row shows. Pure. Which rows match, their
// order, the names and which keys are dropped are decided in SQL; this only
// words them.

const copy = adminCopy.audit

// admin_list_audit returns at most this many rows per page (then has_more).
export const PAGE_SIZE = 50
// The default range when the URL has no dates (user decision 2026-10-10).
export const DEFAULT_DAYS = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INSTANT =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i
const CLOCK = /^\d{2}:\d{2}(?::\d{2})?$/
const MAX_TEXT = 120

export const MASKED = "<changed>"

export type AuditFilters = {
  eventId: string | null
  customerId: string | null
  from: string
  to: string
}

export type AuditCursor = { createdAt: string; id: string }

export type AuditChangeRow = { key: string; before: unknown; after: unknown }

export type AuditRow = {
  id: string
  created_at: string
  actor_kind: string
  action: string
  entity_type: string
  customer: { id: string; name: string | null } | null
  event: { id: string; title: string; local_date: string } | null
  changes: AuditChangeRow[]
  reason: string | null
}

export type AuditPage = { rows: AuditRow[]; has_more: boolean }

// One change as the screen shows it: "{field}: {before} ← {after}"; an add
// has only the new value, a delete only the old one.
export type AuditChange =
  | {
      key: string
      field: string
      kind: "change"
      before: string
      after: string
    }
  | { key: string; field: string; kind: "add"; after: string }
  | { key: string; field: string; kind: "delete"; before: string }

export type AuditItem = {
  id: string
  createdAt: string
  when: string
  actor: string
  action: string
  customer: string | null
  session: string | null
  changes: AuditChange[]
  reason: string | null
}

// What the browser gets for a page: the worded items and the next cursor.
export type AuditView = {
  items: AuditItem[]
  next: AuditCursor | null
}

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

// A plain date plus whole days (display only: the URL's default range).
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
}

// The filters kept in the URL (?event=&customer=&from=&to=). A value that
// is not a UUID or a real date is ignored. Without dates: the last 30 days
// to today (Jerusalem); a missing end is today, a missing start is 30 days
// before the end. The RPC checks the range again (from <= to, a year).
export function parseAuditParams(
  params: SearchParams,
  today: string
): AuditFilters {
  const uuid = (value: string) => (UUID.test(value) ? value : null)
  const date = (value: string) => (isPlainDate(value) ? value : null)
  const to = date(first(params.to)) ?? today
  const from = date(first(params.from)) ?? addDays(to, -DEFAULT_DAYS)
  return {
    eventId: uuid(first(params.event)),
    customerId: uuid(first(params.customer)),
    from,
    to,
  }
}

// The address of a set of filters. Dates equal to the default are left out,
// so a clean URL stays clean.
export function auditHref(filters: AuditFilters, today: string): string {
  const query = new URLSearchParams()
  if (filters.eventId) query.set("event", filters.eventId)
  if (filters.customerId) query.set("customer", filters.customerId)
  const isDefault =
    filters.to === today && filters.from === addDays(today, -DEFAULT_DAYS)
  if (!isDefault) {
    query.set("from", filters.from)
    query.set("to", filters.to)
  }
  const text = query.toString()
  return text ? `/admin/audit?${text}` : "/admin/audit"
}

export function actionLabel(action: string): string {
  return Object.hasOwn(copy.actions, action) ? copy.actions[action] : action
}

export function fieldLabel(key: string): string {
  return Object.hasOwn(copy.fields, key) ? copy.fields[key] : key
}

export function actorLabel(kind: string): string {
  return Object.hasOwn(copy.actors, kind) ? copy.actors[kind] : kind
}

function cut(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text
}

// The leaf strings and numbers of an object or array, in order (booleans
// and nulls skipped).
function leaves(value: unknown): string[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value]
  if (typeof value === "number") return [String(value)]
  if (Array.isArray(value)) return value.flatMap(leaves)
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(leaves)
  }
  return []
}

// An object or array as readable text: its leaf values joined with " · ".
function readable(value: unknown): string {
  const text = leaves(value).join(" · ")
  return text === "" ? copy.none : cut(text)
}

// Keys that say nothing to Tal (who wrote it, snapshots, storage, counters
// and versions). booked_by stays.
const TECHNICAL_KEYS = new Set([
  "storage_path",
  "public_path",
  "focus_x",
  "focus_y",
  "identity_attempts",
  "claiming_at",
  "publish_started_at",
  "privacy_policy_version",
  "waitlist_cycle",
  "revision",
  "provider",
  "task_order",
])

export function isTechnicalKey(key: string): boolean {
  return (
    TECHNICAL_KEYS.has(key) ||
    (key.endsWith("_by") && key !== "booked_by") ||
    key.endsWith("_snapshot") ||
    key.endsWith("_text_version")
  )
}

// A change worth a line: not a technical key, not null on both sides (an
// inserted row carries every column), and not only ids.
export function isShownChange(change: AuditChangeRow): boolean {
  if (isTechnicalKey(change.key)) return false
  const values = [change.before, change.after].filter(
    (value) => value !== null && value !== undefined
  )
  if (values.length === 0) return false
  return !values.every((value) => isUuid(value))
}

// allowed_weekdays: 0 = Sunday ("א׳") ... 6 = Saturday ("ש׳").
export function weekdaysText(value: unknown): string | null {
  if (
    !Array.isArray(value) ||
    !value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  ) {
    return null
  }
  if (value.length === 0) return copy.none
  return value.map((day: number) => copy.weekdays[day]).join(", ")
}

// An instant string with its zone, as jsonb gives timestamptz
// ("2026-10-10T09:15:00.123456+00:00").
export function isInstant(value: unknown): boolean {
  return typeof value === "string" && INSTANT.test(value)
}

// A date a date input may navigate to: a real day from the year 2000 (typing
// a year digit by digit passes through 0002-10-10 and the like).
export function isFilterDate(value: string): boolean {
  return isPlainDate(value) && Number(value.slice(0, 4)) >= 2000
}

// The date input that admin_list_audit's INVALID_INPUT points at (detail
// field "to" or "from"); any other error is not a date error.
export function dateErrorOf(
  result:
    { ok: true } | { ok: false; code: string; detail?: { field?: string } }
): "from" | "to" | null {
  if (result.ok || result.code !== "INVALID_INPUT") return null
  const field = result.detail?.field
  return field === "from" || field === "to" ? field : null
}

// One value: a known code value (status, state, kind...) in Hebrew,
// "<changed>" is "השתנה", booleans כן/לא, *_agorot in ₪,
// timestamps and dates by lib/time, null "—", allowed_weekdays as day
// names, other arrays and objects as their values joined with " · ".
export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return copy.none
  if (value === MASKED) return copy.masked
  if (typeof value === "boolean") return value ? copy.yes : copy.no
  if (typeof value === "number") {
    return key.endsWith("_agorot") && Number.isSafeInteger(value)
      ? formatAgorot(value)
      : String(value)
  }
  if (typeof value === "string") {
    const known = copy.values[key]
    if (known && Object.hasOwn(known, value)) return known[value]
    try {
      if (isInstant(value)) {
        return copy.when(formatShortDate(value), formatTime(value))
      }
      if (isPlainDate(value)) return formatShortDate(value)
    } catch {
      return value
    }
    if (CLOCK.test(value)) return formatClockTime(value)
    return cut(value)
  }
  if (key === "allowed_weekdays") {
    const days = weekdaysText(value)
    if (days !== null) return days
  }
  return readable(value)
}

export function toChange(change: AuditChangeRow): AuditChange {
  const field = fieldLabel(change.key)
  const before = change.before ?? null
  const after = change.after ?? null
  if (before === null && after !== null) {
    return {
      key: change.key,
      field,
      kind: "add",
      after: formatValue(change.key, after),
    }
  }
  if (after === null && before !== null) {
    return {
      key: change.key,
      field,
      kind: "delete",
      before: formatValue(change.key, before),
    }
  }
  return {
    key: change.key,
    field,
    kind: "change",
    before: formatValue(change.key, before),
    after: formatValue(change.key, after),
  }
}

export function toAuditItem(row: AuditRow): AuditItem {
  return {
    id: row.id,
    createdAt: row.created_at,
    when: copy.when(
      formatShortDate(row.created_at),
      formatTime(row.created_at)
    ),
    actor: actorLabel(row.actor_kind),
    action: actionLabel(row.action),
    customer: row.customer ? (row.customer.name ?? copy.anonymous) : null,
    session: row.event
      ? copy.sessionLabel(
          row.event.title,
          formatShortDate(row.event.local_date)
        )
      : null,
    changes: row.changes.filter(isShownChange).map(toChange),
    reason: row.reason && row.reason.trim() !== "" ? row.reason : null,
  }
}

// A page of rows, worded, with the cursor of the next page (the last row's
// created_at and id) when there is one. The raw before/after never leave
// the server.
export function toAuditView(page: AuditPage): AuditView {
  const last = page.rows.at(-1)
  return {
    items: page.rows.map(toAuditItem),
    next:
      page.has_more && last
        ? { createdAt: last.created_at, id: last.id }
        : null,
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}

// How many filters are on: the session, the customer, and dates other than
// the default range.
export function activeFilterCount(
  filters: AuditFilters,
  today: string
): number {
  return (
    (filters.eventId ? 1 : 0) +
    (filters.customerId ? 1 : 0) +
    (hasCustomDates(filters, today) ? 1 : 0)
  )
}

function hasCustomDates(filters: AuditFilters, today: string): boolean {
  return !(
    filters.to === today && filters.from === addDays(today, -DEFAULT_DAYS)
  )
}

// One line of what is filtered, for the closed panel: the session, the
// customer, the dates. null when nothing is filtered.
export function filterSummary(
  filters: AuditFilters,
  today: string,
  sessions: readonly SessionOption[],
  customerName: string | null
): string | null {
  const parts: string[] = []
  if (filters.eventId) {
    const session = sessions.find((s) => s.id === filters.eventId)
    parts.push(session?.label ?? copy.session)
  }
  if (filters.customerId) parts.push(customerName ?? copy.anonymous)
  if (hasCustomDates(filters, today)) {
    parts.push(
      copy.dateRange(formatShortDate(filters.from), formatShortDate(filters.to))
    )
  }
  return parts.length === 0 ? null : copy.summary(parts.join(" · "))
}

// The keys of the page's two URL-keyed parts. Siblings need distinct keys:
// one shared key made React keep a stale filter bar on every navigation.
export function auditKeys(href: string): { filters: string; list: string } {
  return { filters: `filters:${href}`, list: `list:${href}` }
}

// The session select's options, "{קונספט} · {date}", in the order read
// (newest first, ordered by the query).
export type SessionOption = { id: string; label: string }

export function toSessionOptions(
  rows: readonly {
    id: string
    starts_at: string
    concepts: { name: string } | null
  }[]
): SessionOption[] {
  return rows.map((row) => ({
    id: row.id,
    label: copy.sessionOption(
      row.concepts?.name ?? "",
      formatShortDate(row.starts_at)
    ),
  }))
}
