import { describe, expect, it } from "vitest"

import {
  draftFromRow,
  draftProblem,
  savedText,
  settingChange,
  type SettingsDraft,
  type SettingsRow,
} from "./settings-draft"

const ROW: SettingsRow = {
  version: 3,
  default_validity_days: 49,
  registration_close_days_before: 1,
  registration_close_local_time: "20:00",
  default_capacity_regular: 12,
  default_capacity_couple: 14,
  cancel_window_hours: 48,
  credit_options_count: 2,
  reminder_lead_hours: 24,
  admin_expiring_days: 21,
  customer_expiring_days: 10,
  last_places_threshold: 4,
  default_prep_days: [-1, 0],
  inactivity_months: 3,
  duplicate_payment_window_days: 7,
  default_session_start_time: "10:30",
  default_session_end_time: "14:30",
}

describe("savedText", () => {
  it.each([
    ["close", "יום לפני ב-20:00"],
    ["cancelWindow", "48 שעות"],
    ["prepDays", "יום לפני · יום המפגש"],
    ["sessionHours", "10:30–14:30"],
    ["reminder", "24 שעות לפני המפגש"],
    ["creditOptions", "2 חלופות"],
    ["inactivity", "3 חודשים"],
  ] as const)("%s reads %s", (field, text) => {
    expect(savedText(field, ROW)).toBe(text)
  })

  it("reads a close on the session's day", () => {
    expect(
      savedText("close", { ...ROW, registration_close_days_before: 0 })
    ).toBe("ביום המפגש ב-20:00")
  })
})

describe("settingChange", () => {
  it("is null while the draft holds the saved values", () => {
    const draft = draftFromRow(ROW)
    for (const field of [
      "close",
      "cancelWindow",
      "sessionHours",
      "prepDays",
      "validity",
    ] as const) {
      expect(settingChange(field, ROW, draft), field).toBeNull()
    }
  })

  it("sends one number with old and new in words", () => {
    const draft = { ...draftFromRow(ROW), capacityRegular: "14" }
    expect(settingChange("capacityRegular", ROW, draft)).toEqual({
      changes: { default_capacity_regular: 14 },
      from: "12 מבוגרים",
      to: "14 מבוגרים",
    })
  })

  it("sends the close as one row: days and time together", () => {
    const draft = { ...draftFromRow(ROW), closeDays: "2", closeTime: "18:00" }
    expect(settingChange("close", ROW, draft)).toEqual({
      changes: {
        registration_close_days_before: 2,
        registration_close_local_time: "18:00",
      },
      from: "יום לפני ב-20:00",
      to: "יומיים לפני ב-18:00",
    })
  })

  it("sends the prep days sorted", () => {
    const draft = { ...draftFromRow(ROW), prepDays: [0, -2, -1] }
    expect(settingChange("prepDays", ROW, draft)).toEqual({
      changes: { default_prep_days: [-2, -1, 0] },
      from: "יום לפני · יום המפגש",
      to: "יומיים לפני · יום לפני · יום המפגש",
    })
  })

  it.each([
    ["cancelWindow", { cancelWindow: "-1" }],
    ["cancelWindow", { cancelWindow: "337" }],
    ["creditOptions", { creditOptions: "0" }],
    ["validity", { validity: "1.5" }],
    ["close", { closeTime: "02:30" }],
    ["close", { closeDays: "8" }],
    ["sessionHours", { sessionStart: "10:30", sessionEnd: "10:00" }],
    ["prepDays", { prepDays: [] }],
  ] as const)("offers no save for %s %o", (field, patch) => {
    const draft = { ...draftFromRow(ROW), ...patch } as SettingsDraft
    expect(settingChange(field, ROW, draft)).toBeNull()
  })
})

describe("draftProblem", () => {
  it("names the range of a number out of it", () => {
    const draft = { ...draftFromRow(ROW), cancelWindow: "400" }
    expect(draftProblem("cancelWindow", draft)).toEqual({
      kind: "range",
      min: 0,
      max: 336,
    })
  })

  it("puts reversed hours on the end time", () => {
    const draft = {
      ...draftFromRow(ROW),
      sessionStart: "10:30",
      sessionEnd: "10:00",
    }
    expect(draftProblem("sessionStart", draft)).toBeNull()
    expect(draftProblem("sessionEnd", draft)).toEqual({
      kind: "endBeforeStart",
    })
  })

  it("refuses a close before 03:00 and no prep day", () => {
    const draft = { ...draftFromRow(ROW), closeTime: "01:00", prepDays: [] }
    expect(draftProblem("closeTime", draft)).toEqual({
      kind: "closeTimeEarly",
    })
    expect(draftProblem("prepDays", draft)).toEqual({ kind: "prepDaysEmpty" })
  })
})
