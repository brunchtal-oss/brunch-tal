import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  actionLabel,
  activeFilterCount,
  actorLabel,
  addDays,
  auditHref,
  auditKeys,
  dateErrorOf,
  fieldLabel,
  filterSummary,
  formatValue,
  isFilterDate,
  isInstant,
  isChangedField,
  isTechnicalKey,
  parseAuditParams,
  toAuditItem,
  toAuditView,
  changedFields,
  toSessionOptions,
  type AuditRow,
} from "./audit-data"

const copy = adminCopy.audit
const TODAY = "2026-10-10"
const EVENT = "11111111-1111-4111-8111-111111111111"
const CUSTOMER = "22222222-2222-4222-8222-222222222222"

function row(extra: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    created_at: "2026-10-10T09:15:00.123456+00:00",
    actor_kind: "admin",
    action: "admin_update_event",
    entity_type: "events",
    customer: null,
    event: { id: EVENT, title: "סתיו", local_date: "2026-10-12" },
    subject: null,
    changes: [{ key: "capacity_adults", before: 12, after: 14 }],
    related: [],
    reason: null,
    ...extra,
  }
}

describe("parseAuditParams", () => {
  it("no dates: the last 30 days to today", () => {
    expect(parseAuditParams({}, TODAY)).toEqual({
      eventId: null,
      customerId: null,
      from: "2026-09-10",
      to: TODAY,
    })
  })

  it("keeps a valid session, customer and dates; ignores anything else", () => {
    expect(
      parseAuditParams(
        {
          event: EVENT,
          customer: CUSTOMER,
          from: "2026-10-01",
          to: "2026-10-05",
        },
        TODAY
      )
    ).toEqual({
      eventId: EVENT,
      customerId: CUSTOMER,
      from: "2026-10-01",
      to: "2026-10-05",
    })
    expect(
      parseAuditParams(
        { event: "x", customer: ["nope"], from: "2026-02-30", to: "soon" },
        TODAY
      )
    ).toEqual({
      eventId: null,
      customerId: null,
      from: "2026-09-10",
      to: TODAY,
    })
  })

  it("only an end: the start is 30 days before it", () => {
    expect(parseAuditParams({ to: "2026-03-15" }, TODAY).from).toBe(
      "2026-02-13"
    )
  })

  it("passes a reversed range on (the RPC refuses it)", () => {
    expect(
      parseAuditParams({ from: "2026-10-12", to: "2026-10-10" }, TODAY)
    ).toMatchObject({ from: "2026-10-12", to: "2026-10-10" })
  })
})

describe("auditHref", () => {
  it("default dates stay out of the URL", () => {
    expect(auditHref(parseAuditParams({}, TODAY), TODAY)).toBe("/admin/audit")
    expect(
      auditHref({ ...parseAuditParams({}, TODAY), eventId: EVENT }, TODAY)
    ).toBe(`/admin/audit?event=${EVENT}`)
  })

  it("other dates and the customer are kept", () => {
    expect(
      auditHref(
        {
          eventId: null,
          customerId: CUSTOMER,
          from: "2026-10-01",
          to: "2026-10-05",
        },
        TODAY
      )
    ).toBe(`/admin/audit?customer=${CUSTOMER}&from=2026-10-01&to=2026-10-05`)
  })

  it("addDays crosses months and years", () => {
    expect(addDays("2026-01-05", -30)).toBe("2025-12-06")
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01")
  })
})

