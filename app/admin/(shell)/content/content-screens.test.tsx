import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { ContentEditor, ItemList } from "./content-editor"
import { ContentRow } from "./content-row"
import { PreviewBar } from "./preview-bar"
import { sectionSpec, type EditorState, type ListField } from "./section-fields"

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

const HERO: EditorState = {
  text: { title: "t", description: "" },
  items: [],
  hidden: false,
}

function editor(
  values: Partial<React.ComponentProps<typeof ContentEditor>> = {}
) {
  return renderToStaticMarkup(
    <ContentEditor
      slug="home"
      sectionKey="hero"
      kind="hero"
      initial={HERO}
      hasPending={false}
      publishKey={KEY}
      previewHref="/admin/content/home/preview?section=hero"
      draftInvalid={false}
      {...values}
    />
  )
}

const TESTIMONIALS: EditorState = {
  text: { title: "" },
  items: [
    { id: "i0", hidden: false, values: { name: "Noa", text: "great" } },
    { id: "i1", hidden: true, values: { name: "Dana", text: "lovely" } },
  ],
  hidden: false,
}

function testimonials(state: EditorState = TESTIMONIALS) {
  return editor({
    slug: "gallery",
    sectionKey: "testimonials",
    kind: "testimonials",
    initial: state,
  })
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

  it("edits the hero's title and description, not the button label", () => {
    const html = editor()
    expect(html).toContain('id="field-title"')
    expect(html).toContain('id="field-description"')
    expect(html).not.toContain("cta_label")
    // The hero cannot be hidden.
    expect(html).not.toContain(copy.hideSection)
  })

  it("lists the testimonials with their actions", () => {
    const html = testimonials()
    expect(html).toContain("Noa")
    expect(html).toContain('id="field-items-0-name"')
    expect(html).toContain('id="field-items-1-text"')
    expect(html).toContain(`aria-label="${copy.item.moveUp("Noa")}"`)
    expect(html).toContain(`aria-label="${copy.item.moveDown("Dana")}"`)
    expect(html).toContain(copy.testimonials.add)
    expect(html).toContain(copy.item.remove)
    expect(html).toContain('aria-live="polite"')
  })

  it("disables moving past the ends of the list", () => {
    const html = testimonials()
    expect(html).toMatch(
      new RegExp(`aria-label="${copy.item.moveUp("Noa")}" aria-disabled="true"`)
    )
    expect(html).toMatch(
      new RegExp(
        `aria-label="${copy.item.moveDown("Dana")}" aria-disabled="true"`
      )
    )
    expect(html).not.toMatch(
      new RegExp(
        `aria-label="${copy.item.moveDown("Noa")}" aria-disabled="true"`
      )
    )
  })

  it("marks a hidden item and offers to show it", () => {
    const html = testimonials()
    expect(html).toContain(copy.status.hidden)
    expect(html).toContain(copy.hiddenItemHint)
    expect(html).toContain(`>${copy.item.show}<`)
    expect(html).toContain(`>${copy.item.hide}<`)
  })

  it("names an item without a name by its place", () => {
    const html = testimonials({
      ...TESTIMONIALS,
      items: [{ id: "i0", hidden: false, values: { name: "", text: "" } }],
    })
    expect(html).toContain(copy.testimonials.item(1))
  })

  it("says an empty list is not shown", () => {
    expect(testimonials({ ...TESTIMONIALS, items: [] })).toContain(
      copy.emptyList
    )
  })

  it("hides and shows a section", () => {
    expect(testimonials()).toContain(copy.hideSection)
    const hidden = testimonials({ ...TESTIMONIALS, hidden: true })
    expect(hidden).toContain(copy.showSection)
    expect(hidden).toContain(copy.sectionHiddenNotice)
  })
})

describe("undo", () => {
  it("offers to undo unsaved changes only once there are some", () => {
    expect(editor()).not.toContain(copy.undo.revert)
    expect(editor({ hasPending: true })).not.toContain(copy.undo.revert)
  })

  it("offers to go back to the site only with a saved pending draft", () => {
    expect(editor()).not.toContain(copy.undo.discard)
    const html = editor({ hasPending: true })
    expect(html).toContain(`>${copy.undo.discard}<`)
    // The confirm opens only on a click.
    expect(html).not.toContain(copy.undo.discardQuestion)
  })
})

describe("ItemList delete confirm", () => {
  const list = sectionSpec({
    slug: "gallery",
    key: "testimonials",
    kind: "testimonials",
  }).fields.find((f) => f.type === "list") as ListField

  function items(confirmingId: string | null) {
    return renderToStaticMarkup(
      <ItemList
        field={list}
        items={TESTIMONIALS.items}
        errors={null}
        onChange={() => {}}
        onAdd={() => {}}
        onMove={() => {}}
        onToggleHidden={() => {}}
        confirmingId={confirmingId}
        onAskRemove={() => {}}
        onCancelRemove={() => {}}
        onRemove={() => {}}
      />
    )
  }

  it("asks in the row before deleting, in that row only", () => {
    const html = items("i1")
    expect(html).toContain(copy.item.confirmRemove("Dana"))
    expect(html).not.toContain(copy.item.confirmRemove("Noa"))
    expect(html).toContain(`>${copy.item.cancel}<`)
    expect(html).toContain('id="confirm-i1-q"')
    // Dana's row shows the confirm instead of its actions.
    expect(html).not.toContain('id="remove-i1"')
    expect(html).toContain('id="remove-i0"')
  })

  it("shows no confirm until a delete is asked", () => {
    const html = items(null)
    expect(html).not.toContain(copy.item.confirmRemove("Noa"))
    expect(html).toContain('id="remove-i0"')
    expect(html).toContain('id="remove-i1"')
  })
})

describe("ContentRow", () => {
  it("is one link with its chips", () => {
    const html = renderToStaticMarkup(
      <ul>
        <ContentRow
          href="/admin/content/home/main"
          title="About"
          detail="d"
          chips={["published", "hidden"]}
        />
      </ul>
    )
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('href="/admin/content/home/main"')
    expect(html).toContain(copy.status.published)
    expect(html).toContain(copy.status.hidden)
  })
})

describe("PreviewBar", () => {
  it("says the draft is not published and offers to publish it", () => {
    const html = renderToStaticMarkup(
      <PreviewBar
        backHref="/admin/content/home"
        pending={[{ slug: "home", publishKey: KEY }]}
      />
    )
    expect(html).toContain(copy.previewBar)
    expect(html).toContain(copy.backToEdit)
    expect(html).toContain(`>${copy.publish}<`)
  })

  it("leads back to where it was opened from", () => {
    expect(
      renderToStaticMarkup(
        <PreviewBar
          backHref="/admin/content/gallery/testimonials"
          pending={[]}
        />
      )
    ).toContain('href="/admin/content/gallery/testimonials"')
  })

  it("shows the site as it is, without publish, when nothing is pending", () => {
    const html = renderToStaticMarkup(
      <PreviewBar backHref="/admin/content/home" pending={[]} />
    )
    expect(html).toContain(copy.previewNoChanges)
    expect(html).not.toContain(copy.previewBar)
    expect(html).not.toContain(`>${copy.publish}<`)
  })
})
