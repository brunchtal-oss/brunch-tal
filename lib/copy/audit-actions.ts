import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"
import { formatDayMonth, formatShortDate } from "@/lib/time"

// The audit log's whitelist (spec-audit-log-concise, user decision
// 2026-10-18): which actions /admin/audit lists, the main row of each
// operation ("{action}/{entity_type}", passed to admin_list_audit as
// p_shown), and the one result sentence each shows. Every other action is
// hidden (HIDDEN_AUDIT_ACTIONS, for story 5.20, which stops recording them).
//
// A new action written by private.audit gets a label in adminCopy.audit
// .actions, a decision here (shown or hidden) and, when shown, a result
// sentence or the edit flag (AGENTS.md).

const copy = adminCopy.audit
const results = copy.results

export type AuditChangeRow = { key: string; before: unknown; after: unknown }

export type AuditEventRef = { id: string; title: string; local_date: string }

// Another row of the same operation (same time, action and actor).
export type AuditRelatedRow = {
  entity_type: string
  changes: AuditChangeRow[]
  event: AuditEventRef | null
}

// One operation as admin_list_audit returns it: its main row, names derived
// now, its other rows in related. No raw before/after.
export type AuditRow = {
  id: string
  created_at: string
  actor_kind: string
  action: string
  entity_type: string
  customer: { id: string; name: string | null } | null
  event: AuditEventRef | null
  // A product's or concept's name, a content section's "{page}/{key}" or a
  // template's type; null for anything else.
  subject: string | null
  // A refund request's current amount (a full refund leaves it unchanged,
  // so it is not in changes).
  amount_agorot?: number | null
  // How a booking was paid, read now (private.booking_funding): "card",
  // "credit" or "pinned"; null for any other row.
  funding?: string | null
  changes: AuditChangeRow[]
  related: AuditRelatedRow[]
  reason: string | null
}

export type AuditRule = {
  // The operation's main row: its entity_type.
  entity: string
  // Only a created row of that pair is the main row (a move writes two
  // bookings rows: the new one is the main row).
  insertOnly?: boolean
  // An edit: the item lists the fields whose value changed.
  edit?: boolean
  // The result sentence; null (or no builder) shows the action's name only.
  result?: (row: AuditRow) => string | null
}

// Values of a row's changes, by key: what it became, and what it was.
export function afterValues(
  changes: readonly AuditChangeRow[]
): Record<string, unknown> {
  return Object.fromEntries(changes.map((c) => [c.key, c.after ?? null]))
}

export function beforeValues(
  changes: readonly AuditChangeRow[]
): Record<string, unknown> {
  return Object.fromEntries(changes.map((c) => [c.key, c.before ?? null]))
}

// A created row: every change has no before.
function isCreated(changes: readonly AuditChangeRow[]): boolean {
  return changes.length > 0 && changes.every((c) => (c.before ?? null) === null)
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null
}

function money(value: unknown): string | null {
  const agorot = count(value)
  return agorot === null ? null : formatAgorot(agorot)
}

// "בראנץ׳ {קונספט} {DD.MM}".
export function sessionLabelOf(event: AuditEventRef): string | null {
  try {
    return copy.sessionLabel(event.title, formatDayMonth(event.local_date))
  } catch {
    return null
  }
}

function related(row: AuditRow, entityType: string): AuditRelatedRow[] {
  return row.related.filter((r) => r.entity_type === entityType)
}

const booked = (row: AuditRow) =>
  results.booked(count(afterValues(row.changes).party_size) ?? 1)

// A cancelled booking: a refund request was opened, a credit was created
// (for N alternative sessions), the credit that paid it came back (not
// audited on its own, so read from the booking's funding), or the entry
// went back to the card. Anything else shows the action's name only.
const cancelled = (row: AuditRow) => {
  if (related(row, "refund_requests").length > 0) return results.refundOpened
  const credit = related(row, "cancellation_credits").find((r) =>
    isCreated(r.changes)
  )
  if (credit) {
    const n = count(afterValues(credit.changes).options_count)
    return n !== null && n > 0 ? results.credit(n) : null
  }
  if (row.funding === "credit") return results.creditReturned
  if (row.funding === "card") return results.backToCard
  return null
}

// A moved booking: the main row is the new booking; the source session is
// the other bookings row's session.
const moved = (row: AuditRow) => {
  const source = related(row, "bookings").find(
    (r) => r.event !== null && r.event.id !== row.event?.id
  )?.event
  const label = source ? sessionLabelOf(source) : null
  return label ? results.movedFrom(label) : null
}

const consent = (key: string) => (row: AuditRow) => {
  const value = afterValues(row.changes)[key]
  if (value === true) return results.consentGiven
  if (value === false) return results.consentWithdrawn
  return null
}

