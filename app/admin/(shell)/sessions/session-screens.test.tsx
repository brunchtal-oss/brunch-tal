import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { SessionEditor } from "./[id]/edit/session-editor"
import { SessionCreateForm } from "./new/session-create-form"
import type { ConceptOption, SessionRow } from "./session-draft"
import { SessionsList } from "./sessions-list"

vi.mock("./actions", () => ({
  createEventAction: vi.fn(),
  updateEventAction: vi.fn(),
  publishEventAction: vi.fn(),
  duplicateEventAction: vi.fn(),
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
  it("shows the title, the chip and the places; a row opens the editor", () => {
    const html = renderToStaticMarkup(
      <SessionsList rows={[ROW, { ...ROW, id: "x", status: "published" }]} />
    )
    expect(html).toContain(copy.sessionTitle("Grandma"))
    expect(html).toContain(copy.status.draft)
    expect(html).toContain(copy.status.published)
    expect(html).toContain(copy.places(14))
    expect(html).toContain(`/admin/sessions/${ROW.id}/edit`)
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
      copy.kinds.regular,
      copy.kinds.couple,
      copy.fields.description,
      copy.fields.capacity,
      copy.fields.price,
      copy.fromConcept,
      copy.fromSettings,
      copy.priceEmpty,
      copy.create.submit,
    ]) {
      expect(html, text).toContain(text)
    }
    expect(html).toContain('value="14"')
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
