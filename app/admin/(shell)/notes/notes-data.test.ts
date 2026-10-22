import { describe, expect, it } from "vitest"

import {
  moveGroup,
  noteLabel,
  noteOrderAfterMove,
  notesHref,
  noteTitle,
  orderNotes,
  parseNotesParams,
  toNotes,
  type Note,
} from "./notes-data"

function note(id: string, sortOrder: number, extra: Partial<Note> = {}): Note {
  return {
    id,
    body: id,
    pinned: false,
    done: false,
    archived: false,
    sortOrder,
    ...extra,
  }
}

describe("the notes board's data (story 4.11, fix 13)", () => {
  it("orders notes pinned first, then the rest, each by sort_order; archived from archived_at", () => {
    const notes = toNotes([
      {
        id: "u2",
        body: "x",
        pinned: false,
        done: true,
        archived_at: null,
        sort_order: 2,
      },
      {
        id: "p2",
        body: "x",
        pinned: true,
        done: false,
        archived_at: null,
        sort_order: 5,
      },
      {
        id: "u1",
        body: "x",
        pinned: false,
        done: false,
        archived_at: "2026-10-10T08:00:00Z",
        sort_order: -1,
      },
      {
        id: "p1",
        body: "x",
        pinned: true,
        done: false,
        archived_at: null,
        sort_order: 0,
      },
    ])
    expect(notes.map((n) => n.id)).toEqual(["p1", "p2", "u1", "u2"])
    expect(notes.find((n) => n.id === "u1")?.archived).toBe(true)
    // A done note keeps its place.
    expect(notes.at(-1)).toMatchObject({ id: "u2", done: true })
  })

  it("reads ?archive=1 and builds the board's address", () => {
    expect(parseNotesParams({ archive: "1" })).toEqual({ archive: true })
    expect(parseNotesParams({ archive: ["1"] })).toEqual({ archive: false })
    expect(parseNotesParams({})).toEqual({ archive: false })
    expect(notesHref()).toBe("/admin/notes")
    expect(notesHref(true)).toBe("/admin/notes?archive=1")
  })

  it("the first line is the title, the rest the text", () => {
    expect(noteTitle("ליגל\nענבר")).toEqual({ title: "ליגל", rest: "ענבר" })
    expect(noteTitle("איציק לקינוחים")).toEqual({
      title: "איציק לקינוחים",
      rest: "",
    })
    expect(noteTitle("  ספק פרחים\r\nטלפון\n\nעוד שורה  ")).toEqual({
      title: "ספק פרחים",
      rest: "טלפון\n\nעוד שורה",
    })
    // Blank lines after the title leave no empty text.
    expect(noteTitle("כותרת\n   \n")).toEqual({ title: "כותרת", rest: "" })
  })

  it("moves a note among the shown notes of its group; archived notes keep their places in the board's full list", () => {
    const notes = [
      note("p1", 0, { pinned: true }),
      note("a", 1),
      note("x", 2, { archived: true }),
      note("b", 3),
      note("c", 4, { done: true }),
    ]
    expect(moveGroup(notes, notes[1])).toEqual(["a", "b", "c"])
    expect(moveGroup(notes, notes[0])).toEqual(["p1"])
    // b up swaps with a (over the archived x, which stays third).
    expect(noteOrderAfterMove(notes, "b", -1)).toEqual([
      "p1",
      "b",
      "x",
      "a",
      "c",
    ])
    // A pinned note does not cross into the unpinned ones.
    expect(noteOrderAfterMove(notes, "p1", 1)).toBeNull()
    expect(noteOrderAfterMove(notes, "a", -1)).toBeNull()
    expect(noteOrderAfterMove(notes, "x", 1)).toBeNull()
    expect(orderNotes(notes).map((n) => n.id)).toEqual([
      "p1",
      "a",
      "x",
      "b",
      "c",
    ])
  })

  it("names a note by its first line, at most 40 characters", () => {
    expect(noteLabel("  ספק פרחים\nטלפון  ")).toBe("ספק פרחים")
    expect(noteLabel("א".repeat(50))).toBe(`${"א".repeat(40)}…`)
  })
})