const accountChange = (changed: string, taken: string) => (row: AuditRow) =>
  afterValues(row.changes).result === "taken" ? taken : changed

export const SHOWN_AUDIT_ACTIONS: Record<string, readonly AuditRule[]> = {
  // Money.
  approve_payment: [
    {
      entity: "payments",
      result: (row) => {
        const after = afterValues(row.changes)
        const amount = money(after.amount_agorot)
        if (amount === null) return null
        const snapshot = after.product_snapshot
        const product =
          snapshot !== null &&
          typeof snapshot === "object" &&
          typeof (snapshot as { name?: unknown }).name === "string"
            ? (snapshot as { name: string }).name
            : null
        return product
          ? results.paid(amount, product)
          : results.paidAmount(amount)
      },
    },
  ],
  admin_complete_refund: [
    {
      entity: "refund_requests",
      result: (row) => {
        const change = row.changes.find((c) => c.key === "amount_agorot")
        const before = count(change?.before)
        const after = count(change?.after)
        if (before !== null && after !== null && after < before) {
          return results.refundedPartial(
            formatAgorot(after),
            formatAgorot(before)
          )
        }
        const amount = money(after ?? row.amount_agorot)
        return amount === null ? null : results.refunded(amount)
      },
    },
  ],
  // Bookings.
  book_session: [{ entity: "bookings", result: booked }],
  book_sessions: [{ entity: "bookings", result: booked }],
  admin_book_customer: [{ entity: "bookings", result: booked }],
  cancel_booking: [{ entity: "bookings", result: cancelled }],
  admin_cancel_booking: [{ entity: "bookings", result: cancelled }],
  move_booking: [{ entity: "bookings", insertOnly: true, result: moved }],
  admin_move_booking: [{ entity: "bookings", insertOnly: true, result: moved }],
  // Story 5.6: she joined or left a session's waitlist.
  join_waitlist: [
    { entity: "waitlist_entries", result: () => results.waitlistJoined },
  ],
  leave_waitlist: [
    { entity: "waitlist_entries", result: () => results.waitlistLeft },
  ],
  choose_credit_outcome: [
    {
      entity: "cancellation_credits",
      result: (row) =>
        related(row, "refund_requests").length > 0 ||
        afterValues(row.changes).status === "refund_requested"
          ? results.choseRefund
          : results.choseCredit,
    },
  ],
  // Story 3.16: Tal changed a credit's alternatives, or replaced it with a
  // refund request (its amount: the request row of the same operation).
  admin_change_credit_options: [
    {
      entity: "cancellation_credits",
      result: () => results.creditOptionsChanged,
    },
  ],
  admin_refund_credit: [
    {
      entity: "cancellation_credits",
      result: (row) => {
        const request = related(row, "refund_requests")[0]
        const amount = request
          ? money(afterValues(request.changes).amount_agorot)
          : null
        return amount === null ? null : results.creditRefunded(amount)
      },
    },
  ],
  // Sessions.
  admin_create_event: [{ entity: "events" }],
  admin_duplicate_event: [{ entity: "events" }],
  admin_publish_event: [{ entity: "events" }],
  admin_update_event: [{ entity: "events", edit: true }],
  admin_reschedule_event: [{ entity: "events", edit: true }],
  admin_cancel_event: [
    {
      entity: "events",
      result: (row) => {
        const n = related(row, "bookings").length
        return n > 0 ? results.bookingsCancelled(n) : null
      },
    },
  ],
  admin_delete_event: [
    {
      entity: "events",
      result: (row) => {
        const options = beforeValues(row.changes).credit_options
        const n = Array.isArray(options) ? options.length : 0
        return n > 0 ? results.creditOptionsRemoved(n) : null
      },
    },
  ],
  complete_event: [{ entity: "events" }],
  // Customers.
  admin_issue_link: [
    {
      entity: "activation_tokens",
      result: (row) => {
        const after = afterValues(row.changes)
        const purpose =
          typeof after.purpose === "string" &&
          Object.hasOwn(results.linkPurposes, after.purpose)
            ? results.linkPurposes[after.purpose]
            : null
        if (!purpose || typeof after.expires_at !== "string") return null
        try {
          return results.link(purpose, formatShortDate(after.expires_at))
        } catch {
          return null
        }
      },
    },
  ],
  revoke_link: [{ entity: "activation_tokens" }],
  reset_complete: [{ entity: "activation_tokens" }],
  join_complete: [{ entity: "profiles" }],
  bind_purchase: [{ entity: "payments" }],
  admin_add_customer_note: [{ entity: "customer_notes" }],
  admin_delete_customer_note: [{ entity: "customer_notes" }],
  admin_finish_email_change: [
    {
      entity: "profiles",
      result: accountChange(results.emailChanged, results.emailTaken),
    },
  ],
  admin_change_phone: [
    {
      entity: "profiles",
      result: accountChange(results.phoneChanged, results.phoneTaken),
    },
  ],
  admin_export_customers: [
    {
      entity: "profiles",
      result: (row) => {
        const n = count(afterValues(row.changes).row_count)
        return n === null ? null : results.exported(n)
      },
    },
  ],
  set_photo_consent: [{ entity: "profiles", result: consent("photo_consent") }],
  set_personal_photo_consent: [
    { entity: "profiles", result: consent("personal_photo_consent") },
  ],
  // Entitlements (story 3.13).
  admin_correct_entitlement: [
    { entity: "entitlements", edit: true },
    {
      entity: "entitlement_movements",
      result: (row) => {
        const units = count(afterValues(row.changes).units)
        if (units === null || units === 0) return null
        return units > 0
          ? results.unitsAdded(units)
          : results.unitsRemoved(-units)
      },
    },
  ],
  admin_settle_parked_purchase: [
    { entity: "cancellation_credits", result: () => results.parkedSettled },
  ],
  admin_set_correction_booking_handled: [
    { entity: "entitlement_correction_bookings" },
  ],
  // Story 3.14: one row per extended week (actor: the system).
  job_auto_extend: [
    { entity: "entitlements", result: () => results.autoExtended },
  ],
  // Products.
  admin_create_product: [{ entity: "products" }],
  admin_update_product: [{ entity: "products", edit: true }],
  admin_set_product_price: [{ entity: "products", edit: true }],
  // Settings, templates, content and concepts.
  admin_update_business_settings: [{ entity: "business_settings", edit: true }],
  admin_update_notification_template: [
    { entity: "notification_templates", edit: true },
  ],
  admin_publish_content: [{ entity: "content_sections" }],
  admin_create_concept: [{ entity: "concepts" }],
  admin_update_concept: [{ entity: "concepts", edit: true }],
  admin_delete_concept: [{ entity: "concepts" }],
  admin_set_concept_archived: [
    {
      entity: "concepts",
      result: (row) =>
        afterValues(row.changes).archived_at === null
          ? results.unarchived
          : results.archived,
    },
  ],
}