describe("labels", () => {
  it("every known action and field has Hebrew; an unknown one falls back to its code", () => {
    expect(actionLabel("admin_update_event")).toBe("עריכת מפגש")
    expect(actionLabel("book_sessions")).toBe("הרשמה למפגשים")
    expect(actionLabel("something_new")).toBe("something_new")
    expect(actionLabel("toString")).toBe("toString")
    expect(fieldLabel("capacity_adults")).toBe("מכסה")
    expect(fieldLabel("mystery_key")).toBe("mystery_key")
  })

  it("a customers export row (story 4.4) reads in Hebrew", () => {
    expect(actionLabel("admin_export_customers")).toBe("ייצוא לקוחות")
    expect(formatValue("scope", "search")).toBe("תוצאות חיפוש")
    expect(formatValue("columns", ["full_name", "phone", "email"])).toBe(
      "שם · טלפון · מייל"
    )
    expect(fieldLabel("row_count")).toBe("מספר שורות")
  })

  it("who: Tal, the customer or the system (user decision 2026-10-10)", () => {
    expect(actorLabel("admin")).toBe("טל")
    expect(actorLabel("customer")).toBe("הלקוחה")
    expect(actorLabel("system")).toBe("המערכת")
  })
})

describe("formatValue", () => {
  it("masked, booleans, null", () => {
    expect(formatValue("full_name", "<changed>")).toBe(copy.masked)
    expect(formatValue("done", true)).toBe("כן")
    expect(formatValue("done", false)).toBe("לא")
    // Story 3.9: an open refund request in "אישור החזר".
    expect(formatValue("status", "requested", "refund_requests")).toBe("פתוחה")
    expect(formatValue("status", "completed", "refund_requests")).toBe("הוחזר")
    // Other tables keep the shared wording.
    expect(formatValue("status", "completed", "events")).toBe("התקיים")
    expect(formatValue("status", "cancelled", "bookings")).toBe("בוטלה")
    expect(formatValue("status", "refunded", "cancellation_credits")).toBe(
      "הוחזר"
    )
    expect(formatValue("status", "refund_requested")).toBe("ממתין להחזר")
    expect(formatValue("status", "refunded")).toBe("הוחזר")
    expect(formatValue("reason", null)).toBe("—")
  })

  it("agorot in ₪, other numbers as is", () => {
    expect(formatValue("price_agorot", 47200)).toBe("472 ₪")
    expect(formatValue("amount_agorot", 12750)).toBe("127.50 ₪")
    expect(formatValue("capacity_adults", 14)).toBe("14")
  })

  it("timestamps, dates and clock times by lib/time (Jerusalem)", () => {
    expect(formatValue("expires_at", "2026-10-10T21:30:00+00:00")).toBe(
      "11.10.26 · 00:30"
    )
    expect(formatValue("paid_on", "2026-10-05")).toBe("05.10.26")
    expect(formatValue("registration_close_local_time", "18:00:00")).toBe(
      "18:00"
    )
  })

  it("arrays and objects as their values joined with ·, long text cut", () => {
    expect(formatValue("draft_content", { body: "איפה זה מוצג?" })).toBe(
      "איפה זה מוצג?"
    )
    expect(
      formatValue("x", { a: 1, b: [2, "שלוש"], c: true, d: null, e: {} })
    ).toBe("1 · 2 · שלוש")
    expect(formatValue("x", { a: null, b: false, c: [] })).toBe("—")
    expect(formatValue("x", [])).toBe("—")
    expect(formatValue("x", { body: "ב".repeat(300) })).toHaveLength(120)
    const long = formatValue("body", "א".repeat(300))
    expect(long.length).toBe(120)
    expect(long.endsWith("…")).toBe(true)
  })

  it("allowed_weekdays as Hebrew day names", () => {
    expect(formatValue("allowed_weekdays", [0, 2, 6])).toBe("א׳, ג׳, ש׳")
    expect(formatValue("allowed_weekdays", [])).toBe("—")
    // Not a list of days: the readable text.
    expect(formatValue("allowed_weekdays", [9])).toBe("9")
    // Only that key.
    expect(formatValue("other", [0, 2])).toBe("0 · 2")
  })
})

