import type { JoinFormState } from "./actions"
import type { JoinField, JoinFieldError } from "./join-input"

// The two steps of the join form (story 2.13, user decision 2026-10-07).
// Client side only: one form, one Server Action that checks every field.
// Pure, so the rules are tested without a DOM.

export type JoinStep = 1 | 2

// The fields of step 2: the two photo consents. Every other field is step 1.
export const STEP_TWO_FIELDS: readonly JoinField[] = [
  "photoConsent",
  "personalPhotoConsent",
]

function isStepTwo(error: JoinFieldError): boolean {
  return STEP_TWO_FIELDS.includes(error.field)
}

// The errors "הבא" shows: those of step 1 only.
export function stepOneErrors(
  errors: readonly JoinFieldError[]
): JoinFieldError[] {
  return errors.filter((error) => !isStepTwo(error))
}

// The errors shown in a step.
export function errorsForStep(
  errors: readonly JoinFieldError[],
  step: JoinStep
): JoinFieldError[] {
  return step === 1 ? stepOneErrors(errors) : errors.filter(isStepTwo)
}

// The step that shows these errors: step 1 while any of them is there.
export function stepForErrors(errors: readonly JoinFieldError[]): JoinStep {
  return stepOneErrors(errors).length > 0 ? 1 : 2
}

// The step after a result of the Server Action. An error on a step 1 field,
// email_exists and identity_retry (the email or phone to check) go back to
// step 1; an error on a consent, or one without a field, stays in step 2.
// null: the result replaces the form (or there is none yet), the step stays.
export function stepForState(state: JoinFormState): JoinStep | null {
  if (!state) return null
  if (state.status === "email_exists" || state.status === "identity_retry") {
    return 1
  }
  if (state.status === "error") return stepForErrors(state.errors)
  return null
}

// Where focus goes after a render: a step's heading (a step button, or a
// result whose message sits under it) or the errors shown (one: its field;
// more: the summary).
export type FocusRequest =
  | { kind: "heading"; step: JoinStep }
  | { kind: "errors"; errors: JoinFieldError[] }

// A new result of the Server Action: the step that shows it, and where
// focus goes there (the usual rule for errors; the step 1 heading for
// email_exists and identity_retry, whose message sits under it).
export function afterResult(
  state: JoinFormState,
  currentStep: JoinStep
): { step: JoinStep; focus: FocusRequest | null } {
  const step = stepForState(state) ?? currentStep
  if (state?.status === "error" && state.errors.length > 0) {
    return {
      step,
      focus: { kind: "errors", errors: errorsForStep(state.errors, step) },
    }
  }
  if (state?.status === "email_exists" || state?.status === "identity_retry") {
    return { step, focus: { kind: "heading", step: 1 } }
  }
  return { step, focus: null }
}

// What a submission of the form does. Step 1 (Enter in a field): "הבא".
// Step 2: the form's own check (validateJoin) blocks a submission with
// errors, shown in the step that has them; none: sent to the server.
export type SubmitDecision =
  | { kind: "next" }
  | { kind: "send" }
  | {
      kind: "show-errors"
      step: JoinStep
      errors: JoinFieldError[]
      shown: JoinFieldError[]
    }

export function submitDecision(
  step: JoinStep,
  validated: { ok: true } | { ok: false; errors: JoinFieldError[] }
): SubmitDecision {
  if (step === 1) return { kind: "next" }
  if (validated.ok) return { kind: "send" }
  const errorStep = stepForErrors(validated.errors)
  return {
    kind: "show-errors",
    step: errorStep,
    errors: validated.errors,
    shown: errorsForStep(validated.errors, errorStep),
  }
}

// The phone's back button (user decision 2026-10-07, phone check): step 2
// is a history entry of its own, so "back" there returns to step 1 instead
// of leaving the form. The entry keeps the router's state and adds joinStep.
export function stepTwoHistoryState(current: unknown): Record<string, unknown> {
  const base =
    current && typeof current === "object"
      ? (current as Record<string, unknown>)
      : {}
  return { ...base, joinStep: 2 }
}

export function isStepTwoEntry(state: unknown): boolean {
  return (
    !!state &&
    typeof state === "object" &&
    (state as Record<string, unknown>).joinStep === 2
  )
}

// The step a history entry shows (back or forward).
export function stepOfEntry(state: unknown): JoinStep {
  return isStepTwoEntry(state) ? 2 : 1
}
