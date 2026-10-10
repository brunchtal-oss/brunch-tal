// The concept screens' pure rules (story 4.8): the row as the screens read
// it, the form's draft, its field errors, the create payload and the
// changes the editor sends. The RPC checks every value again.

export type ConceptKind = "regular" | "couple"

// A concept's image, as image-upload-field edits it.
export type ConceptImage = {
  media_id: string
  alt: string
  focus_x: number
  focus_y: number
}

// A concept as the screens read it (public.concepts with its image).
export type ConceptRow = {
  id: string
  name: string
  description: string | null
  default_kind: ConceptKind
  archived_at: string | null
  image: ConceptImage | null
  // The published file of the image (the list's thumbnail), or null.
  image_path: string | null
}

// What the fields hold (text as typed).
export type ConceptDraft = {
  name: string
  description: string
  kind: ConceptKind
}

export type ConceptField = "name" | "description"

export type ConceptProblem = "required" | "tooLong" | null

export const MAX_NAME = 100
export const MAX_DESCRIPTION = 2000

export function emptyDraft(): ConceptDraft {
  return { name: "", description: "", kind: "regular" }
}

export function draftFromRow(row: ConceptRow): ConceptDraft {
  return {
    name: row.name,
    description: row.description ?? "",
    kind: row.default_kind,
  }
}

// The table's limits, counted on the trimmed text (as the RPC).
export function fieldError(
  field: ConceptField,
  draft: ConceptDraft
): ConceptProblem {
  if (field === "name") {
    const name = draft.name.trim()
    if (!name) return "required"
    return name.length > MAX_NAME ? "tooLong" : null
  }
  return draft.description.trim().length > MAX_DESCRIPTION ? "tooLong" : null
}

function firstError(draft: ConceptDraft): ConceptField | null {
  if (fieldError("name", draft)) return "name"
  if (fieldError("description", draft)) return "description"
  return null
}

// The create RPC's p_concept, or the first field to fix.
export function createPayload(
  draft: ConceptDraft
):
  | { ok: true; concept: Record<string, string | null> }
  | { ok: false; field: ConceptField } {
  const field = firstError(draft)
  if (field) return { ok: false, field }
  return {
    ok: true,
    concept: {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      default_kind: draft.kind,
    },
  }
}

// The update RPC's p_changes: only the fields that differ from the saved
// row (null when nothing changed), or the first field to fix.
export function conceptChanges(
  row: ConceptRow,
  draft: ConceptDraft
):
  | { ok: true; changes: Record<string, string | null> | null }
  | { ok: false; field: ConceptField } {
  const field = firstError(draft)
  if (field) return { ok: false, field }
  const changes: Record<string, string | null> = {}
  const name = draft.name.trim()
  if (name !== row.name) changes.name = name
  const description = draft.description.trim() || null
  if (description !== (row.description?.trim() || null)) {
    changes.description = description
  }
  if (draft.kind !== row.default_kind) changes.default_kind = draft.kind
  return {
    ok: true,
    changes: Object.keys(changes).length > 0 ? changes : null,
  }
}

// Whether the image in the form differs from the saved one.
export function imageChanged(
  saved: ConceptImage | null,
  next: ConceptImage | null
): boolean {
  if (!saved || !next) return saved !== next
  return (
    saved.media_id !== next.media_id ||
    saved.alt.trim() !== next.alt.trim() ||
    saved.focus_x !== next.focus_x ||
    saved.focus_y !== next.focus_y
  )
}

// The list's order: active first, then archived; each as the table orders
// it (sort_order, name). `showArchive` false leaves the archived out.
export function visibleConcepts(
  rows: readonly ConceptRow[],
  showArchive: boolean
): ConceptRow[] {
  const active = rows.filter((row) => row.archived_at === null)
  if (!showArchive) return active
  return [...active, ...rows.filter((row) => row.archived_at !== null)]
}
