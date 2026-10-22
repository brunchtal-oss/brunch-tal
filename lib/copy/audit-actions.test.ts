import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  HIDDEN_AUDIT_ACTIONS,
  SHOWN_AUDIT_ACTIONS,
  auditRuleOf,
  shownPairs,
  type AuditChangeRow,
  type AuditRelatedRow,
  type AuditRow,
} from "./audit-actions"

// The audit log's whitelist (spec-audit-log-concise): every action written
// by private.audit is shown or hidden, every shown one has a label and a
// pair, and each result sentence matches the spec's matrix.

const actions = adminCopy.audit.actions
const EVENT = "11111111-1111-4111-8111-111111111111"
const OTHER_EVENT = "22222222-2222-4222-8222-222222222222"

function row(extra: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    created_at: "2026-10-10T09:15:00+00:00",
    actor_kind: "admin",
    action: "approve_payment",
    entity_type: "payments",
    customer: null,
    event: null,
    subject: null,
    changes: [],
    related: [],
    reason: null,
    ...extra,
  }
}

// An inserted row's changes: every key from nothing.
function created(values: Record<string, unknown>): AuditChangeRow[] {
  return Object.entries(values).map(([key, after]) => ({
    key,
    before: null,
    after,
  }))
}

function rel(
  entity_type: string,
  changes: AuditChangeRow[],
  event: AuditRelatedRow["event"] = null
): AuditRelatedRow {
  return { entity_type, changes, event }
}

function result(extra: Partial<AuditRow>): string | null {
  const r = row(extra)
  return auditRuleOf(r.action, r.entity_type)?.result?.(r) ?? null
}

// Written only by functions that were dropped or rewritten since (topics,
// the single shopping item, one-time migrations): old migration files still
// contain them, but no live function writes them any more.
const RETIRED_AUDIT_ACTIONS = [
  "admin_add_note_topic",
  "admin_rename_note_topic",
  "admin_delete_note_topic",
  "admin_set_note_topic_order",
  "admin_add_shopping_item",
  "refresh_returned_entitlements",
  "migrate_identity_match",
]

// The actions private.audit is called with as a literal in the migrations.
function auditedActions(): string[] {
  const dir = fileURLToPath(
    new URL("../../supabase/migrations/", import.meta.url)
  )
  const sql = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(`${dir}${name}`, "utf8"))
    .join("\n")
  const found = new Set<string>()
  for (const match of sql.matchAll(
    /private\.audit\(\s*[^,()]+,\s*[^,()]+,\s*'([a-z_]+)'/g
  )) {
    found.add(match[1])
  }
  return [...found].sort()
}

describe("the whitelist", () => {
  it("every shown action has a Hebrew label and its pairs", () => {
    for (const [action, rules] of Object.entries(SHOWN_AUDIT_ACTIONS)) {
      expect(Object.hasOwn(actions, action), action).toBe(true)
      expect(actions[action], action).not.toBe(action)
      expect(rules.length, action).toBeGreaterThan(0)
    }
    const pairs = shownPairs()
    expect(pairs).toContain("approve_payment/payments")
    expect(pairs).toContain("move_booking/bookings/insert")
    expect(pairs).toContain("admin_correct_entitlement/entitlements")
    expect(pairs).toContain("admin_correct_entitlement/entitlement_movements")
    for (const pair of pairs) {
      expect(pair).toMatch(/^[a-z_]+\/[a-z_]+(\/insert)?$/)
    }
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it("shown and hidden never overlap; hidden actions have no label", () => {
    for (const action of HIDDEN_AUDIT_ACTIONS) {
      expect(Object.hasOwn(SHOWN_AUDIT_ACTIONS, action), action).toBe(false)
      expect(Object.hasOwn(actions, action), action).toBe(false)
    }
    expect(HIDDEN_AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        "admin_approve_payment",
        "admin_set_content_draft",
        "admin_add_work_task",
        "admin_add_note",
        "admin_create_media",
        "admin_set_event_image",
        "set_booking_guest_details",
        "claim_join",
      ])
    )
  })

  it("every action written by private.audit is shown or hidden (a new one needs a decision)", () => {
    const decided = new Set([
      ...Object.keys(SHOWN_AUDIT_ACTIONS),
      ...HIDDEN_AUDIT_ACTIONS,
      ...RETIRED_AUDIT_ACTIONS,
    ])
    const found = auditedActions()
    expect(found.length).toBeGreaterThan(50)
    expect(found.filter((action) => !decided.has(action))).toEqual([])
    // The cores receive their action as a parameter (p_action).
    for (const action of [
      "book_session",
      "book_sessions",
      "admin_book_customer",
      "cancel_booking",
      "admin_cancel_booking",
      "move_booking",
      "admin_move_booking",
    ]) {
      expect(decided.has(action), action).toBe(true)
    }
  })

  it("retired actions are neither shown nor hidden", () => {
    for (const action of RETIRED_AUDIT_ACTIONS) {
      expect(Object.hasOwn(SHOWN_AUDIT_ACTIONS, action), action).toBe(false)
      expect(HIDDEN_AUDIT_ACTIONS, action).not.toContain(action)
    }
  })

  it("every label in adminCopy.audit.actions is a shown action", () => {
    for (const action of Object.keys(actions)) {
      expect(Object.hasOwn(SHOWN_AUDIT_ACTIONS, action), action).toBe(true)
    }
  })
})

