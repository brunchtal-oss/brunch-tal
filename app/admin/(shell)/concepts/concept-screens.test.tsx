import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { ConceptEditor } from "./[id]/concept-editor"
import type { ConceptRow } from "./concept-draft"
import { ConceptCreateForm } from "./new/concept-create-form"

vi.mock("./actions", () => ({
  createConceptAction: vi.fn(),
  updateConceptAction: vi.fn(),
  setConceptArchivedAction: vi.fn(),
  deleteConceptAction: vi.fn(),
  createConceptMediaAction: vi.fn(),
  setConceptImageAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/concepts/x",
}))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }))

const copy = adminCopy.concepts

const ROW: ConceptRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "יווני",
  description: "ארוחה יוונית",
  default_kind: "couple",
  archived_at: null,
  image: null,
  image_path: null,
}

describe("ConceptCreateForm", () => {
  it("has the name, description and kind, without the editor's notes", () => {
    const html = renderToStaticMarkup(<ConceptCreateForm />)
    for (const text of [
      copy.fields.name,
      copy.fields.description,
      copy.fields.kind,
      copy.kinds.regular,
      copy.kinds.couple,
      copy.create.submit,
    ]) {
      expect(html, text).toContain(text)
    }
    expect(html).not.toContain(copy.kindNote)
  })
})

describe("ConceptEditor", () => {
  it("shows the saved values, the notes, the image, archive and delete", () => {
    const html = renderToStaticMarkup(<ConceptEditor row={ROW} />)
    for (const text of [
      'value="יווני"',
      "ארוחה יוונית",
      copy.nameNote,
      copy.descriptionNote,
      copy.kindNote,
      copy.save,
      copy.image.label,
      copy.image.hint,
      copy.archive,
      copy.archiveNote,
      copy.delete,
    ]) {
      expect(html, text).toContain(text)
    }
    expect(html).not.toContain(copy.restore)
  })

  it("offers to restore an archived concept", () => {
    const html = renderToStaticMarkup(
      <ConceptEditor row={{ ...ROW, archived_at: "2026-10-10T10:00:00Z" }} />
    )
    expect(html).toContain(copy.restore)
    expect(html).not.toContain(copy.archive)
  })
})