describe("which fields an edit shows (phone check, 2026-10-10)", () => {
  const ID = "55555555-5555-4555-8555-555555555555"

  it("hides technical keys; booked_by stays", () => {
    for (const key of [
      "updated_by",
      "created_by",
      "recorded_by",
      "policy_snapshot",
      "product_snapshot",
      "storage_path",
      "public_path",
      "focus_x",
      "focus_y",
      "identity_attempts",
      "claiming_at",
      "publish_started_at",
      "photo_consent_text_version",
      "privacy_policy_version",
      "waitlist_cycle",
      "revision",
      "version",
      "provider",
      "task_order",
    ]) {
      expect(isTechnicalKey(key), key).toBe(true)
      expect(isChangedField({ key, before: null, after: "x" }), key).toBe(false)
    }
    expect(isTechnicalKey("booked_by")).toBe(false)
    expect(
      isChangedField({ key: "booked_by", before: null, after: "admin" })
    ).toBe(true)
  })

  it("hides a change of ids only, one empty on both sides, an unchanged one and a masked one", () => {
    expect(isChangedField({ key: "x", before: null, after: ID })).toBe(false)
    expect(
      isChangedField({ key: "x", before: ID, after: ID.replace("5", "6") })
    ).toBe(false)
    expect(isChangedField({ key: "x", before: null, after: null })).toBe(false)
    expect(isChangedField({ key: "x", before: "", after: null })).toBe(false)
    expect(isChangedField({ key: "x", before: [1], after: [1] })).toBe(false)
    expect(
      isChangedField({ key: "x", before: "<changed>", after: "<changed>" })
    ).toBe(false)
    expect(isChangedField({ key: "x", before: ID, after: "שם" })).toBe(true)
  })
})

describe("labels seen in the dev database", () => {
  it("the concepts' actions (story 4.8)", () => {
    expect(actionLabel("admin_create_concept")).toBe("יצירת קונספט")
    expect(actionLabel("admin_update_concept")).toBe("עריכת קונספט")
    expect(actionLabel("admin_delete_concept")).toBe("מחיקת קונספט")
    expect(actionLabel("admin_set_concept_archived")).toBe(
      "העברת קונספט לארכיון"
    )
    for (const action of [
      "admin_cancel_event",
      "admin_delete_event",
      "admin_reschedule_event",
      "choose_credit_outcome",
    ]) {
      expect(actionLabel(action), action).not.toBe(action)
    }
    for (const key of [
      "sort_order",
      "created_at",
      "updated_at",
      "input_hash",
      "token_hash",
      "provider_transaction_id",
    ]) {
      expect(isTechnicalKey(key), key).toBe(true)
    }
  })

  it("every key has a Hebrew field name", () => {
    for (const key of [
      "default_kind",
      "theme_key",
      "generic_paper_key",
      "activated_at",
      "alt_text",
      "amount_override_reason",
      "bound_at",
      "cancelled_at",
      "conflict_reason",
      "consumed_at",
      "day_offset",
      "deleted_tasks",
      "eligible_event_kind",
      "expires_on",
      "guest_details",
      "note_count",
      "party_size",
      "payer_label",
      "post_join_button_label",
      "post_join_message",
      "privacy_consent_at",
      "quantity",
      "reference",
      "registration_close_overridden",
      "source",
      "valid_from",
      "validity_days",
      "validity_mode",
      "intro_only",
      "published_content",
      "draft_content",
      "publish_state",
      "published_at",
      "expires_at",
      "refunded_on",
      "completed_at",
      "requested_at",
      "choice_pending",
      "event_kind",
      "monetary_basis_agorot",
      "options_count",
      "origin_starts_at",
      "original_cancelled_at",
    ]) {
      expect(fieldLabel(key), key).not.toBe(key)
    }
    expect(fieldLabel("default_kind")).toBe("סוג ברירת מחדל")
    expect(fieldLabel("theme_key")).toBe("ערכת צבעים")
    expect(fieldLabel("generic_paper_key")).toBe("רקע")
  })

  it("default_kind values in Hebrew; theme and paper keys stay codes", () => {
    expect(formatValue("default_kind", "regular")).toBe("רגיל")
    expect(formatValue("default_kind", "couple")).toBe("זוגי")
    expect(formatValue("theme_key", "generic")).toBe("generic")
    expect(formatValue("generic_paper_key", "olive")).toBe("olive")
  })
})

