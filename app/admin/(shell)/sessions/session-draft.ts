// The session form's values and their rules (story 3.1), shared by the
// create form, the field-by-field editor and the list. Pure: no React, no
// server. Times are local (Asia/Jerusalem) text as the inputs hold them; the
// RPCs turn them into instants and check everything again (AD-8). Money is
// agorot (AD-9).

import { adminCopy } from "@/lib/copy/admin"
import {
  formatAgorot,
  formatAgorotInput,
  parseShekelsToAgorot,
} from "@/lib/money"
import {
  formatDayMonth,
  formatLocalDate,
  formatSessionDateTime,
  formatTime,
  formatWeekday,
} from "@/lib/time"

const copy = adminCopy.sessions

export type EventKind = "regular" | "couple"
export type EventStatus = "draft" | "published" | "cancelled" | "completed"

// A concept offered for a new session (not archived).
export type ConceptOption = {
  id: string
  name: string
  description: string | null
  default_kind: EventKind
}

// The default capacity of each kind (business_settings), or null when the
// settings could not be read (the RPC then takes them itself).
export type CapacityDefaults = Record<EventKind, number> | null

// The hours a new session starts with (business_settings, "HH:MM"), or null
// when the settings could not be read (the times then start empty).
export type TimeDefaults = { start: string; end: string } | null

// A session as the screens read it (public.events, admin RLS, with its
// concept's name).
export type SessionRow = {
  id: string
  concept_name: string
  kind: EventKind
  description: string | null
  starts_at: string
  ends_at: string
  capacity_adults: number
  registration_closes_at: string
  registration_close_overridden: boolean
  status: EventStatus
  display_price_agorot: number | null
}

// What the fields hold (text as typed). date "YYYY-MM-DD", times "HH:MM",
// closesLocal "YYYY-MM-DDTHH:MM".
export type SessionDraft = {
  conceptId: string
  date: string
  startTime: string
  endTime: string
  kind: EventKind
  description: string
  capacityText: string
  priceText: string
  closesLocal: string
}

export type DraftField =
  "concept" | "date" | "startTime" | "endTime" | "capacity" | "price" | "closes"

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d)$/

export function sessionTitle(conceptName: string): string {
  return copy.sessionTitle(conceptName)
}

// --- Local values ------------------------------------------------------------

// The local "YYYY-MM-DDTHH:MM" of an instant (the value of a datetime-local
// input), in Jerusalem.
export function localDateTime(instant: string): string {
  return `${formatLocalDate(instant)}T${formatTime(instant)}`
}

// "יום שני 15.12" of a plain local date.
function dayText(date: string): string {
  return `${formatWeekday(date)} ${formatDayMonth(date)}`
}

// "יום שני 15.12 · 10:00–12:00"
export function whenText(date: string, start: string, end: string): string {
  return copy.when(dayText(date), start, end)
}

// "יום ראשון 14.12 · 20:00" of a local "YYYY-MM-DDTHH:MM".
export function localDateTimeText(local: string): string {
  const match = LOCAL.exec(local)
  if (!match) return local
  return `${dayText(match[1])} · ${match[2]}`
}

// --- Drafts -----------------------------------------------------------------

// The capacity a kind starts with, as text ("" without settings).
export function capacityFor(kind: EventKind, defaults: CapacityDefaults) {
  return defaults ? String(defaults[kind]) : ""
}

// A new form for a concept: its kind and description, and the capacity of
// that kind from the settings. The date, times, price and close typed so far
// stay; a first form takes the default hours from the settings.
export function draftForConcept(
  concept: ConceptOption,
  defaults: CapacityDefaults,
  base?: SessionDraft,
  times?: TimeDefaults
): SessionDraft {
  return {
    date: base?.date ?? "",
    startTime: base?.startTime ?? times?.start ?? "",
    endTime: base?.endTime ?? times?.end ?? "",
    priceText: base?.priceText ?? "",
    closesLocal: base?.closesLocal ?? "",
    conceptId: concept.id,
    kind: concept.default_kind,
    description: concept.description ?? "",
    capacityText: capacityFor(concept.default_kind, defaults),
  }
}

// The draft of a saved session (the editor's starting values).
export function draftFromRow(row: SessionRow): SessionDraft {
  return {
    conceptId: "",
    date: formatLocalDate(row.starts_at),
    startTime: formatTime(row.starts_at),
    endTime: formatTime(row.ends_at),
    kind: row.kind,
    description: row.description ?? "",
    capacityText: String(row.capacity_adults),
    priceText:
      row.display_price_agorot === null
        ? ""
        : formatAgorotInput(row.display_price_agorot),
    closesLocal: localDateTime(row.registration_closes_at),
  }
}

// A positive whole number typed in a field, or null.
export function parsePositiveInt(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,9}$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value > 0 ? value : null
}

// Field rules shown on the screen before any request. The optional price
// may be empty; an empty capacity is required.
export function fieldError(
  field: DraftField,
  draft: SessionDraft
): "required" | "invalid" | null {
  switch (field) {
    case "concept":
      return draft.conceptId === "" ? "required" : null
    case "date":
      if (draft.date === "") return "required"
      return DATE.test(draft.date) ? null : "invalid"
    case "startTime":
      if (draft.startTime === "") return "required"
      return TIME.test(draft.startTime) ? null : "invalid"
    case "endTime":
      if (draft.endTime === "") return "required"
      if (!TIME.test(draft.endTime)) return "invalid"
      // "HH:MM" strings compare in time order.
      return TIME.test(draft.startTime) && draft.endTime <= draft.startTime
        ? "invalid"
        : null
    case "capacity":
      if (draft.capacityText.trim() === "") return "required"
      return parsePositiveInt(draft.capacityText) === null ? "invalid" : null
    case "price":
      if (draft.priceText.trim() === "") return null
      return parseShekelsToAgorot(draft.priceText) === null ? "invalid" : null
    case "closes":
      if (draft.closesLocal === "") return "required"
      return LOCAL.test(draft.closesLocal) ? null : "invalid"
  }
}

