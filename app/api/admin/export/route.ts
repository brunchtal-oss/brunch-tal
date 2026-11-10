import {
  customersCsv,
  exportFileName,
  parseExportParams,
  type ExportRow,
} from "@/lib/admin/customer-export"
import { getSpecialBrunchContent } from "@/lib/content/join-form"
import { callRpc } from "@/lib/rpc"
import { SPECIAL_BRUNCH_FALLBACK } from "@/lib/special-brunch"
import { createClient } from "@/lib/supabase/server"
import { localToday } from "@/lib/time"

// GET /api/admin/export?scope=all|search&q=&activity=all|active|inactive&
// interest=couples,grandma&cols=full_name,phone,email,
// special_brunch_interests (story 4.4, CAP-25; activity = the category for
// both scopes, story 5.13; interest optional, one or more codes, story
// 2.16): the customers CSV. The session client (RLS and the
// RPC's own admin check); admin_export_customers returns the rows and writes
// the audit row. No session or NOT_AUTHORIZED -> 403; malformed parameters
// or INVALID_INPUT -> 400; anything else -> 500, each as {code} JSON. Under
// /api, so it stays behind the preview site lock.

const NO_STORE = { "Cache-Control": "private, no-store" }

function error(code: string, status: number): Response {
  return Response.json({ code }, { status, headers: NO_STORE })
}

function statusOf(code: string): number {
  if (code === "NOT_AUTHORIZED") return 403
  if (code === "INVALID_INPUT") return 400
  return 500
}

function isExportRows(value: unknown): value is ExportRow[] {
  return (
    Array.isArray(value) &&
    value.every((row) => row !== null && typeof row === "object")
  )
}

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  // Without a session the RPC would answer 42501: the same 403.
  if (!claims?.claims) return error("NOT_AUTHORIZED", 403)

  const parsed = parseExportParams(new URL(request.url).searchParams)
  if (!parsed.ok) return error(parsed.code, 400)
  const { scope, query, activity, interests, columns } = parsed.data

  // The option titles of the special-brunch cell (story 2.16), read before
  // the RPC writes its audit row, and only when the column is chosen (the
  // fallback is never used then).
  let specialBrunch = SPECIAL_BRUNCH_FALLBACK
  if (columns.includes("special_brunch_interests")) {
    try {
      specialBrunch = await getSpecialBrunchContent()
    } catch {
      return error("SERVER_ERROR", 500)
    }
  }

  const result = await callRpc(supabase, "admin_export_customers", {
    p_scope: scope,
    p_query: query ?? "",
    p_columns: columns,
    p_activity: activity,
    // Always sent, [] = no filter (story 2.16): only the overload with
    // p_interests matches.
    p_interests: interests,
  })
  if (!result.ok) return error(result.code, statusOf(result.code))

  const rows = (result.data as { rows?: unknown } | null)?.rows
  if (!isExportRows(rows)) return error("SERVER_ERROR", 500)

  return new Response(customersCsv(rows, columns, specialBrunch), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(localToday())}"`,
    },
  })
}