describe("the filters' state (phone check, 2026-10-10)", () => {
  const DEFAULT = parseAuditParams({}, TODAY)
  const SESSIONS = [{ id: EVENT, label: "בראנץ׳ סתיו · 12.10.26" }]

  it("counts the session, the customer and non-default dates", () => {
    expect(activeFilterCount(DEFAULT, TODAY)).toBe(0)
    expect(
      activeFilterCount(
        { ...DEFAULT, eventId: EVENT, customerId: CUSTOMER },
        TODAY
      )
    ).toBe(2)
    expect(activeFilterCount({ ...DEFAULT, from: "2026-10-01" }, TODAY)).toBe(1)
  })

  it("one summary line, or null when nothing is filtered", () => {
    expect(filterSummary(DEFAULT, TODAY, SESSIONS, null)).toBeNull()
    expect(
      filterSummary(
        {
          eventId: EVENT,
          customerId: CUSTOMER,
          from: "2026-10-01",
          to: "2026-10-05",
        },
        TODAY,
        SESSIONS,
        "נועה"
      )
    ).toBe("מסונן: בראנץ׳ סתיו · 12.10.26 · נועה · 01.10.26 עד 05.10.26")
    expect(
      filterSummary({ ...DEFAULT, customerId: CUSTOMER }, TODAY, SESSIONS, null)
    ).toBe(copy.summary(copy.anonymous))
  })

  it("the filter bar and the list never share a key", () => {
    const keys = auditKeys("/admin/audit")
    expect(keys.filters).not.toBe(keys.list)
  })
})

