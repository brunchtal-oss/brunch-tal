import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { Note, NoteTopic } from "./notes-data"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("@/lib/rpc", () => ({ callRpc: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const { NotesView } = await import("./notes-view")

const copy = adminCopy.notes
const T1 = "11111111-1111-4111-8111-111111111111"
const T2 = "22222222-2222-4222-8222-222222222222"
const TOPICS: NoteTopic[] = [
  { id: T1, name: "ספקים" },
  { id: T2, name: "רעיונות" },
]

function note(id: string, body: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    body,
    pinned: false,
    done: false,
    archived: false,
    sortOrder: 0,
    ...extra,
  }
}

function render(notes: Note[], showArchive = false, topics = TOPICS) {
  return renderToStaticMarkup(
    <NotesView
      topics={topics}
      topic={topics[0] ?? null}
      notes={notes}
      showArchive={showArchive}
    />
  )
}

describe("the notes tab's screen (story 4.11)", () => {
  it("no topics: the empty-state and its one action", () => {
    const html = render([], false, [])
    expect(html).toContain(copy.emptyTopics)
    expect(html.split(copy.addTopic)).toHaveLength(2)
    expect(html).not.toContain(copy.addNote)
  })

  it("a topic without notes: the switcher with the current topic, the empty-state and + פתק", () => {
    const html = render([])
    expect(html).toContain(`aria-label="${copy.topicsNav}"`)
    expect(html).toMatch(
      new RegExp(`aria-current="page"[^>]*href="/admin/notes\\?topic=${T1}"`)
    )
    expect(html).toContain(`href="/admin/notes?topic=${T2}"`)
    expect(html).toContain(copy.emptyNotes)
    expect(html.split(copy.addNote)).toHaveLength(2)
    expect(html).toContain(copy.addTopic)
    expect(html).toContain(copy.showArchive)
  })

  it("a done note: a real checkbox, checked, and the text struck through", () => {
    const html = render([
      note("a", "ספק פרחים", { done: true }),
      note("b", "קייטרינג"),
    ])
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="true"/)
    expect(html).toMatch(/line-through[^>]*><bdi>ספק פרחים/)
    expect(html).not.toMatch(/line-through[^>]*><bdi>קייטרינג/)
    expect(html).not.toContain(copy.emptyNotes)
    // The text is not the checkbox's label (a tap on it does not toggle
    // "בוצע"); the checkbox is named by "בוצע" and the text.
    expect(html).not.toContain("<label")
    const named = html.match(/aria-labelledby="([^"]+) ([^"]+)"/)
    expect(named).not.toBeNull()
    expect(html).toMatch(new RegExp(`id="${named?.[1]}"[^>]*>${copy.done}<`))
    expect(html).toMatch(
      new RegExp(`<p id="${named?.[2]}"[^>]*line-through[^>]*><bdi>ספק פרחים`)
    )
  })

  it("a pinned note is marked; archived notes appear only with the archive shown, with החזרה", () => {
    const notes = [
      note("p", "נעוץ למעלה", { pinned: true }),
      note("x", "ישן בארכיון", { archived: true }),
    ]
    const hidden = render(notes)
    expect(hidden).toContain("data-pinned")
    expect(hidden).toContain(copy.pinned)
    expect(hidden).not.toContain("ישן בארכיון")
    expect(hidden).toContain(`href="/admin/notes?topic=${T1}&amp;archive=1"`)

    const shown = render(notes, true)
    expect(shown).toContain("ישן בארכיון")
    expect(shown).toContain(copy.restore)
    expect(shown).toContain(copy.hideArchive)
    expect(shown).toContain(`href="/admin/notes?topic=${T1}"`)
  })

  it("only archived notes: the topic shows its empty-state", () => {
    const html = render([note("x", "בארכיון", { archived: true })])
    expect(html).toContain(copy.emptyNotes)
    expect(html).not.toContain("בארכיון<")
  })
})
