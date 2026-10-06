import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { ValueChangeRow } from "@/components/admin/value-change-row"

import {
  BUSINESS_DETAILS_HREF,
  scopeOf,
  SettingsEditor,
  TEMPLATES_HREF,
  TERMS_HREF,
} from "./settings-editor"
import type { SettingsRow } from "./settings-draft"
import {
  TemplateEditor,
  templateProblem,
  type TemplateRow,
} from "./templates/[type]/template-editor"

vi.mock("./actions", () => ({ updateSettingsAction: vi.fn() }))
vi.mock("./templates/actions", () => ({ updateTemplateAction: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/settings",
}))

const copy = adminCopy.settings

const ROW: SettingsRow = {
  version: 3,
  default_validity_days: 49,
  registration_close_days_before: 1,
  registration_close_local_time: "20:00",
  default_capacity_regular: 12,
  default_capacity_couple: 14,
  cancel_window_hours: 48,
  credit_options_count: 2,
  reminder_lead_hours: 24,
  admin_expiring_days: 21,
  customer_expiring_days: 10,
  last_places_threshold: 4,
  default_prep_days: [-1, 0],
  inactivity_months: 3,
  duplicate_payment_window_days: 7,
  default_session_start_time: "10:30",
  default_session_end_time: "14:30",
}

describe("SettingsEditor", () => {
  it("shows the groups in order, every field, and the two links", () => {
    const html = renderToStaticMarkup(<SettingsEditor row={ROW} />)
    const groups = [
      copy.groups.business,
      copy.groups.registration,
      copy.groups.newSession,
      copy.groups.newProduct,
      copy.groups.creditReminder,
      copy.groups.alerts,
      copy.groups.workSheet,
      copy.groups.templates,
    ]
    const positions = groups.map((title) => html.indexOf(title))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    for (const label of Object.values(copy.fields)) {
      expect(html, label).toContain(label.replace(/"/g, "&quot;"))
    }
    expect(html).toContain(`href="${BUSINESS_DETAILS_HREF}"`)
    expect(html).toContain(`href="${TEMPLATES_HREF}"`)
  })

  it("shows the saved values in the fields and no change box yet", () => {
    const html = renderToStaticMarkup(<SettingsEditor row={ROW} />)
    expect(html).toContain('value="48"')
    expect(html).toContain('value="20:00"')
    expect(html).toContain('value="10:30"')
    expect(html).not.toContain(adminCopy.valueChange.save)
    expect(html).not.toContain(`href="${TERMS_HREF}"`)
    // The two default prep days are pressed.
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2)
    // The link-validity rule (48 hours) is not a setting here.
    expect(html).not.toContain("קישור")
  })
})

describe("scope notes", () => {
  // A row with a change: the box shows the note under "old ← new".
  const changed = (field: Parameters<typeof scopeOf>[0]) =>
    renderToStaticMarkup(
      <ValueChangeRow
        label={copy.labels[field]}
        oldValue="1"
        newValue="2"
        scope={scopeOf(field)}
        onSave={async () => ({ ok: true })}
        onCancel={() => {}}
      >
        <span />
      </ValueChangeRow>
    )

  it("the cancel window: new bookings only, the policy note and the terms link", () => {
    const html = changed("cancelWindow")
    expect(html).toContain(copy.scope.bookings)
    expect(html).toContain(copy.cancelPolicy)
    expect(html).toContain(copy.termsLink)
    expect(html).toContain(`href="${TERMS_HREF}"`)
    expect(TERMS_HREF).toBe("/admin/content/terms")
  })

  it("the reminder: new bookings only; credit options: new credits only; others: from now on", () => {
    expect(changed("reminder")).toContain(copy.scope.bookings)
    expect(changed("reminder")).not.toContain(copy.cancelPolicy)
    expect(changed("creditOptions")).toContain(copy.scope.credits)
    expect(changed("capacityRegular")).toContain(copy.scope.new)
  })
})

const CONFIRMED: TemplateRow = {
  type: "booking_confirmed",
  recipient_kind: "customer",
  push: false,
  body_mode: "template",
  title: "ההרשמה אושרה",
  body: "{date} · {time} · בראנץ׳ {concept}",
  allowed_vars: ["date", "time", "concept"],
  version: 1,
}

describe("TemplateEditor", () => {
  it("shows the fields as chips, the title, the body and the preview with samples", () => {
    const html = renderToStaticMarkup(<TemplateEditor row={CONFIRMED} />)
    for (const text of [
      copy.templates.fieldNames.date,
      copy.templates.fieldNames.time,
      copy.templates.fieldNames.concept,
      copy.templates.fields.title,
      copy.templates.fields.body,
      copy.templates.preview,
      copy.templates.recipient.customer,
    ]) {
      expect(html, text).toContain(text)
    }
    expect(html).toContain(
      `${copy.templates.samples.date} · ${copy.templates.samples.time} · בראנץ׳ ${copy.templates.samples.concept}`
    )
    expect(html).not.toContain(adminCopy.valueChange.save)
  })

  it("an override type: the title only, with the note", () => {
    const html = renderToStaticMarkup(
      <TemplateEditor
        row={{
          ...CONFIRMED,
          type: "broadcast",
          body_mode: "override",
          body: null,
          allowed_vars: [],
          push: true,
        }}
      />
    )
    expect(html).toContain(copy.templates.overrideNote)
    expect(html).toContain(copy.templates.noFields)
    expect(html).not.toContain('id="template-body"')
  })
})

describe("templateProblem", () => {
  it("hints a field the type does not pass and unbalanced braces", () => {
    expect(templateProblem("body", "בתוקף עד {expires_on}", ["date"])).toBe(
      copy.templates.unknownField("expires_on")
    )
    expect(templateProblem("title", "נתראה {date", ["date"])).toBe(
      copy.templates.unbalanced
    )
    expect(templateProblem("title", "x".repeat(201), [])).toBe(
      copy.templates.tooLong(200)
    )
    expect(templateProblem("title", "   ", [])).not.toBeNull()
    expect(templateProblem("body", "נתראה ב{date}", ["date"])).toBeNull()
  })

  it("counts code points like the RPC: 200 emoji fit a title", () => {
    expect(templateProblem("title", "\u{1F37C}".repeat(200), [])).toBeNull()
    expect(templateProblem("title", "\u{1F37C}".repeat(201), [])).toBe(
      copy.templates.tooLong(200)
    )
  })
})

describe("TemplateEditor notes", () => {
  it("shows the card-tip note only on purchase_new_card", () => {
    const card = renderToStaticMarkup(
      <TemplateEditor
        row={{
          ...CONFIRMED,
          type: "purchase_new_card",
          push: true,
          title: "הכרטיסייה שלך מוכנה.",
          body: "מומלץ להירשם מראש",
          allowed_vars: [],
        }}
      />
    )
    expect(card).toContain(copy.templates.cardTipNote)
    expect(
      renderToStaticMarkup(<TemplateEditor row={CONFIRMED} />)
    ).not.toContain(copy.templates.cardTipNote)
  })
})