describe("toAuditItem: one concise item per operation", () => {
  it("an edit: only the changed fields, as {field}: {after} (במקום {before})", () => {
    const item = toAuditItem(
      row({
        reason: "יותר מקום",
        changes: [
          { key: "capacity_adults", before: 12, after: 14 },
          { key: "revision", before: 1, after: 2 },
        ],
      })
    )
    expect(item).toMatchObject({
      when: "10.10.26 · 12:15",
      actor: "טל",
      action: "עריכת מפגש",
      customer: null,
      session: "בראנץ׳ סתיו 12.10",
      subject: null,
      result: null,
      reason: "יותר מקום",
    })
    expect(item.changes).toEqual([
      { key: "capacity_adults", text: "מכסה: 14 (במקום 12)" },
    ])
  })

  it("an added value has no (במקום); unchanged, masked, technical and id fields are dropped", () => {
    expect(
      changedFields(
        row({
          changes: [
            { key: "description", before: null, after: "חדש" },
            { key: "capacity_adults", before: 12, after: 12 },
            { key: "full_name", before: "<changed>", after: "<changed>" },
            { key: "updated_at", before: "a", after: "b" },
            { key: "image_id", before: null, after: EVENT },
            { key: "allowed_weekdays", before: [], after: null },
          ],
        })
      )
    ).toEqual([{ key: "description", text: "תיאור: חדש" }])
  })

  it("a removed value reads as a dash, with what it was", () => {
    expect(
      changedFields(
        row({ changes: [{ key: "description", before: "ישן", after: null }] })
      )
    ).toEqual([{ key: "description", text: "תיאור: — (במקום ישן)" }])
  })

  it("no field list unless the rule is an edit", () => {
    const item = toAuditItem(
      row({
        action: "admin_create_event",
        changes: [
          { key: "capacity_adults", before: null, after: 12 },
          { key: "status", before: null, after: "draft" },
        ],
      })
    )
    expect(item.action).toBe("יצירת מפגש")
    expect(item.result).toBeNull()
    expect(item.changes).toEqual([])
  })

  it("an entitlement's correction: expires_at repeats expires_on; a template's type is its subject", () => {
    expect(
      changedFields(
        row({
          action: "admin_correct_entitlement",
          entity_type: "entitlements",
          event: null,
          changes: [
            { key: "expires_on", before: "2026-11-01", after: "2026-11-15" },
            {
              key: "expires_at",
              before: "2026-10-31T22:00:00+00:00",
              after: "2026-11-14T22:00:00+00:00",
            },
          ],
        })
      ).map((c) => c.text)
    ).toEqual(["בתוקף עד: 15.11.26 (במקום 01.11.26)"])
    const template = toAuditItem(
      row({
        action: "admin_update_notification_template",
        entity_type: "notification_templates",
        event: null,
        subject: "reminder",
        changes: [
          { key: "type", before: null, after: "reminder" },
          { key: "title", before: "ישן", after: "חדש" },
          { key: "version", before: 1, after: 2 },
        ],
      })
    )
    expect(template.subject).toBe("תזכורת לפני מפגש")
    expect(template.changes.map((c) => c.text)).toEqual([
      "כותרת: חדש (במקום ישן)",
    ])
  })

  it("subjects: a product's or concept's name, a content section by its admin names; unknown is none", () => {
    const subject = (entity_type: string, value: string | null) =>
      toAuditItem(row({ entity_type, event: null, subject: value })).subject
    expect(subject("products", "כרטיסייה אישית")).toBe("כרטיסייה אישית")
    expect(subject("concepts", "יווני")).toBe("יווני")
    expect(subject("content_sections", "how-it-works/faq")).toBe(
      "איך זה עובד · שאלות נפוצות"
    )
    expect(subject("content_sections", "about/main")).toBe("אודות")
    expect(subject("content_sections", "nope/none")).toBeNull()
    expect(subject("notification_templates", "nope")).toBeNull()
    expect(subject("events", "x")).toBeNull()
    expect(subject("products", null)).toBeNull()
  })

  it("a deleted session (story 3.17): the session label from before, a short result", () => {
    const deleted = (options: unknown[]) =>
      toAuditItem(
        row({
          action: "admin_delete_event",
          event: null,
          changes: [
            { key: "concept_name", before: "סתיו", after: null },
            {
              key: "starts_at",
              before: "2026-10-12T07:00:00+00:00",
              after: null,
            },
            { key: "capacity_adults", before: 12, after: null },
            { key: "work_tasks_count", before: 5, after: null },
            { key: "credit_options", before: options, after: null },
          ],
        })
      )
    const full = deleted([
      { credit_id: CUSTOMER, state: "active" },
      { credit_id: EVENT, state: "active" },
    ])
    expect(full.action).toBe("מחיקת מפגש")
    expect(full.session).toBe("בראנץ׳ סתיו 12.10")
    expect(full.result).toBe("הוסרו 2 חלופות זיכוי")
    expect(full.changes).toEqual([])
    expect(deleted([]).result).toBeNull()
  })

  it("an anonymized customer", () => {
    expect(
      toAuditItem(row({ customer: { id: CUSTOMER, name: null } })).customer
    ).toBe("לקוחה שפרטיה הוסרו")
  })

  it("the next cursor is the last row's created_at and id, only with has_more", () => {
    const rows = [row(), row({ id: "44444444-4444-4444-8444-444444444444" })]
    expect(toAuditView({ rows, has_more: true }).next).toEqual({
      createdAt: rows[1].created_at,
      id: rows[1].id,
    })
    expect(toAuditView({ rows, has_more: false }).next).toBeNull()
  })
})

