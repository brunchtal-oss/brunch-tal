import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { SessionEditor } from "./[id]/edit/session-editor"
import { SessionCreateForm } from "./new/session-create-form"
import type { ConceptOption, SessionRow } from "./session-draft"
import { SessionField } from "./session-fields"
import { SessionsList } from "./sessions-list"

vi.mock("./actions", () => ({
  createEventAction: vi.fn(),
  updateEventAction: vi.fn(),
  publishEventAction: vi.fn(),
  duplicateEventAction: vi.fn(),
  setSessionImageAction: vi.fn(),
  createSessionMediaAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/sessions/x",
}))

const copy = adminCopy.sessions

const CONCEPTS: ConceptOption[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Grandma",
    description: null,
    default_kind: "couple",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Greek",
    description: null,
    default_kind: "regular",
  },
]

const ROW: SessionRow = {
  id: "33333333-3333-4333-8333-333333333333",
  concept_name: "Grandma",
  kind: "couple",
  description: null,
  starts_at: "2026-12-15T08:00:00+00:00",
  ends_at: "2026-12-15T10:00:00+00:00",
  capacity_adults: 14,
  registration_closes_at: "2026-12-14T18:00:00+00:00",
  registration_close_overridden: false,
  status: "draft",
  display_price_agorot: null,
}

describe("SessionsList", () => {
  it("shows the title, the chip and the places; a row opens its details (story 3.4)", () => {
    const html = renderToStaticMarkup(
      <SessionsList rows={[ROW, { ...ROW, id: "x", status: "published" }]} />
    )
    expect(html).toContain(copy.sessionTitle("Grandma"))
    expect(html).toContain(copy.status.draft)
    expect(html).toContain(copy.status.published)
    expect(html).toContain(copy.places(14))
    expect(html).toContain(`href="/admin/sessions/${ROW.id}"`)
    expect(html).not.toContain(`/admin/sessions/${ROW.id}/edit`)
  })

  it("an empty list points at a new session", () => {
    expect(renderToStaticMarkup(<SessionsList rows={[]} />)).toContain(
      copy.empty.slice(0, 10)
    )
  })
})

describe("SessionCreateForm", () => {
  it("starts with the first concept: couple, 14 from the settings", () => {
    const html = renderToStaticMarkup(
      <SessionCreateForm
        concepts={CONCEPTS}
        capacityDefaults={{ regular: 12, couple: 14 }}
        timeDefaults={{ start: "10:30", end: "14:30" }}
        closeRule={{ daysBefore: 1, time: "20:00" }}
      />
    )
    expect(html.indexOf(copy.fields.concept)).toBeLessThan(
      html.indexOf(copy.fields.date)
    )
    for (const text of [
      "Grandma",
      "Greek",
      copy.fields.startTime,
      copy.fields.endTime,
      copy.fields.description,
      copy.fields.capacity,
      copy.fields.price,
      copy.fromSettings,
      copy.priceEmpty,
      copy.create.submit,
      copy.create.publish,
      copy.create.closes,
      copy.create.closesRule(1, "20:00"),
      copy.create.note,
    ]) {
      expect(html, text).toContain(text)
    }
    expect(html).toContain('value="14"')
    // No kind field: the kind is the concept's (user decision 2026-10-05).
    expect(html).not.toContain(copy.fields.kind)
    // The default hours from the settings; the draft button comes first so
    // Enter never publishes.
    expect(html).toContain('value="10:30"')
    expect(html).toContain('value="14:30"')
    expect(html.indexOf('value="draft"')).toBeLessThan(
      html.indexOf('value="publish"')
    )
  })
})

describe("SessionEditor", () => {
  it("a draft: publish with its note, each field, the close note and duplicate", () => {
    const html = renderToStaticMarkup(<SessionEditor row={ROW} />)
    for (const text of [
      copy.publish,
      copy.publishNote,
      copy.fields.when,
      copy.fields.closes,
      copy.closesByRule,
      copy.duplicate,
    ]) {
      expect(html, text).toContain(text)
    }
    expect(html).toContain('value="14"')
    expect(html).toContain('value="2026-12-14T20:00"')
    expect(html).not.toContain(adminCopy.valueChange.save)
  })

  it("a published session has no publish button; a close set by hand has no rule note", () => {
    const html = renderToStaticMarkup(
      <SessionEditor
        row={{
          ...ROW,
          status: "published",
          registration_close_overridden: true,
        }}
      />
    )
    expect(html).not.toContain(copy.publish)
    expect(html).not.toContain(copy.closesByRule)
  })
})

describe("SessionField", () => {
  it("shows a field-specific error text instead of the general one", () => {
    const html = renderToStaticMarkup(
      <SessionField
        id="closes"
        label={copy.create.closes}
        type="datetime-local"
        value="2026-12-15T10:30"
        onChange={() => {}}
        problem="invalid"
        message={copy.create.closesAfterStart}
      />
    )
    expect(html).toContain(copy.create.closesAfterStart)
    expect(html).toContain('aria-invalid="true"')
  })
})
