import { adminCopy } from "@/lib/copy/admin"
import { toCsv } from "@/lib/csv"
import { formatLocalPhone } from "@/lib/phone"

// The customers CSV export (story 4.4, user decisions 2026-10-13): the closed
// column list, the request's parameters and the file. Only these columns can
// ever reach the file; admin_export_customers fills only the ones asked for.

/** A row of admin_export_customers (an unselected field is null). */
export type ExportRow = {
  full_name: string | null
  phone_e164: string | null
  email: string | null
}

type Column = {
  header: string
  value: (row: ExportRow) => string
}

const headers = adminCopy.customers.export.headers

// File order. The keys are the RPC's p_columns.
export const EXPORT_COLUMNS = {
  full_name: { header: headers.full_name, value: (r) => r.full_name ?? "" },
  phone: {
    header: headers.phone,
    value: (r) => (r.phone_e164 ? formatLocalPhone(r.phone_e164) : ""),
  },
  email: { header: headers.email, value: (r) => r.email ?? "" },
} satisfies Record<string, Column>

export type ExportColumn = keyof typeof EXPORT_COLUMNS
export type ExportScope = "all" | "search"

export const EXPORT_COLUMN_KEYS = Object.keys(
  EXPORT_COLUMNS
) as readonly ExportColumn[]

export function isExportColumn(value: string): value is ExportColumn {
  return Object.hasOwn(EXPORT_COLUMNS, value)
}

export type ExportParams = {
  scope: ExportScope
  // The trimmed search, only for scope "search".
  query: string | null
  // In file order.
  columns: ExportColumn[]
}

const QUERY_MIN = 2
const QUERY_MAX = 100

/**
 * `?scope=all|search&q=&cols=full_name,phone,email`. search needs q of 2-100
 * characters after trimming; cols is non-empty, without duplicates, from the
 * closed list. Anything else is INVALID_INPUT (the RPC checks again).
 */
export function parseExportParams(
  params: URLSearchParams
): { ok: true; data: ExportParams } | { ok: false; code: "INVALID_INPUT" } {
  const invalid = { ok: false, code: "INVALID_INPUT" } as const

  const scope = params.get("scope")
  if (scope !== "all" && scope !== "search") return invalid

  let query: string | null = null
  if (scope === "search") {
    query = (params.get("q") ?? "").trim()
    if (query.length < QUERY_MIN || query.length > QUERY_MAX) return invalid
  }

  const raw = (params.get("cols") ?? "").split(",").map((c) => c.trim())
  // An empty cols is [""], not a column.
  if (raw.some((c) => !isExportColumn(c))) return invalid
  if (new Set(raw).size !== raw.length) return invalid
  const chosen = new Set(raw)
  const columns = EXPORT_COLUMN_KEYS.filter((key) => chosen.has(key))

  return { ok: true, data: { scope, query, columns } }
}

// The shown search, offered as the sheet's second scope: its trimmed query
// and the count as the list shows it.
export type ShownSearch = { query: string; count: string }

/** The list's count as the sheet shows it: "200+" past the limit. */
export function shownCount(
  length: number,
  hasMore: boolean,
  limit: number
): string {
  return hasMore ? adminCopy.customers.export.moreThan(limit) : String(length)
}

/**
 * What the sheet asks for: without a shown search always "all" (no q); the
 * search scope sends the shown query.
 */
export function exportRequest(
  search: ShownSearch | null,
  scope: ExportScope,
  columns: readonly ExportColumn[]
): ExportParams {
  const chosen = search ? scope : "all"
  return {
    scope: chosen,
    query: chosen === "search" && search ? search.query : null,
    columns: [...columns],
  }
}

/** The route's {code} on a failed answer; anything else is SERVER_ERROR. */
export async function errorCodeOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown } | null
    if (body && typeof body.code === "string") return body.code
  } catch {
    // Not JSON (a proxy page, the site lock).
  }
  return "SERVER_ERROR"
}

export const EXPORT_PATH = "/api/admin/export"

/** The route's address for a choice of the sheet (parseExportParams reads it). */
export function exportHref({ scope, query, columns }: ExportParams): string {
  const params = new URLSearchParams({ scope })
  if (scope === "search") params.set("q", (query ?? "").trim())
  params.set(
    "cols",
    EXPORT_COLUMN_KEYS.filter((key) => columns.includes(key)).join(",")
  )
  return `${EXPORT_PATH}?${params.toString()}`
}

/** The file: the header row of the chosen columns, then one line a row. */
export function customersCsv(
  rows: readonly ExportRow[],
  columns: readonly ExportColumn[]
): string {
  return toCsv(
    columns.map((key) => EXPORT_COLUMNS[key].header),
    rows.map((row) => columns.map((key) => EXPORT_COLUMNS[key].value(row)))
  )
}

/** "customers-YYYY-MM-DD.csv" by the Jerusalem day (lib/time.ts localToday). */
export function exportFileName(today: string): string {
  return `customers-${today}.csv`
}
