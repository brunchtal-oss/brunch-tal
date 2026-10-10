import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { toAuditItem, type AuditFilters, type AuditRow } from "./audit-data"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("@/lib/rpc", () => ({ callRpc: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const { AuditList, EmptyAudit } = await import("./audit-list")
const { AuditFilterPanel, AuditFiltersBar } = await import("./audit-filters")

const copy = adminCopy.audit
const TODAY = "2026-10-10"
const FILTERS: AuditFilters = {
  eventId: null,
  customerId: null,
  from: "2026-09-10",
  to: TODAY,
}

function row(id: string, extra: Partial<AuditRow> = {}): AuditRow {
  return {
    id,
    created_at: "2026-10-10T09:15:00+00:00",
    actor_kind: "admin",
    action: "admin_update_event",
    entity_type: "events",
    customer: null,
    event: { id: "e1", title: "בראנץ׳ סתיו", local_date: "2026-10-12" },
    changes: [{ key: "capacity_adults", before: 12, after: 14 }],
    reason: null,
    ...extra,
  }
}

function render(rows: AuditRow[], hasMore = false) {
  const items = rows.map(toAuditItem)
  return renderToStaticMarkup(
    <AuditList
      filters={FILTERS}
      initial={{
        items,
        next: hasMore ? { createdAt: rows.at(-1)!.created_at, id: "x" } : null,
      }}
    />
  )
}

describe("the audit log's screen (story 4.5)", () => {
  it("a capacity change: who, when, the session, old ← new and the reason", () => {
    const html = render([row("a", { reason: "ביקוש גבוה" })])
    expect(html).toContain("טל")
    expect(html).toContain("10.10.26 · 12:15")
    expect(html).toContain("בראנץ׳ סתיו · 12.10.26")
    expect(html).toContain("מכסה: 12 ← 14")
    expect(html).toContain(copy.reason("ביקוש גבוה"))
    // A table for the desktop, with headers.
    expect(html).toContain("<table")
    expect(html).toContain(`scope="col"`)
  })

  it("an add shows only the new value, a delete only the old one", () => {
    const html = render([
      row("a", {
        action: "admin_add_note",
        changes: [{ key: "body", before: null, after: "להזמין פרחים" }],
      }),
      row("b", {
        action: "admin_delete_note",
        changes: [{ key: "body", before: "ישן", after: null }],
      }),
    ])
    expect(html).toContain("תוכן: להזמין פרחים")
    expect(html).not.toContain("— ← להזמין פרחים")
    expect(html).toMatch(/תוכן: <s[^>]*>ישן<\/s>/)
    expect(html).not.toContain("ישן ← —")
  })

  it("a masked value shows השתנה, never <changed>", () => {
    const html = render([
      row("a", {
        actor_kind: "customer",
        action: "join_complete",
        customer: { id: "c1", name: null },
        changes: [
          { key: "full_name", before: "<changed>", after: "<changed>" },
        ],
      }),
    ])
    expect(html).toContain("שם מלא: השתנה ← השתנה")
    expect(html).not.toContain("&lt;changed&gt;")
    expect(html).toContain(copy.anonymous)
    expect(html).toContain("הלקוחה")
  })

  it("empty: the sentence and one action, ניקוי סינון", () => {
    const html = renderToStaticMarkup(<EmptyAudit />)
    expect(html).toContain(copy.empty)
    expect(html.split(copy.clearFilters)).toHaveLength(2)
    expect(html).toContain('href="/admin/audit"')
  })

  it("טעינת עוד only when there is a next page", () => {
    expect(render([row("a")], true)).toContain(copy.loadMore)
    expect(render([row("a")], false)).not.toContain(copy.loadMore)
  })

  it("the filters: the session select, the customer search, the dates and ניקוי סינון", () => {
    const html = renderToStaticMarkup(
      <AuditFiltersBar
        filters={FILTERS}
        today={TODAY}
        sessions={[{ id: "e1", label: "בראנץ׳ סתיו · 12.10.26" }]}
        customerName={null}
        dateError={null}
      />
    )
    expect(html).toContain(copy.allSessions)
    expect(html).toContain("בראנץ׳ סתיו · 12.10.26")
    expect(html).toContain(copy.customerSearch)
    expect(html).toContain('value="2026-09-10"')
    expect(html).toContain(copy.clearFilters)
  })

  it("a chosen customer: her name and ניקוי; a reversed range: the error", () => {
    const html = renderToStaticMarkup(
      <AuditFiltersBar
        filters={{ ...FILTERS, customerId: "c1" }}
        today={TODAY}
        sessions={[]}
        customerName="נועה"
        dateError="to"
      />
    )
    expect(html).toContain("נועה")
    expect(html).toContain(copy.clearCustomer)
    expect(html).not.toContain(copy.customerSearch)
    expect(html).toContain(copy.rangeTo)
    expect(html).toContain('aria-invalid="true"')
  })
})

describe("the filters behind סינון (phone check, 2026-10-10)", () => {
  const EVENT = "11111111-1111-4111-8111-111111111111"
  const CUSTOMER = "22222222-2222-4222-8222-222222222222"

  function panel(
    filters = FILTERS,
    dateError: "from" | "to" | null = null,
    customerName: string | null = null
  ) {
    return renderToStaticMarkup(
      <AuditFilterPanel
        href="/admin/audit"
        filters={filters}
        today={TODAY}
        sessions={[{ id: EVENT, label: "בראנץ׳ סתיו · 12.10.26" }]}
        customerName={customerName}
        dateError={dateError}
      />
    )
  }

  it("no filters: a closed סינון button, the panel hidden on the phone only, no summary", () => {
    const html = panel()
    expect(html).toContain(">סינון</button>")
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('class="hidden md:block"')
    expect(html).not.toContain("מסונן:")
  })

  it("filters on: the count on the button and one summary line with ניקוי סינון", () => {
    const html = panel(
      { ...FILTERS, eventId: EVENT, customerId: CUSTOMER },
      null,
      "נועה"
    )
    expect(html).toContain(copy.filterButton(2))
    expect(html).toContain(copy.summary("בראנץ׳ סתיו · 12.10.26 · נועה"))
    // In the summary and inside the panel.
    expect(html.split(copy.clearFilters).length).toBeGreaterThanOrEqual(3)
  })

  it("a date error keeps the panel open and shows the error", () => {
    const html = panel({ ...FILTERS, from: "2026-10-12" }, "to")
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('class="block"')
    expect(html).toContain(copy.rangeTo)
    expect(html).not.toContain("מסונן:")
  })

  it("the page keys the filter bar and the list apart (a shared key stacked filter bars)", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./page.tsx", import.meta.url)),
      "utf8"
    )
    expect(source).not.toMatch(/key=\{href\}/)
    expect(source).toContain("auditKeys(href).list")
  })
})