describe("result sentences", () => {
  it("an approval: the amount and the product", () => {
    expect(
      result({
        changes: created({
          amount_agorot: 47200,
          product_snapshot: { name: "כרטיסייה אישית", units: 4 },
        }),
      })
    ).toBe("שולמו 472 ₪ על כרטיסייה אישית")
    expect(result({ changes: created({ amount_agorot: 12800 }) })).toBe(
      "שולמו 128 ₪"
    )
  })

  it("a refund: full from the current amount, partial out of what was asked", () => {
    const refund = {
      action: "admin_complete_refund",
      entity_type: "refund_requests",
    }
    expect(
      result({
        ...refund,
        amount_agorot: 12800,
        changes: [{ key: "status", before: "requested", after: "completed" }],
      })
    ).toBe("הוחזרו 128 ₪")
    expect(
      result({
        ...refund,
        changes: [{ key: "amount_agorot", before: 18000, after: 8000 }],
      })
    ).toBe("הוחזרו 80 ₪ מתוך 180 ₪")
  })

  it("a booking: one place or more", () => {
    const booking = { action: "book_session", entity_type: "bookings" }
    expect(result({ ...booking, changes: created({ party_size: 1 }) })).toBe(
      "נרשמה"
    )
    expect(
      result({
        ...booking,
        action: "admin_book_customer",
        changes: created({ party_size: 2 }),
      })
    ).toBe("נרשמה (2 מקומות)")
  })

  it("a cancellation: a credit for N sessions, a refund request, or back to the card", () => {
    const cancel = {
      action: "cancel_booking",
      entity_type: "bookings",
      changes: [{ key: "status", before: "confirmed", after: "cancelled" }],
    }
    const credit = (n: number) =>
      rel("cancellation_credits", created({ options_count: n }))
    expect(result({ ...cancel, related: [credit(2)] })).toBe(
      "התקבל זיכוי לשני מפגשים"
    )
    expect(result({ ...cancel, related: [credit(1)] })).toBe(
      "התקבל זיכוי למפגש אחד"
    )
    expect(result({ ...cancel, related: [credit(3)] })).toBe(
      "התקבל זיכוי ל-3 מפגשים"
    )
    expect(
      result({
        ...cancel,
        action: "admin_cancel_booking",
        related: [
          credit(2),
          rel("refund_requests", created({ amount_agorot: 1 })),
        ],
      })
    ).toBe("נפתחה בקשת החזר")
    // No refund and no new credit: the booking's funding decides.
    expect(result({ ...cancel, funding: "card" })).toBe("הכניסה חזרה לכרטיסייה")
    // A booking made with a credit: the credit comes back, not audited.
    expect(result({ ...cancel, funding: "credit" })).toBe("הזיכוי חזר ללקוחה")
    // A credit update is not a new credit; the funding still decides.
    expect(
      result({
        ...cancel,
        funding: "credit",
        related: [
          rel("cancellation_credits", [
            { key: "status", before: "used", after: "active" },
          ]),
        ],
      })
    ).toBe("הזיכוי חזר ללקוחה")
    // Pinned without a new credit, or unknown funding: name only.
    expect(result({ ...cancel, funding: "pinned" })).toBeNull()
    expect(result(cancel)).toBeNull()
  })

  it("a credit choice", () => {
    const choice = {
      action: "choose_credit_outcome",
      entity_type: "cancellation_credits",
    }
    expect(
      result({
        ...choice,
        changes: [{ key: "choice_pending", before: true, after: false }],
      })
    ).toBe("נבחר זיכוי")
    expect(
      result({
        ...choice,
        changes: [
          { key: "choice_pending", before: true, after: false },
          { key: "status", before: "active", after: "refund_requested" },
        ],
        related: [rel("refund_requests", created({ amount_agorot: 12800 }))],
      })
    ).toBe("נבחר החזר, נפתחה בקשת החזר")
  })

  it("a move: from the other bookings row's session; unknown source is name only", () => {
    const move = {
      action: "move_booking",
      entity_type: "bookings",
      event: { id: EVENT, title: "יווני", local_date: "2026-10-20" },
      changes: created({ status: "confirmed" }),
    }
    expect(auditRuleOf("move_booking", "bookings")?.insertOnly).toBe(true)
    expect(
      result({
        ...move,
        related: [
          rel(
            "bookings",
            [{ key: "status", before: "confirmed", after: "cancelled" }],
            { id: OTHER_EVENT, title: "סתיו", local_date: "2026-10-12" }
          ),
        ],
      })
    ).toBe("הועברה מבראנץ׳ סתיו 12.10")
    expect(result(move)).toBeNull()
  })

  it("a session cancel counts the cancelled bookings; a delete counts removed credit options", () => {
    const cancelEvent = { action: "admin_cancel_event", entity_type: "events" }
    const booking = rel("bookings", [
      { key: "status", before: "confirmed", after: "cancelled" },
    ])
    expect(result({ ...cancelEvent, related: [booking, booking] })).toBe(
      "בוטלו 2 הרשמות"
    )
    expect(result({ ...cancelEvent, related: [booking] })).toBe(
      "בוטלה הרשמה אחת"
    )
    expect(result(cancelEvent)).toBeNull()
    expect(
      result({
        action: "admin_delete_event",
        entity_type: "events",
        changes: [{ key: "credit_options", before: [{}], after: null }],
      })
    ).toBe("הוסרה חלופת זיכוי אחת")
  })

  it("story 3.18: a session's product set, by name, or all", () => {
    for (const action of ["admin_create_event", "admin_duplicate_event"]) {
      expect(
        result({
          action,
          entity_type: "event_products",
          changes: [
            { key: "product_names", before: [], after: ["בראנץ׳ חג", "רגיל"] },
          ],
        })
      ).toBe("המוצרים התקפים: בראנץ׳ חג, רגיל")
    }
    expect(
      result({
        action: "admin_update_event",
        entity_type: "event_products",
        changes: [{ key: "product_names", before: ["בראנץ׳ חג"], after: [] }],
      })
    ).toBe("המוצרים התקפים: כל המוצרים המתאימים (קודם: בראנץ׳ חג)")
  })

  it("customers: a link, an account change, an export, a consent", () => {
    // Story 4.6: the removal, with no details.
    expect(
      result({
        action: "admin_anonymize_customer",
        entity_type: "profiles",
        changes: [
          { key: "anonymized_at", before: null, after: "2026-10-20T08:00:00Z" },
        ],
      })
    ).toBe("הפרטים האישיים של הלקוחה הוסרו")
    expect(
      result({
        action: "admin_issue_link",
        entity_type: "activation_tokens",
        changes: created({
          purpose: "reset",
          expires_at: "2026-10-15T21:49:23+00:00",
        }),
      })
    ).toBe("קישור לאיפוס סיסמה, בתוקף עד 16.10.26")
    expect(
      result({
        action: "admin_issue_link",
        entity_type: "activation_tokens",
        changes: created({ purpose: "mystery" }),
      })
    ).toBeNull()
    const phone = { action: "admin_change_phone", entity_type: "profiles" }
    expect(
      result({
        ...phone,
        changes: [
          { key: "phone_e164", before: "<changed>", after: "<changed>" },
        ],
      })
    ).toBe("מספר הטלפון עודכן")
    expect(result({ ...phone, changes: created({ result: "taken" }) })).toBe(
      "מספר הטלפון לא עודכן: הוא כבר שייך לחשבון אחר"
    )
    expect(
      result({ action: "admin_finish_email_change", entity_type: "profiles" })
    ).toBe("המייל עודכן")
    expect(
      result({
        action: "admin_export_customers",
        entity_type: "profiles",
        changes: created({ row_count: 21 }),
      })
    ).toBe("יוצאו 21 לקוחות")
    expect(
      result({
        action: "set_photo_consent",
        entity_type: "profiles",
        changes: [{ key: "photo_consent", before: false, after: true }],
      })
    ).toBe("אישרה")
    expect(
      result({
        action: "set_personal_photo_consent",
        entity_type: "profiles",
        changes: [
          { key: "personal_photo_consent", before: true, after: false },
        ],
      })
    ).toBe("ביטלה את האישור")
  })

  it("concepts and entitlement corrections (story 3.13)", () => {
    const archive = {
      action: "admin_set_concept_archived",
      entity_type: "concepts",
    }
    expect(
      result({
        ...archive,
        changes: [
          {
            key: "archived_at",
            before: null,
            after: "2026-10-10T13:08:11+00:00",
          },
        ],
      })
    ).toBe("הועבר לארכיון")
    expect(
      result({
        ...archive,
        changes: [
          {
            key: "archived_at",
            before: "2026-10-10T13:08:11+00:00",
            after: null,
          },
        ],
      })
    ).toBe("הוחזר מהארכיון")
    const units = (n: number) =>
      result({
        action: "admin_correct_entitlement",
        entity_type: "entitlement_movements",
        changes: created({ units: n }),
      })
    expect(units(2)).toBe("נוספו 2 כניסות")
    expect(units(-1)).toBe("הופחתה כניסה אחת")
    expect(auditRuleOf("admin_correct_entitlement", "entitlements")?.edit).toBe(
      true
    )
    expect(
      result({
        action: "admin_settle_parked_purchase",
        entity_type: "cancellation_credits",
      })
    ).toBe("התקבל זיכוי, והלקוחה תבחר בין זיכוי להחזר")
    // Story 3.14: the system extended a card by a week.
    expect(
      result({
        action: "job_auto_extend",
        actor_kind: "system",
        entity_type: "entitlements",
        changes: [
          { key: "expires_on", before: "2099-03-01", after: "2099-03-08" },
        ],
      })
    ).toBe("הכרטיסייה הוארכה בשבוע, כי לא היה בראנץ׳ מתאים")
    expect(actions.job_auto_extend).toBe("הארכה אוטומטית")
    expect(shownPairs()).toContain("job_auto_extend/entitlements")
    // Story 3.16.
    expect(
      result({
        action: "admin_change_credit_options",
        entity_type: "cancellation_credits",
      })
    ).toBe("החלופות לזיכוי עודכנו")
    expect(
      result({
        action: "admin_refund_credit",
        entity_type: "cancellation_credits",
        related: [
          rel("refund_requests", created({ amount_agorot: 18000 }), null),
        ],
      })
    ).toBe("הזיכוי הוחלף בבקשת החזר של 180 ₪")
    expect(
      result({
        action: "admin_refund_credit",
        entity_type: "cancellation_credits",
      })
    ).toBeNull()
  })

  it("the waitlist: joined or quit (story 5.6)", () => {
    expect(
      result({ action: "join_waitlist", entity_type: "waitlist_entries" })
    ).toBe("נוספה לרשימת ההמתנה")
    expect(
      result({ action: "leave_waitlist", entity_type: "waitlist_entries" })
    ).toBe("יצאה מרשימת ההמתנה")
    expect(actions.join_waitlist).toBe("הצטרפות לרשימת המתנה")
    expect(actions.leave_waitlist).toBe("יציאה מרשימת המתנה")
  })

  it("a shown action without a result sentence shows its name only", () => {
    expect(
      result({ action: "admin_create_event", entity_type: "events" })
    ).toBeNull()
    expect(auditRuleOf("admin_create_event", "events")?.edit).toBeFalsy()
    expect(auditRuleOf("admin_create_event", "bookings")).toBeNull()
    expect(auditRuleOf("toString", "events")).toBeNull()
  })
})
