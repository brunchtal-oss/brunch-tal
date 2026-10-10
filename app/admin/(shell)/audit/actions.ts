"use server"

import type { ActionResult } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { isPlainDate } from "@/lib/time"

import {
  isInstant,
  isUuid,
  toAuditView,
  type AuditCursor,
  type AuditFilters,
  type AuditPage,
  type AuditView,
} from "./audit-data"

// The audit log viewer (story 4.5). A read only: the RPC runs with the
// admin's own session (private.is_admin() inside) and decides everything;
// this checks only the shape. No idempotency key (nothing is written). The
// customer filter's search is the payments' searchCustomersAction.

function validFilters(filters: AuditFilters): boolean {
  return (
    typeof filters === "object" &&
    filters !== null &&
    (filters.eventId === null || isUuid(filters.eventId)) &&
    (filters.customerId === null || isUuid(filters.customerId)) &&
    typeof filters.from === "string" &&
    isPlainDate(filters.from) &&
    typeof filters.to === "string" &&
    isPlainDate(filters.to)
  )
}

// A page of the log: the first one (no cursor) or the next one ("טעינת
// עוד", the last row's created_at and id).
export async function loadAuditAction(
  filters: AuditFilters,
  cursor: AuditCursor | null
): Promise<ActionResult<AuditView>> {
  if (!validFilters(filters)) return { ok: false, code: "INVALID_INPUT" }
  if (
    cursor !== null &&
    (typeof cursor !== "object" ||
      !isUuid(cursor.id) ||
      !isInstant(cursor.createdAt))
  ) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const result = await callRpc(await createClient(), "admin_list_audit", {
    p_event_id: filters.eventId ?? undefined,
    p_customer_id: filters.customerId ?? undefined,
    p_from: filters.from,
    p_to: filters.to,
    p_before_created_at: cursor?.createdAt,
    p_before_id: cursor?.id,
  })
  if (!result.ok) return result
  return {
    ok: true,
    data: toAuditView(result.data as unknown as AuditPage),
  }
}