describe("review fixes", () => {
  it("an edit drops a field that is empty on both sides (an inserted row's empty columns)", () => {
    const item = toAuditItem(
      row({
        action: "admin_update_product",
        entity_type: "products",
        event: null,
        changes: [
          { key: "note", before: null, after: null },
          { key: "reference", before: undefined, after: null },
          { key: "description", before: "", after: null },
          { key: "price_agorot", before: null, after: 47200 },
        ],
      })
    )
    expect(item.changes.map((c) => c.key)).toEqual(["price_agorot"])
    expect(item.changes[0].text).toBe("מחיר: 472 ₪")
  })

  it("isFilterDate: a real day from the year 2000 only", () => {
    expect(isFilterDate("2026-10-10")).toBe(true)
    expect(isFilterDate("2000-01-01")).toBe(true)
    expect(isFilterDate("0002-10-10")).toBe(false)
    expect(isFilterDate("0202-10-10")).toBe(false)
    expect(isFilterDate("1999-12-31")).toBe(false)
    expect(isFilterDate("2026-02-30")).toBe(false)
    expect(isFilterDate("")).toBe(false)
  })

  it("isInstant: the jsonb form of timestamptz, never a plain date", () => {
    expect(isInstant("2026-10-10T09:15:00.123456+00:00")).toBe(true)
    expect(isInstant("2026-10-10T09:15:00Z")).toBe(true)
    expect(isInstant("2026-10-10")).toBe(false)
    expect(isInstant("2026-10-10T09:15:00")).toBe(false)
    expect(isInstant("2026-10-10T::::+00:00")).toBe(false)
    expect(isInstant(5)).toBe(false)
  })

  it("code values in Hebrew per key; an unknown value or key falls back to the code", () => {
    expect(formatValue("status", "published")).toBe(
      adminCopy.audit.values.status.published
    )
    expect(formatValue("booked_by", "admin")).toBe("טל")
    expect(formatValue("state", "pending")).toBe(
      adminCopy.audit.values.state.pending
    )
    expect(formatValue("kind", "couple")).toBe("זוגי")
    expect(formatValue("status", "mystery")).toBe("mystery")
    expect(formatValue("body", "published")).toBe("published")
    expect(formatValue("status", "toString")).toBe("toString")
    expect(
      changedFields(
        row({
          changes: [{ key: "status", before: "draft", after: "published" }],
        })
      )[0].text
    ).toBe(
      copy.changed(
        "סטטוס",
        adminCopy.audit.valuesByEntity.events.status.published,
        adminCopy.audit.valuesByEntity.events.status.draft
      )
    )
  })

  it("paired keys have distinct field names", () => {
    for (const [a, b] of [
      ["units", "original_units"],
      ["full_name", "name"],
      ["kind", "type"],
      ["prep_days", "default_prep_days"],
    ]) {
      expect(fieldLabel(a)).not.toBe(fieldLabel(b))
    }
  })

  it("dateErrorOf: INVALID_INPUT on to or from; anything else is not a date error", () => {
    expect(
      dateErrorOf({ ok: false, code: "INVALID_INPUT", detail: { field: "to" } })
    ).toBe("to")
    expect(
      dateErrorOf({
        ok: false,
        code: "INVALID_INPUT",
        detail: { field: "from" },
      })
    ).toBe("from")
    expect(
      dateErrorOf({
        ok: false,
        code: "INVALID_INPUT",
        detail: { field: "cursor" },
      })
    ).toBeNull()
    expect(dateErrorOf({ ok: false, code: "INVALID_INPUT" })).toBeNull()
    expect(
      dateErrorOf({ ok: false, code: "SERVER_ERROR", detail: { field: "to" } })
    ).toBeNull()
    expect(dateErrorOf({ ok: true })).toBeNull()
  })

  it("toSessionOptions: the Jerusalem date, a missing concept is empty", () => {
    expect(
      toSessionOptions([
        {
          id: "e1",
          starts_at: "2026-10-11T21:30:00Z",
          concepts: { name: "סתיו" },
        },
        { id: "e2", starts_at: "2026-10-11T21:30:00Z", concepts: null },
      ])
    ).toEqual([
      { id: "e1", label: "סתיו · 12.10.26" },
      { id: "e2", label: " · 12.10.26" },
    ])
  })
})
