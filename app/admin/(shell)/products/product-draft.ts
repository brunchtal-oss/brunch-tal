// The product form's values and their rules (story 2.6), shared by the
// create form and the field-by-field editor. Pure: no React, no server.
// Money is agorot (AD-9); the RPCs check everything again.

import { adminCopy } from "@/lib/copy/admin"
import { parsePositiveInt } from "@/lib/form-values"
import {
  formatAgorot,
  formatAgorotInput,
  parseShekelsToAgorot,
} from "@/lib/money"
import { formatWeekdayIndex } from "@/lib/time"

const copy = adminCopy.products

export const PRODUCT_TYPES = ["single", "intro", "card", "couple"] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]
export type ValidityMode = "days" | "session"
export type EventKind = "regular" | "couple"

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

// A product row as the pages read it (public.products, admin RLS).
export type ProductRow = {
  id: string
  name: string
  type: ProductType
  price_agorot: number
  units: number
  validity_mode: ValidityMode
  validity_days: number | null
  allowed_weekdays: number[] | null
  eligible_event_kind: EventKind
  party_size: number
  intro_only: boolean
  post_join_message: string | null
  post_join_button_label: string | null
  active: boolean
}

// What the fields hold (text as typed).
export type ProductDraft = {
  type: ProductType
  name: string
  priceText: string
  unitsText: string
  validityMode: ValidityMode
  validityDaysText: string
  // Sorted; all seven = every day.
  weekdays: number[]
  eventKind: EventKind
  partySize: 1 | 2
  introOnly: boolean
  postJoinMessage: string
  postJoinButtonLabel: string
}

export type DraftField =
  "name" | "price" | "units" | "validityDays" | "weekdays"

// A new, empty form of a type (user decision 2026-10-04): the type fills
// defaults that Tal may change. single: pinned, 1 entry, 1 adult, regular;
// intro: as single + intro only; card: as single + valid for the setting's
// days; couple: pinned, 1 entry, 2 adults, couple session.
export function draftForType(
  type: ProductType,
  defaultValidityDays: number | null,
  base?: ProductDraft
): ProductDraft {
  return {
    name: base?.name ?? "",
    priceText: base?.priceText ?? "",
    postJoinMessage: base?.postJoinMessage ?? "",
    postJoinButtonLabel: base?.postJoinButtonLabel ?? "",
    weekdays: [...ALL_WEEKDAYS],
    type,
    unitsText: "1",
    validityMode: type === "card" ? "days" : "session",
    validityDaysText:
      type === "card" && defaultValidityDays !== null
        ? String(defaultValidityDays)
        : "",
    eventKind: type === "couple" ? "couple" : "regular",
    partySize: type === "couple" ? 2 : 1,
    introOnly: type === "intro",
  }
}

// The draft of a saved product (the editor's starting values).
export function draftFromRow(row: ProductRow): ProductDraft {
  return {
    type: row.type,
    name: row.name,
    priceText: formatAgorotInput(row.price_agorot),
    unitsText: String(row.units),
    validityMode: row.validity_mode,
    validityDaysText:
      row.validity_days === null ? "" : String(row.validity_days),
    weekdays: row.allowed_weekdays
      ? [...row.allowed_weekdays].sort((a, b) => a - b)
      : [...ALL_WEEKDAYS],
    eventKind: row.eligible_event_kind,
    partySize: row.party_size === 2 ? 2 : 1,
    introOnly: row.intro_only,
    postJoinMessage: row.post_join_message ?? "",
    postJoinButtonLabel: row.post_join_button_label ?? "",
  }
}

// Weekdays as the RPC takes them: null = every day; [] stays [] (refused).
export function weekdaysValue(weekdays: readonly number[]): number[] | null {
  const unique = [...new Set(weekdays)].sort((a, b) => a - b)
  return unique.length === ALL_WEEKDAYS.length ? null : unique
}

// Field rules shown on the screen before any request.
export function fieldError(
  field: DraftField,
  draft: ProductDraft
): "required" | "invalid" | "weekdays" | null {
  switch (field) {
    case "name":
      return draft.name.trim() === "" ? "required" : null
    case "price":
      if (draft.priceText.trim() === "") return "required"
      return parseShekelsToAgorot(draft.priceText) === null ? "invalid" : null
    case "units":
      if (draft.unitsText.trim() === "") return "required"
      return parsePositiveInt(draft.unitsText) === null ? "invalid" : null
    case "validityDays":
      // Empty on create: the RPC takes the setting's default.
      if (draft.validityMode !== "days") return null
      if (draft.validityDaysText.trim() === "") return "required"
      return parsePositiveInt(draft.validityDaysText) === null
        ? "invalid"
        : null
    case "weekdays":
      return draft.weekdays.length === 0 ? "weekdays" : null
  }
}

const CREATE_FIELDS: readonly DraftField[] = [
  "name",
  "price",
  "units",
  "validityDays",
  "weekdays",
]

