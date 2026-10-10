// The notes tab (story 4.11): the rows read with the admin's RLS, turned
// into the screen's shapes, and the order rules. Display order: pinned
// notes first, then the rest, each by sort_order (one sort_order per topic,
// archived notes included, so a restore returns a note to its place).

export const MAX_TOPIC_NAME = 60
export const MAX_NOTE_BODY = 2000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type NoteTopic = { id: string; name: string }

export type Note = {
  id: string
  body: string
  pinned: boolean
  done: boolean
  archived: boolean
  sortOrder: number
}

export type TopicRow = { id: string; name: string; sort_order: number }

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

// The topics by sort_order, then id.
export function toTopics(rows: readonly TopicRow[]): NoteTopic[] {
  return rows
    .map((row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order }))
    .sort(byOrderThenId)
    .map(({ id, name }) => ({ id, name }))
}

// A topic's notes in display order (archived ones included).
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

// ?topic= (a known topic, else the first) and ?archive=1.
export function parseNotesParams(
  params: Record<string, string | string[] | undefined>
): { topicId: string | null; archive: boolean } {
  const topic = params.topic
  const archive = params.archive
  return {
    topicId: typeof topic === "string" && UUID.test(topic) ? topic : null,
    archive: archive === "1",
  }
}

export function selectedTopic(
  topics: readonly NoteTopic[],
  topicId: string | null
): NoteTopic | null {
  return topics.find((t) => t.id === topicId) ?? topics[0] ?? null
}

// The address of a topic, with or without its archive.
export function topicHref(topicId: string, archive = false): string {
  const params = new URLSearchParams({ topic: topicId })
  if (archive) params.set("archive", "1")
  return `/admin/notes?${params.toString()}`
}

// One place up (-1) or down (1) in a list of ids; null at an edge.
export function swapIds(
  ids: readonly string[],
  id: string,
  delta: -1 | 1
): string[] | null {
  const index = ids.indexOf(id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= ids.length) return null
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
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
// topic's whole order (archived notes included, they keep their places).
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

// A topic with any note, archived ones included, is deleted only through
// the delete_note_topic sensitive dialog (p_confirmed); an empty one with
// the inline two-step question.
export function needsConfirmedDelete(notes: readonly Note[]): boolean {
  return notes.length > 0
}

// A short name for a note in an accessible label (its first line, at most
// 40 characters).
export function noteLabel(body: string): string {
  const line = body.trim().split(/\r?\n/)[0] ?? ""
  return line.length > 40 ? `${line.slice(0, 40)}…` : line
}
