import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { Note } from "./notes-data"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("@/lib/rpc", () => ({ callRpc: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const { NotesView } = await import("./notes-view")

const copy = adminCopy.notes

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

function render(notes: Note[], showArchive = false) {
  return renderToStaticMarkup(
    <NotesView notes={notes} showArchive={showArchive} />
  )
}

describe("the notes board's screen (story 4.11, fix 13)", () => {
  it("an empty board: the empty-state and its one action", () => {
    const html = render([])
    expect(html).toContain(copy.emptyBoard)
    expect(html.split(copy.addNote)).toHaveLength(2)
    expect(html).toContain(copy.showArchive)
    expect(html).toContain('href="/admin/notes?archive=1"')
  })

  it("only archived notes: the board shows its empty-state", () => {
    const html = render([note("x", "בארכיון", { archived: true })])
    expect(html).toContain(copy.emptyBoard)
    expect(html).not.toContain("בארכיון<")
  })

  it("the first line is the title, the rest the text; a one-line note has no text", () => {
    const html = render([note("a", "ליגל\nענבר"), note("b", "איציק לקינוחים")])
    expect(html).not.toContain(copy.emptyBoard)
    expect(html).toMatch(/text-\[17px\][^>]*><bdi>ליגל<\/bdi>/)
    expect(html).toMatch(/whitespace-pre-line[^>]*><bdi>ענבר<\/bdi>/)
    expect(html).toMatch(/text-\[17px\][^>]*><bdi>איציק לקינוחים<\/bdi>/)
    // One text paragraph only (for "ליגל").
    expect(html.match(/whitespace-pre-line/g)).toHaveLength(1)
    // The board: a grid of 2 columns, 3 from md.
    expect(html).toMatch(/grid-cols-2[^"]*md:grid-cols-3/)
    expect(html.split(copy.addNote)).toHaveLength(2)
  })

  it("a done note: a real checkbox, checked, named by בוצע and the title, and struck through", () => {
    const html = render([
      note("a", "ספק פרחים\nטלפון", { done: true }),
      note("b", "קייטרינג"),
    ])
    expect(html).toMatch(/role="checkbox"[^>]*aria-checked="true"/)
    expect(html).toMatch(/line-through[^>]*><bdi>ספק פרחים/)
    expect(html).toMatch(/line-through[^>]*><bdi>טלפון/)
    expect(html).not.toMatch(/line-through[^>]*><bdi>קייטרינג/)
    // The text is not the checkbox's label (a tap on it does not toggle
    // "בוצע").
    expect(html).not.toContain("<label")
    const named = html.match(/aria-labelledby="([^"]+) ([^"]+)"/)
    expect(named).not.toBeNull()
    expect(html).toMatch(new RegExp(`id="${named?.[1]}"[^>]*>${copy.done}<`))
    expect(html).toMatch(
      new RegExp(`<p id="${named?.[2]}"[^>]*line-through[^>]*><bdi>ספק פרחים`)
    )
  })

  it("a pinned note: muted, with the tape and a pressed pin; an unpinned one has a pin toggle", () => {
    const html = render([
      note("p", "נעוץ למעלה", { pinned: true }),
      note("u", "רגיל"),
    ])
    expect(html).toMatch(/data-pinned="true"[^>]*bg-muted/)
    expect(html.match(/data-tape/g)).toHaveLength(1)
    expect(html).toMatch(
      /aria-hidden="true"[^>]*data-tape|data-tape[^>]*aria-hidden/
    )
    expect(html).toContain(copy.pinned)
    expect(html).toMatch(
      new RegExp(`aria-pressed="true" aria-label="${copy.unpin}"`)
    )
    expect(html).toMatch(
      new RegExp(`aria-pressed="false" aria-label="${copy.pin}"`)
    )
  })

  it("archived notes appear only with the archive shown, with החזרה", () => {
    const notes = [
      note("a", "פעיל"),
      note("x", "ישן בארכיון\nפרט נוסף", { archived: true, done: true }),
    ]
    const hidden = render(notes)
    expect(hidden).not.toContain("ישן בארכיון")
    expect(hidden).toContain('href="/admin/notes?archive=1"')

    const shown = render(notes, true)
    // The first line as the title, the rest under it, struck through when
    // done.
    expect(shown).toMatch(
      /line-through[^>]*><p class="font-semibold"><bdi>ישן בארכיון<\/bdi><\/p><p class="whitespace-pre-line"><bdi>פרט נוסף<\/bdi>/
    )
    expect(shown).toContain(copy.restore)
    expect(shown).toContain(copy.hideArchive)
    expect(shown).toContain('href="/admin/notes"')
  })

  it("has no topic UI", () => {
    const html = render(
      [note("a", "פעיל"), note("x", "ישן", { archived: true })],
      true
    )
    expect(html).not.toContain("נושא")
    expect(html).not.toContain("topic")
    expect(html).not.toContain("<nav")
  })
})