// The p_product of admin_create_product, or the first field to fix. On
// create an empty number of days is allowed (the setting's default).
export function createPayload(
  draft: ProductDraft
):
  | { ok: true; product: Record<string, unknown> }
  | { ok: false; field: DraftField } {
  for (const field of CREATE_FIELDS) {
    if (field === "validityDays" && draft.validityDaysText.trim() === "") {
      continue
    }
    if (fieldError(field, draft)) return { ok: false, field }
  }
  const days =
    draft.validityMode === "days"
      ? parsePositiveInt(draft.validityDaysText)
      : null
  return {
    ok: true,
    product: {
      name: draft.name.trim(),
      type: draft.type,
      price_agorot: parseShekelsToAgorot(draft.priceText),
      units: parsePositiveInt(draft.unitsText),
      validity_mode: draft.validityMode,
      validity_days: days,
      allowed_weekdays: weekdaysValue(draft.weekdays),
      eligible_event_kind: draft.eventKind,
      party_size: draft.partySize,
      intro_only: draft.introOnly,
      post_join_message: draft.postJoinMessage.trim() || null,
      post_join_button_label: draft.postJoinButtonLabel.trim() || null,
    },
  }
}

// --- Display ---------------------------------------------------------------

export function validityText(mode: ValidityMode, days: number | null): string {
  return mode === "days" && days !== null
    ? copy.validityDays(days)
    : copy.validitySession
}

export function weekdaysText(weekdays: readonly number[] | null): string {
  const value = weekdays === null ? null : weekdaysValue(weekdays)
  if (value === null) return copy.weekdaysAll
  return value.map(formatWeekdayIndex).join(", ")
}

export function yesNo(value: boolean): string {
  return value ? copy.yes : copy.no
}

export function optionalText(value: string | null): string {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? copy.empty : trimmed
}

// The list row's summary: "{price} · {N} כניסות · {validity}".
export function productSummary(row: ProductRow): string {
  return copy.summary(
    formatAgorot(row.price_agorot),
    row.units,
    validityText(row.validity_mode, row.validity_days)
  )
}

// --- The editor's changes ---------------------------------------------------

// One editable value of the editor: its text before and after, and the
// p_changes of admin_update_product. null: unchanged or not valid yet.
export type FieldChange = {
  from: string
  to: string
  changes: Record<string, unknown>
} | null

export type EditorField =
  | "type"
  | "name"
  | "units"
  | "validity"
  | "weekdays"
  | "eventKind"
  | "partySize"
  | "introOnly"
  | "postJoinMessage"
  | "postJoinButtonLabel"

export function fieldChange(
  field: EditorField,
  row: ProductRow,
  draft: ProductDraft
): FieldChange {
  switch (field) {
    case "type":
      return draft.type === row.type
        ? null
        : {
            from: copy.types[row.type],
            to: copy.types[draft.type],
            changes: { type: draft.type },
          }
    case "name": {
      const name = draft.name.trim()
      if (name === "" || name === row.name) return null
      return { from: row.name, to: name, changes: { name } }
    }
    case "units": {
      const units = parsePositiveInt(draft.unitsText)
      if (units === null || units === row.units) return null
      return {
        from: String(row.units),
        to: String(units),
        changes: { units },
      }
    }
    case "validity": {
      const days =
        draft.validityMode === "days"
          ? parsePositiveInt(draft.validityDaysText)
          : null
      if (draft.validityMode === "days" && days === null) return null
      if (
        draft.validityMode === row.validity_mode &&
        days === row.validity_days
      ) {
        return null
      }
      return {
        from: validityText(row.validity_mode, row.validity_days),
        to: validityText(draft.validityMode, days),
        changes: { validity_mode: draft.validityMode, validity_days: days },
      }
    }
    case "weekdays": {
      if (draft.weekdays.length === 0) return null
      const next = weekdaysValue(draft.weekdays)
      const saved = row.allowed_weekdays
        ? weekdaysValue(row.allowed_weekdays)
        : null
      if (JSON.stringify(next) === JSON.stringify(saved)) return null
      return {
        from: weekdaysText(saved),
        to: weekdaysText(next),
        changes: { allowed_weekdays: next },
      }
    }
    case "eventKind":
      return draft.eventKind === row.eligible_event_kind
        ? null
        : {
            from: copy.eventKinds[row.eligible_event_kind],
            to: copy.eventKinds[draft.eventKind],
            changes: { eligible_event_kind: draft.eventKind },
          }
    case "partySize":
      return draft.partySize === row.party_size
        ? null
        : {
            from: String(row.party_size),
            to: String(draft.partySize),
            changes: { party_size: draft.partySize },
          }
    case "introOnly":
      return draft.introOnly === row.intro_only
        ? null
        : {
            from: yesNo(row.intro_only),
            to: yesNo(draft.introOnly),
            changes: { intro_only: draft.introOnly },
          }
    case "postJoinMessage":
    case "postJoinButtonLabel": {
      const column =
        field === "postJoinMessage"
          ? "post_join_message"
          : "post_join_button_label"
      const next = draft[field].trim() || null
      if (next === row[column]) return null
      return {
        from: optionalText(row[column]),
        to: optionalText(next),
        changes: { [column]: next },
      }
    }
  }
}

// The price field's change (the sensitive dialog), or null.
export function priceChange(
  row: ProductRow,
  draft: ProductDraft
): { from: string; to: string; priceAgorot: number } | null {
  const price = parseShekelsToAgorot(draft.priceText)
  if (price === null || price === row.price_agorot) return null
  return {
    from: formatAgorot(row.price_agorot),
    to: formatAgorot(price),
    priceAgorot: price,
  }
}