// Recorded but never listed: nothing in them is worth checking later
// (story 5.20 stops recording them).
export const HIDDEN_AUDIT_ACTIONS: readonly string[] = [
  // The work sheet.
  "admin_add_prep_day",
  "admin_remove_prep_day",
  "admin_move_prep_day",
  "admin_add_work_dish",
  "admin_update_work_dish",
  "admin_delete_work_dish",
  "admin_set_work_dish_order",
  "admin_add_work_task",
  "admin_update_work_task",
  "admin_delete_work_task",
  "admin_set_work_task_done",
  "admin_set_work_task_order",
  "admin_add_shopping_item",
  "admin_add_shopping_items",
  "admin_update_shopping_item",
  "admin_delete_shopping_item",
  "admin_set_shopping_item_bought",
  "admin_set_shopping_item_order",
  // Notes and topics.
  "admin_add_note",
  "admin_update_note",
  "admin_delete_note",
  "admin_set_note_archived",
  "admin_set_note_done",
  "admin_set_note_pinned",
  "admin_set_note_order",
  "admin_add_note_topic",
  "admin_rename_note_topic",
  "admin_delete_note_topic",
  "admin_set_note_topic_order",
  // Drafts and images.
  "admin_set_content_draft",
  "admin_create_media",
  "admin_begin_media_publish",
  "admin_finish_media_publish",
  "media_hidden",
  "admin_set_event_image",
  "admin_set_concept_image",
  // The same approval as approve_payment (AD-10).
  "admin_approve_payment",
  // Technical steps.
  "admin_begin_email_change",
  "join_begin",
  "migrate_identity_match",
  "refresh_returned_entitlements",
  // Masked, nothing to check.
  "set_booking_guest_details",
  // Calls bind_purchase, which is shown.
  "claim_join",
]

export function auditRules(action: string): readonly AuditRule[] {
  return Object.hasOwn(SHOWN_AUDIT_ACTIONS, action)
    ? SHOWN_AUDIT_ACTIONS[action]
    : []
}

// The rule of a listed row (its action and main entity), or null.
export function auditRuleOf(
  action: string,
  entityType: string
): AuditRule | null {
  return auditRules(action).find((rule) => rule.entity === entityType) ?? null
}

// admin_list_audit's p_shown: "{action}/{entity_type}", or
// "{action}/{entity_type}/insert" for a created row only.
export function shownPairs(): string[] {
  return Object.entries(SHOWN_AUDIT_ACTIONS).flatMap(([action, rules]) =>
    rules.map(
      (rule) => `${action}/${rule.entity}${rule.insertOnly ? "/insert" : ""}`
    )
  )
}
