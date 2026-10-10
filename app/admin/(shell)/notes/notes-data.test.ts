import { describe, expect, it } from "vitest"

import {
  moveGroup,
  needsConfirmedDelete,
  noteLabel,
  noteOrderAfterMove,
  orderNotes,
  parseNotesParams,
  selectedTopic,
  swapIds,
  toNotes,
  toTopics,
  topicHref,
  type Note,
} from "./notes-data"

const T1 = "11111111-1111-4111-8111-111111111111"
const T2 = "22222222-2222-4222-8222-222222222222"

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

describe("the notes tab's data (story 4.11)", () => {
  it("orders topics by sort_order, then id", () => {
    expect(
      toTopics([
        { id: "b", name: "ספקים", sort_order: 2 },
        { id: "c", name: "מתעניינות", sort_order: 1 },
        { id: "a", name: "רעיונות", sort_order: 2 },
      ]).map((t) => t.id)
    ).toEqual(["c", "a", "b"])
  })

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

  it("reads ?topic= (a uuid only) and ?archive=1, and falls back to the first topic", () => {
    expect(parseNotesParams({ topic: T1, archive: "1" })).toEqual({
      topicId: T1,
      archive: true,
    })
    expect(parseNotesParams({ topic: "x", archive: ["1"] })).toEqual({
      topicId: null,
      archive: false,
    })
    const topics = [
      { id: T1, name: "א" },
      { id: T2, name: "ב" },
    ]
    expect(selectedTopic(topics, T2)?.id).toBe(T2)
    expect(selectedTopic(topics, null)?.id).toBe(T1)
    expect(selectedTopic([], T1)).toBeNull()
    expect(topicHref(T1)).toBe(`/admin/notes?topic=${T1}`)
    expect(topicHref(T1, true)).toBe(`/admin/notes?topic=${T1}&archive=1`)
  })

  it("swaps one place, null at an edge", () => {
    expect(swapIds(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"])
    expect(swapIds(["a", "b"], "a", -1)).toBeNull()
    expect(swapIds(["a", "b"], "b", 1)).toBeNull()
  })

  it("moves a note among the shown notes of its group; archived notes keep their places in the full list", () => {
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

  it("a topic with any note, archived ones included, needs the confirmed delete", () => {
    expect(needsConfirmedDelete([])).toBe(false)
    expect(needsConfirmedDelete([note("a", 0)])).toBe(true)
    expect(needsConfirmedDelete([note("x", 0, { archived: true })])).toBe(true)
  })

  it("names a note by its first line, at most 40 characters", () => {
    expect(noteLabel("  ספק פרחים\nטלפון  ")).toBe("ספק פרחים")
    expect(noteLabel("א".repeat(50))).toBe(`${"א".repeat(40)}…`)
  })
})
