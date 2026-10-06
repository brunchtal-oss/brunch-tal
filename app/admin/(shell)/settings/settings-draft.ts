import { adminCopy } from "@/lib/copy/admin"

const show = adminCopy.settings.show

// The settings screen (story 4.7): the saved row, the editable draft (text
// as typed), and for each row of the screen the change it would send to
// admin_update_business_settings. The ranges repeat the RPC's sanity ranges
// (a technical limit, not a business value) only to hint before saving;
// the RPC checks every value again.

export type SettingsRow = {
  version: number
  default_validity_days: number
  registration_close_days_before: number
  // "HH:MM" (the page cuts Postgres "HH:MM:SS").
  registration_close_local_time: string
  default_capacity_regular: number
  default_capacity_couple: number
  cancel_window_hours: number
  credit_options_count: number
  reminder_lead_hours: number
  admin_expiring_days: number
  customer_expiring_days: number
  last_places_threshold: number
  default_prep_days: number[]
  inactivity_months: number
  duplicate_payment_window_days: number
  default_session_start_time: string
  default_session_end_time: string
}

// The settings that are one whole number each.
export const NUMBER_FIELDS = {
  validity: { column: "default_validity_days", min: 1, max: 730 },
  capacityRegular: { column: "default_capacity_regular", min: 1, max: 100 },
  capacityCouple: { column: "default_capacity_couple", min: 1, max: 100 },
  cancelWindow: { column: "cancel_window_hours", min: 0, max: 336 },
  creditOptions: { column: "credit_options_count", min: 1, max: 10 },
  reminder: { column: "reminder_lead_hours", min: 1, max: 168 },
  adminExpiring: { column: "admin_expiring_days", min: 0, max: 90 },
  customerExpiring: { column: "customer_expiring_days", min: 0, max: 90 },
  lastPlaces: { column: "last_places_threshold", min: 0, max: 50 },
  inactivity: { column: "inactivity_months", min: 1, max: 24 },
  duplicateWindow: {
    column: "duplicate_payment_window_days",
    min: 0,
    max: 60,
  },
} as const satisfies Record<
  string,
  { column: keyof SettingsRow; min: number; max: number }
>

export type NumberField = keyof typeof NUMBER_FIELDS
export type EditorField = NumberField | "close" | "sessionHours" | "prepDays"

export const CLOSE_DAYS = { min: 0, max: 7 }
// -6 .. 0: six days before the session to the session's day.
export const PREP_OFFSETS = [-6, -5, -4, -3, -2, -1, 0] as const

export type SettingsDraft = Record<NumberField, string> & {
  closeDays: string
  closeTime: string
  sessionStart: string
  sessionEnd: string
  prepDays: number[]
}

export function draftFromRow(row: SettingsRow): SettingsDraft {
  const numbers = Object.fromEntries(
    Object.entries(NUMBER_FIELDS).map(([field, spec]) => [
      field,
      String(row[spec.column]),
    ])
  ) as Record<NumberField, string>
  return {
    ...numbers,
    closeDays: String(row.registration_close_days_before),
    closeTime: row.registration_close_local_time,
    sessionStart: row.default_session_start_time,
    sessionEnd: row.default_session_end_time,
    prepDays: [...row.default_prep_days].sort((a, b) => a - b),
  }
}

// A whole number typed in the field, or null.
function wholeNumber(text: string): number | null {
  const trimmed = text.trim()
  return /^\d{1,4}$/.test(trimmed) ? Number(trimmed) : null
}

