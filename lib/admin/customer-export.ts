import type { SpecialBrunchContent } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"
import { toCsv } from "@/lib/csv"
import { formatLocalPhone } from "@/lib/phone"
import {
  isSpecialBrunchCode,
  specialBrunchLabels,
  type SpecialBrunchCode,
} from "@/lib/special-brunch"

// The customers CSV export (story 4.4, user decisions 2026-10-13): the closed
// column list, the request's parameters and the file. Only these columns can
// ever reach the file; admin_export_customers fills only the ones asked for.

/** A row of admin_export_customers (an unselected field is null). */
export type ExportRow = {
  full_name: string | null
  phone_e164: string | null
  email: string | null
  // Story 2.16: the codes (absent from rows of an older answer).
  special_brunch_interests?: string[] | null
}

// specialBrunch: the content block's wording, for the option titles.
type Column = {
  header: string
  value: (row: ExportRow, specialBrunch: SpecialBrunchContent) => string
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
  // Story 2.16: the titles in code order, joined by ", "; empty when none.
  special_brunch_interests: {
    header: headers.special_brunch_interests,
    value: (r, specialBrunch) =>
      specialBrunchLabels(specialBrunch, r.special_brunch_interests).join(", "),
  },
} satisfies Record<string, Column>

export type ExportColumn = keyof typeof EXPORT_COLUMNS
export type ExportScope = "all" | "search"
// The category (story 5.13): "all" = active and inactive. Both scopes carry
// it: "all" exports the whole category, "search" the matches within it.
export type ExportActivity = "all" | "active" | "inactive"

function isExportActivity(value: unknown): value is ExportActivity {
  return value === "all" || value === "active" || value === "inactive"
}

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
  // The category, for both scopes.
  activity: ExportActivity
  // Story 2.16: one special brunch, or null (no filter).
  interest: SpecialBrunchCode | null
  // In file order.
  columns: ExportColumn[]
}

const QUERY_MIN = 2
const QUERY_MAX = 100

/**
 * `?scope=all|search&q=&activity=all|active|inactive&interest=couples&cols=full_name,phone,email`.
 * search needs q of 2-100 characters after trimming; all ignores q. activity
 * is required for both; interest (story 2.16) is optional, else a known
 * code. cols is non-empty, without duplicates, from the
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

  const activity = params.get("activity")
  if (!isExportActivity(activity)) return invalid

  const rawInterest = params.get("interest")
  if (rawInterest !== null && !isSpecialBrunchCode(rawInterest)) return invalid
  const interest = rawInterest

  const raw = (params.get("cols") ?? "").split(",").map((c) => c.trim())
  // An empty cols is [""], not a column.
  if (raw.some((c) => !isExportColumn(c))) return invalid
  if (new Set(raw).size !== raw.length) return invalid
  const chosen = new Set(raw)
  const columns = EXPORT_COLUMN_KEYS.filter((key) => chosen.has(key))

  return { ok: true, data: { scope, query, activity, interest, columns } }
}

// What the screen asks for, which the sheet exports (story 5.13): a whole
// category, or a search over every customer with its trimmed query and the
// count as the list shows it (null while its answer is not shown). A
// category carries its special-brunch filter (story 2.16; null = none).
export type ShownList =
  | {
      kind: "category"
      activity: ExportActivity
      interest: SpecialBrunchCode | null
    }
  | { kind: "search"; query: string; count: string | null }

/** The list's count as the sheet shows it: "200+" past the limit. */
export function shownCount(
  length: number,
  hasMore: boolean,
  limit: number
): string {
  return hasMore ? adminCopy.customers.export.moreThan(limit) : String(length)
}

/** The sheet's line: what the file will hold. Nothing shown = every customer. */
export function exportLine(shown: ShownList | null): string {
  const copy = adminCopy.customers.export
  if (shown?.kind === "search") return copy.chosenSearch(shown.count)
  return copy.chosen[shown ? shown.activity : "all"]
}

/**
 * Story 2.16: the line under it while the special-brunch filter is on (the
 * option's title from the content block), else null.
 */
export function exportInterestLine(
  shown: ShownList | null,
  specialBrunch: SpecialBrunchContent
): string | null {
  if (shown?.kind !== "category" || !shown.interest) return null
  const [label] = specialBrunchLabels(specialBrunch, [shown.interest])
  return adminCopy.customers.export.onlyInterest(label)
}

/**
 * What the sheet asks for: a category -> scope all with that category; a
 * search -> scope search with its query over every customer; nothing shown
 * -> every customer.
 */
export function exportRequest(
  shown: ShownList | null,
  columns: readonly ExportColumn[]
): ExportParams {
  if (shown?.kind === "search") {
    return {
      scope: "search",
      query: shown.query,
      activity: "all",
      interest: null,
      columns: [...columns],
    }
  }
  return {
    scope: "all",
    query: null,
    activity: shown ? shown.activity : "all",
    interest: shown ? shown.interest : null,
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
export function exportHref({
  scope,
  query,
  activity,
  interest,
  columns,
}: ExportParams): string {
  const params = new URLSearchParams({ scope })
  if (scope === "search") params.set("q", (query ?? "").trim())
  params.set("activity", activity)
  if (interest) params.set("interest", interest)
  params.set(
    "cols",
    EXPORT_COLUMN_KEYS.filter((key) => columns.includes(key)).join(",")
  )
  return `${EXPORT_PATH}?${params.toString()}`
}

/** The file: the header row of the chosen columns, then one line a row. */
export function customersCsv(
  rows: readonly ExportRow[],
  columns: readonly ExportColumn[],
  specialBrunch: SpecialBrunchContent
): string {
  return toCsv(
    columns.map((key) => EXPORT_COLUMNS[key].header),
    rows.map((row) =>
      columns.map((key) => EXPORT_COLUMNS[key].value(row, specialBrunch))
    )
  )
}

/** "customers-YYYY-MM-DD.csv" by the Jerusalem day (lib/time.ts localToday). */
export function exportFileName(today: string): string {
  return `customers-${today}.csv`
}
