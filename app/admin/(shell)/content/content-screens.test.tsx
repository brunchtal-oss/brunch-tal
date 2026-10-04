import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { ContentEditor, type EditorField } from "./content-editor"
import { PreviewBar } from "./home/preview/preview-bar"

vi.mock("./actions", () => ({
  saveContentDraftAction: vi.fn(),
  publishContentAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/content/home",
}))

const copy = adminCopy.content
const KEY = "22222222-2222-4222-8222-222222222222"
const FIELDS: readonly EditorField[] = [
  { name: "title", label: copy.hero.title, maxLength: 80 },
]

function editor(
  values: Partial<React.ComponentProps<typeof ContentEditor>> = {}
) {
  return renderToStaticMarkup(
    <ContentEditor
      slug="home"
      kind="hero"
      fields={FIELDS}
      initial={{ title: "t" }}
      hasPending={false}
      publishKey={KEY}
      previewHref="/admin/content/home/preview"
      draftInvalid={false}
      {...values}
    />
  )
}

describe("ContentEditor", () => {
  it("shows publish only when there is something to publish", () => {
    expect(editor()).not.toContain(`>${copy.publish}<`)
    expect(editor({ hasPending: true })).toContain(`>${copy.publish}<`)
    expect(editor()).toContain(copy.saveDraft)
  })

  it("warns about an invalid saved draft", () => {
    expect(editor()).not.toContain(copy.draftInvalid)
    expect(editor({ draftInvalid: true })).toContain(copy.draftInvalid)
  })

  it("has a preview button only with a preview page", () => {
    expect(editor()).toContain(copy.preview)
    expect(editor({ previewHref: undefined })).not.toContain(copy.preview)
  })
})

describe("PreviewBar", () => {
  it("says the draft is not published and offers to publish it", () => {
    const html = renderToStaticMarkup(
      <PreviewBar hasPending publishKey={KEY} />
    )
    expect(html).toContain(copy.previewBar)
    expect(html).toContain(copy.backToEdit)
    expect(html).toContain(`>${copy.publish}<`)
  })

  it("shows the site as it is, without publish, when nothing is pending", () => {
    const html = renderToStaticMarkup(
      <PreviewBar hasPending={false} publishKey={KEY} />
    )
    expect(html).toContain(copy.previewNoChanges)
    expect(html).not.toContain(copy.previewBar)
    expect(html).not.toContain(`>${copy.publish}<`)
  })
})