function inRange(text: string, min: number, max: number): number | null {
  const n = wholeNumber(text)
  return n !== null && n >= min && n <= max ? n : null
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export type Problem =
  | { kind: "range"; min: number; max: number }
  | { kind: "time" }
  | { kind: "closeTimeEarly" }
  | { kind: "endBeforeStart" }
  | { kind: "prepDaysEmpty" }

// Why a part of the draft cannot be saved, or null. The keys are the
// draft's own (closeDays, closeTime, sessionStart, sessionEnd, prepDays, or
// a number field).
export function draftProblem(
  key: keyof SettingsDraft,
  draft: SettingsDraft
): Problem | null {
  if (key in NUMBER_FIELDS) {
    const { min, max } = NUMBER_FIELDS[key as NumberField]
    return inRange(draft[key as NumberField], min, max) === null
      ? { kind: "range", min, max }
      : null
  }
  switch (key) {
    case "closeDays":
      return inRange(draft.closeDays, CLOSE_DAYS.min, CLOSE_DAYS.max) === null
        ? { kind: "range", ...CLOSE_DAYS }
        : null
    case "closeTime":
      if (!TIME.test(draft.closeTime)) return { kind: "time" }
      return draft.closeTime < "03:00" ? { kind: "closeTimeEarly" } : null
    case "sessionStart":
      return TIME.test(draft.sessionStart) ? null : { kind: "time" }
    case "sessionEnd":
      if (!TIME.test(draft.sessionEnd)) return { kind: "time" }
      return TIME.test(draft.sessionStart) &&
        draft.sessionEnd <= draft.sessionStart
        ? { kind: "endBeforeStart" }
        : null
    case "prepDays":
      return draft.prepDays.length === 0 ? { kind: "prepDaysEmpty" } : null
    default:
      return null
  }
}

export function problemText(problem: Problem): string {
  const copy = adminCopy.settings
  switch (problem.kind) {
    case "range":
      return copy.range(problem.min, problem.max)
    case "time":
      return copy.timeInvalid
    case "closeTimeEarly":
      return copy.closeTimeEarly
    case "endBeforeStart":
      return copy.endBeforeStart
    case "prepDaysEmpty":
      return copy.prepDaysEmpty
  }
}

// How each number setting reads in the change line.
const NUMBER_SHOW: Record<NumberField, (n: number) => string> = {
  validity: show.days,
  capacityRegular: show.adults,
  capacityCouple: show.adults,
  cancelWindow: show.hours,
  creditOptions: show.options,
  reminder: show.hoursBefore,
  adminExpiring: show.days,
  customerExpiring: show.days,
  lastPlaces: show.places,
  inactivity: show.months,
  duplicateWindow: show.days,
}

export function showPrepDays(offsets: readonly number[]): string {
  return show.prepDays(
    [...offsets].sort((a, b) => a - b).map((offset) => show.prepDay(offset))
  )
}

// The saved value of a row, as read in the change line.
export function savedText(field: EditorField, row: SettingsRow): string {
  if (field in NUMBER_FIELDS) {
    const f = field as NumberField
    return NUMBER_SHOW[f](row[NUMBER_FIELDS[f].column] as number)
  }
  switch (field) {
    case "close":
      return show.close(
        row.registration_close_days_before,
        row.registration_close_local_time
      )
    case "sessionHours":
      return show.sessionHours(
        row.default_session_start_time,
        row.default_session_end_time
      )
    default:
      return showPrepDays(row.default_prep_days)
  }
}

export type SettingChange = {
  changes: Record<string, number | string | number[]>
  from: string
  to: string
}

// The change one row of the screen would save, or null while it holds the
// saved value or a value that cannot be saved (its field shows why).
export function settingChange(
  field: EditorField,
  row: SettingsRow,
  draft: SettingsDraft
): SettingChange | null {
  const from = savedText(field, row)
  if (field in NUMBER_FIELDS) {
    const f = field as NumberField
    const spec = NUMBER_FIELDS[f]
    const value = inRange(draft[f], spec.min, spec.max)
    if (value === null || value === row[spec.column]) return null
    return {
      changes: { [spec.column]: value },
      from,
      to: NUMBER_SHOW[f](value),
    }
  }
  if (field === "close") {
    if (draftProblem("closeDays", draft) || draftProblem("closeTime", draft)) {
      return null
    }
    const days = Number(draft.closeDays.trim())
    if (
      days === row.registration_close_days_before &&
      draft.closeTime === row.registration_close_local_time
    ) {
      return null
    }
    return {
      changes: {
        registration_close_days_before: days,
        registration_close_local_time: draft.closeTime,
      },
      from,
      to: show.close(days, draft.closeTime),
    }
  }
  if (field === "sessionHours") {
    if (
      draftProblem("sessionStart", draft) ||
      draftProblem("sessionEnd", draft)
    ) {
      return null
    }
    if (
      draft.sessionStart === row.default_session_start_time &&
      draft.sessionEnd === row.default_session_end_time
    ) {
      return null
    }
    return {
      changes: {
        default_session_start_time: draft.sessionStart,
        default_session_end_time: draft.sessionEnd,
      },
      from,
      to: show.sessionHours(draft.sessionStart, draft.sessionEnd),
    }
  }
  // prepDays
  if (draftProblem("prepDays", draft)) return null
  const next = [...draft.prepDays].sort((a, b) => a - b)
  const saved = [...row.default_prep_days].sort((a, b) => a - b)
  if (next.join(",") === saved.join(",")) return null
  return {
    changes: { default_prep_days: next },
    from,
    to: showPrepDays(next),
  }
}