const CREATE_FIELDS: readonly DraftField[] = [
  "concept",
  "date",
  "startTime",
  "endTime",
  "capacity",
  "price",
]

// The p_event of admin_create_event, or the first field to fix. An empty
// close is left to the settings' rule; publish sends the session out at once.
export function createPayload(
  draft: SessionDraft,
  publish = false
):
  | { ok: true; event: Record<string, unknown> }
  | { ok: false; field: DraftField } {
  for (const field of CREATE_FIELDS) {
    if (fieldError(field, draft)) return { ok: false, field }
  }
  const event: Record<string, unknown> = {
    concept_id: draft.conceptId,
    date: draft.date,
    start_time: draft.startTime,
    end_time: draft.endTime,
    kind: draft.kind,
    description: draft.description.trim() || null,
    capacity_adults: parsePositiveInt(draft.capacityText),
  }
  if (draft.priceText.trim() !== "") {
    event.display_price_agorot = parseShekelsToAgorot(draft.priceText)
  }
  if (draft.closesLocal !== "") {
    // "YYYY-MM-DDTHH:MM" strings compare in time order: the close comes
    // before the start (the table's check refuses it too).
    if (
      fieldError("closes", draft) ||
      draft.closesLocal > `${draft.date}T${draft.startTime}`
    ) {
      return { ok: false, field: "closes" }
    }
    event.registration_closes_local = draft.closesLocal
  }
  if (publish) event.publish = true
  return { ok: true, event }
}

// The field an RPC refused (detail.field) on the form.
export function draftFieldOf(field: string | undefined): DraftField | null {
  switch (field) {
    case "concept_id":
      return "concept"
    case "date":
      return "date"
    case "start_time":
      return "startTime"
    case "end_time":
      return "endTime"
    case "capacity_adults":
      return "capacity"
    case "display_price_agorot":
      return "price"
    case "registration_closes_local":
      return "closes"
    default:
      return null
  }
}

// --- Display ---------------------------------------------------------------

export function priceText(agorot: number | null): string {
  return agorot === null ? adminCopy.products.empty : formatAgorot(agorot)
}

export function descriptionText(value: string | null): string {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? adminCopy.products.empty : trimmed
}

// The list row's line: "יום שני 15.12 · 10:00 · 12 מקומות".
export function listSummary(row: {
  starts_at: string
  capacity_adults: number
}): string {
  return `${formatSessionDateTime(row.starts_at)} · ${copy.places(row.capacity_adults)}`
}

// --- The editor's changes ---------------------------------------------------

// One editable value of the editor: its text before and after, and the
// p_changes of admin_update_event. null: unchanged or not valid yet.
export type FieldChange = {
  from: string
  to: string
  changes: Record<string, unknown>
} | null

export type EditorField =
  "when" | "kind" | "description" | "capacity" | "closes" | "price"

export function fieldChange(
  field: EditorField,
  row: SessionRow,
  draft: SessionDraft
): FieldChange {
  const saved = draftFromRow(row)
  switch (field) {
    case "when": {
      if (
        fieldError("date", draft) ||
        fieldError("startTime", draft) ||
        fieldError("endTime", draft)
      ) {
        return null
      }
      const changes: Record<string, unknown> = {}
      if (draft.date !== saved.date) changes.date = draft.date
      if (draft.startTime !== saved.startTime) {
        changes.start_time = draft.startTime
      }
      if (draft.endTime !== saved.endTime) changes.end_time = draft.endTime
      if (Object.keys(changes).length === 0) return null
      return {
        from: whenText(saved.date, saved.startTime, saved.endTime),
        to: whenText(draft.date, draft.startTime, draft.endTime),
        changes,
      }
    }
    case "kind":
      return draft.kind === row.kind
        ? null
        : {
            from: copy.kinds[row.kind],
            to: copy.kinds[draft.kind],
            changes: { kind: draft.kind },
          }
    case "description": {
      const next = draft.description.trim() || null
      if (next === row.description) return null
      return {
        from: descriptionText(row.description),
        to: descriptionText(next),
        changes: { description: next },
      }
    }
    case "capacity": {
      const capacity = parsePositiveInt(draft.capacityText)
      if (capacity === null || capacity === row.capacity_adults) return null
      return {
        from: String(row.capacity_adults),
        to: String(capacity),
        changes: { capacity_adults: capacity },
      }
    }
    case "closes": {
      if (
        fieldError("closes", draft) ||
        draft.closesLocal === saved.closesLocal
      )
        return null
      return {
        from: formatSessionDateTime(row.registration_closes_at),
        to: localDateTimeText(draft.closesLocal),
        changes: { registration_closes_local: draft.closesLocal },
      }
    }
    case "price": {
      if (fieldError("price", draft)) return null
      const next =
        draft.priceText.trim() === ""
          ? null
          : parseShekelsToAgorot(draft.priceText)
      if (next === row.display_price_agorot) return null
      return {
        from: priceText(row.display_price_agorot),
        to: priceText(next),
        changes: { display_price_agorot: next },
      }
    }
  }
}
