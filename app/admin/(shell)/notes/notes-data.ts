// The notes tab (story 4.11, fix 13: one board, no topics): the rows read
// with the admin's RLS, turned into the screen's shapes, and the order
// rules. Display order: pinned notes first, then the rest, each by
// sort_order (one sort_order for the whole board, archived notes included,
// so a restore returns a note to its place).

export const MAX_NOTE_BODY = 2000

export type Note = {
  id: string
  body: string
  pinned: boolean
  done: boolean
  archived: boolean
  sortOrder: number
}

export type NoteRow = {
  id: string
  body: string
  pinned: boolean
  done: boolean
  archived_at: string | null
  sort_order: number
}

function byOrderThenId(
  a: { sortOrder: number; id: string },
  b: { sortOrder: number; id: string }
) {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// The board's notes in display order (archived ones included).
export function toNotes(rows: readonly NoteRow[]): Note[] {
  return orderNotes(
    rows.map((row) => ({
      id: row.id,
      body: row.body,
      pinned: row.pinned,
      done: row.done,
      archived: row.archived_at !== null,
      sortOrder: row.sort_order,
    }))
  )
}

// Pinned first, then the rest; each by sort_order, then id (the order
// admin_set_note_order compares with).
export function orderNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return byOrderThenId(a, b)
  })
}

// ?archive=1 shows the archive under the board.
export function parseNotesParams(
  params: Record<string, string | string[] | undefined>
): { archive: boolean } {
  return { archive: params.archive === "1" }
}

// The board's address, with or without its archive.
export function notesHref(archive = false): string {
  return archive ? "/admin/notes?archive=1" : "/admin/notes"
}

// A note as shown on the board: its first line is the title, the rest (if
// any) the text under it.
export function noteTitle(body: string): { title: string; rest: string } {
  const lines = body.trim().split(/\r?\n/)
  const title = (lines[0] ?? "").trim()
  const rest = lines.slice(1).join("\n").trim()
  return { title, rest }
}

// The visible notes a note moves among: the shown (not archived) notes of
// its own group (pinned or not).
export function moveGroup(notes: readonly Note[], note: Note): string[] {
  return orderNotes(notes)
    .filter((n) => !n.archived && n.pinned === note.pinned)
    .map((n) => n.id)
}

// The full list for admin_set_note_order after moving a note one place
// among its group: the note swaps places with its visible neighbour in the
// board's whole order (archived notes included, they keep their places).
// null at an edge.
export function noteOrderAfterMove(
  notes: readonly Note[],
  id: string,
  delta: -1 | 1
): string[] | null {
  const note = notes.find((n) => n.id === id)
  if (!note || note.archived) return null
  const group = moveGroup(notes, note)
  const neighbour = group[group.indexOf(id) + delta]
  if (!neighbour) return null
  const all = orderNotes(notes).map((n) => n.id)
  const a = all.indexOf(id)
  const b = all.indexOf(neighbour)
  ;[all[a], all[b]] = [all[b], all[a]]
  return all
}

// A short name for a note in an accessible label (its title, at most 40
// characters).
export function noteLabel(body: string): string {
  const { title } = noteTitle(body)
  return title.length > 40 ? `${title.slice(0, 40)}…` : title
}
