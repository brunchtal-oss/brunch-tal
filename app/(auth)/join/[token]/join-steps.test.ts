import { describe, expect, it } from "vitest"

import type { JoinFormState } from "./actions"
import { validateJoin, type JoinFieldError } from "./join-input"
import {
  afterResult,
  errorsForStep,
  isStepTwoEntry,
  STEP_TWO_FIELDS,
  stepForErrors,
  stepForState,
  stepOfEntry,
  stepOneErrors,
  stepTwoHistoryState,
  submitDecision,
  type JoinStep,
} from "./join-steps"

const NAME: JoinFieldError = { field: "fullName", message: "FIELD_REQUIRED" }
const BABY: JoinFieldError = {
  field: "birthDate",
  index: 1,
  message: "FIELD_REQUIRED",
}
const PHOTO: JoinFieldError = { field: "photoConsent", message: "photoConsent" }
const PERSONAL: JoinFieldError = {
  field: "personalPhotoConsent",
  message: "personalPhotoConsent",
}

describe("join steps", () => {
  it("puts only the two consents in step 2", () => {
    expect(STEP_TWO_FIELDS).toEqual(["photoConsent", "personalPhotoConsent"])
  })

  it("keeps the step 1 errors for הבא", () => {
    expect(stepOneErrors([NAME, PHOTO, BABY, PERSONAL])).toEqual([NAME, BABY])
    expect(stepOneErrors([PHOTO, PERSONAL])).toEqual([])
  })

  // "הבא" runs the server's rules (validateJoin) on the whole form: an empty
  // name shows, the unanswered step 2 questions do not.
  it("shows only the step 1 errors of validateJoin for הבא", () => {
    const data = new FormData()
    for (const [name, value] of [
      ["fullName", ""],
      ["phone", "054-1234567"],
      ["email", "a@example.com"],
      ["babyName", "Baby"],
      ["birthDate", "2026-09-01"],
      ["password", "Test-pass-123"],
      ["confirm", "Test-pass-123"],
      ["privacyConsent", "on"],
    ]) {
      data.append(name, value)
    }
    const result = validateJoin(data)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(["photoConsent", "personalPhotoConsent"])
    )
    expect(stepOneErrors(result.errors)).toEqual([
      { field: "fullName", message: "FIELD_REQUIRED" },
    ])
    expect(stepForErrors(result.errors)).toBe(1)
  })

  it("splits the errors by step", () => {
    expect(errorsForStep([NAME, PHOTO], 1)).toEqual([NAME])
    expect(errorsForStep([NAME, PHOTO], 2)).toEqual([PHOTO])
  })

  it("shows step 1 while it has an error", () => {
    expect(stepForErrors([PHOTO, NAME])).toBe(1)
    expect(stepForErrors([PHOTO, PERSONAL])).toBe(2)
  })

  it.each<[string, JoinFormState, JoinStep | null]>([
    ["no result yet", null, null],
    [
      "an error on a step 1 field",
      {
        status: "error",
        code: "INVALID_INPUT",
        errors: [{ field: "phone", message: "phone" }],
      },
      1,
    ],
    [
      "an error on a consent",
      { status: "error", code: "INVALID_INPUT", errors: [PERSONAL] },
      2,
    ],
    [
      "an error without a field",
      { status: "error", code: "SERVER_ERROR", errors: [] },
      2,
    ],
    ["email_exists", { status: "email_exists", idempotencyKey: "k" }, 1],
    ["identity_retry", { status: "identity_retry", idempotencyKey: "k" }, 1],
    ["a conflict", { status: "conflict", reason: null }, null],
    ["used", { status: "used" }, null],
  ])("after %s", (_label, state, step) => {
    expect(stepForState(state)).toBe(step)
  })
})

describe("afterResult", () => {
  it("takes a server step 1 error on step 2 back to step 1, with its errors", () => {
    const phone: JoinFieldError = { field: "phone", message: "phone" }
    expect(
      afterResult(
        { status: "error", code: "INVALID_INPUT", errors: [phone] },
        2
      )
    ).toEqual({ step: 1, focus: { kind: "errors", errors: [phone] } })
  })

  it("keeps a consent error on step 2", () => {
    expect(
      afterResult(
        { status: "error", code: "INVALID_INPUT", errors: [PERSONAL] },
        2
      )
    ).toEqual({ step: 2, focus: { kind: "errors", errors: [PERSONAL] } })
  })

  it("keeps a general error on step 2 without moving focus", () => {
    expect(
      afterResult({ status: "error", code: "SERVER_ERROR", errors: [] }, 2)
    ).toEqual({ step: 2, focus: null })
  })

  it("sends email_exists to the step 1 heading", () => {
    expect(
      afterResult({ status: "email_exists", idempotencyKey: "k" }, 2)
    ).toEqual({ step: 1, focus: { kind: "heading", step: 1 } })
  })

  it("leaves the step of a result that replaces the form", () => {
    expect(afterResult({ status: "used" }, 2)).toEqual({
      step: 2,
      focus: null,
    })
  })
})

describe("submitDecision", () => {
  it("step 1: הבא, whatever the answers", () => {
    expect(submitDecision(1, { ok: false, errors: [PHOTO] })).toEqual({
      kind: "next",
    })
    expect(submitDecision(1, { ok: true })).toEqual({ kind: "next" })
  })

  it("step 2 with empty answers: not sent, stays on step 2", () => {
    expect(submitDecision(2, { ok: false, errors: [PHOTO, PERSONAL] })).toEqual(
      {
        kind: "show-errors",
        step: 2,
        errors: [PHOTO, PERSONAL],
        shown: [PHOTO, PERSONAL],
      }
    )
  })

  it("step 2 with a step 1 error: back to step 1, showing it", () => {
    expect(submitDecision(2, { ok: false, errors: [NAME, PHOTO] })).toEqual({
      kind: "show-errors",
      step: 1,
      errors: [NAME, PHOTO],
      shown: [NAME],
    })
  })

  it("step 2, all valid: sent", () => {
    expect(submitDecision(2, { ok: true })).toEqual({ kind: "send" })
  })
})

describe("the back button's history entry", () => {
  it("adds joinStep 2 and keeps the router's state", () => {
    expect(stepTwoHistoryState({ __NA: true, tree: "t" })).toEqual({
      __NA: true,
      tree: "t",
      joinStep: 2,
    })
    expect(stepTwoHistoryState(null)).toEqual({ joinStep: 2 })
  })

  it("reads the step of an entry", () => {
    expect(isStepTwoEntry(stepTwoHistoryState(null))).toBe(true)
    expect(isStepTwoEntry({ __NA: true })).toBe(false)
    expect(isStepTwoEntry(null)).toBe(false)
    expect(stepOfEntry({ joinStep: 2 })).toBe(2)
    expect(stepOfEntry({ __NA: true })).toBe(1)
    expect(stepOfEntry(undefined)).toBe(1)
  })
})
