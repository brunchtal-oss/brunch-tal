"use client"

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react"
import Link from "next/link"

import { PasswordInput } from "@/components/auth/password-input"
import { ContactText } from "@/components/shared/contact-text"
import { PhotoConsentQuestions } from "@/components/shared/photo-consent-fieldset"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { authCopy } from "@/lib/copy/auth"
import type { ConflictReason } from "@/lib/auth/join-link-state"
import { joinCopy, type JoinErrorKey } from "@/lib/copy/join"
import type { PhotoConsentContent } from "@/lib/content/schema"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { formatAgorot } from "@/lib/money"

import { submitJoinAction, type JoinFormState } from "./actions"
import {
  MAX_BABIES,
  validateJoin,
  type JoinField,
  type JoinFieldError,
} from "./join-input"
import {
  afterResult,
  errorsForStep,
  isStepTwoEntry,
  stepOfEntry,
  stepOneErrors,
  stepTwoHistoryState,
  submitDecision,
  type FocusRequest,
  type JoinStep,
} from "./join-steps"
import {
  conflictMessage,
  joinView,
  nextIdempotencyKey,
  type FormLinkState,
} from "./join-view"

function messageOf(message: ErrorCode | JoinErrorKey): string {
  return Object.hasOwn(joinCopy.errors, message)
    ? joinCopy.errors[message as JoinErrorKey]
    : errorMessage(message)
}

// The element that receives focus for a field error.
function fieldId(field: JoinField, index?: number): string {
  if (field === "babyName" || field === "birthDate") {
    return `${field}-${index ?? 0}`
  }
  if (field === "photoConsent" || field === "personalPhotoConsent") {
    return `${field}-yes`
  }
  return field
}

// Errors the form found itself ("הבא", or a submission it did not send),
// shown instead of the result's errors while that result is current.
type LocalCheck = { forState: JoinFormState; errors: JoinFieldError[] }

const BUTTON = "h-12 text-base"
const STEP_HEADING =
  "font-heading text-xl leading-tight font-light outline-none"

// Always rendered at the same place for every link state, so the result of
// a submission (used, expired, conflict) replaces the form in place.
export function JoinForm({
  token,
  idempotencyKey,
  linkState,
  conflictReason = null,
  contactHref = null,
  productName,
  amountAgorot,
  photoConsent,
  today,
  privacyHref = null,
}: {
  token: string
  idempotencyKey: string
  linkState: FormLinkState
  // The reason of a link that opened in conflict.
  conflictReason?: ConflictReason | null
  // Tal's WhatsApp for the contact phrase (null: plain text).
  contactHref?: string | null
  productName: string | null
  amountAgorot: number | null
  photoConsent: PhotoConsentContent
  today: string
  // The published privacy policy (story 5.5); null: the label is text.
  privacyHref?: string | null
}) {
  const [state, formAction, pending] = useActionState<JoinFormState, FormData>(
    submitJoinAction,
    null
  )
  // One id per baby row; the first row is always there.
  const [babyRows, setBabyRows] = useState<number[]>([0])
  const nextBabyId = useRef(1)
  const summaryRef = useRef<HTMLDivElement>(null)
  const stepOneHeading = useRef<HTMLHeadingElement>(null)
  const stepTwoHeading = useRef<HTMLHeadingElement>(null)
  // Removing a baby row shifts the rows after it, so the baby errors of the
  // last result no longer match their rows: hide them until the next submit.
  const [babyErrorsClearedFor, setBabyErrorsClearedFor] =
    useState<JoinFormState>(null)

  // identity_retry hands a new key; it stays for every later attempt.
  const [currentKey, setCurrentKey] = useState(idempotencyKey)
  const nextKey = nextIdempotencyKey(state, currentKey)
  if (nextKey !== currentKey) setCurrentKey(nextKey)

  // Two steps in one form (story 2.13): the inactive one is hidden, not
  // removed, so every value stays and is sent together.
  const [step, setStep] = useState<JoinStep>(1)
  const [check, setCheck] = useState<LocalCheck | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)

  // A new result of the Server Action picks the step that shows it, and
  // focus follows the usual rule (field or summary) there (afterResult).
  const [handledState, setHandledState] = useState<JoinFormState>(state)
  if (state !== handledState) {
    setHandledState(state)
    const next = afterResult(state, step)
    setStep(next.step)
    if (next.focus) setFocusRequest(next.focus)
  }

  // One error: focus moves to the field; two or more: to the summary
  // (EXPERIENCE › Accessibility Floor). A step button: the step's heading.
  useEffect(() => {
    if (!focusRequest) return
    if (focusRequest.kind === "heading") {
      const heading = focusRequest.step === 1 ? stepOneHeading : stepTwoHeading
      heading.current?.focus()
      return
    }
    const shown = focusRequest.errors
    if (shown.length === 1) {
      const [only] = shown
      document.getElementById(fieldId(only.field, only.index))?.focus()
    } else if (shown.length > 1) {
      summaryRef.current?.focus()
    }
  }, [focusRequest])

  // The phone's back button on step 2 returns to step 1 (user decision
  // 2026-10-07): step 2 has its own history entry (goToStepTwo), and
  // whenever the form is back on step 1 (back button, "חזרה" or an error
  // there) that entry is removed, so the next "back" leaves the page as
  // usual. While a submission is pending, "back" keeps step 2.
  const stepRef = useRef(step)
  const pendingRef = useRef(pending)
  useEffect(() => {
    stepRef.current = step
    pendingRef.current = pending
    if (step === 1 && isStepTwoEntry(window.history.state)) {
      window.history.back()
    }
  }, [step, pending])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const entryStep = stepOfEntry(event.state)
      if (entryStep === stepRef.current) return
      if (pendingRef.current && stepRef.current === 2) {
        window.history.pushState(stepTwoHistoryState(event.state), "")
        return
      }
      setStep(entryStep)
      setFocusRequest({ kind: "heading", step: entryStep })
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const view = joinView(state, linkState)

  if (view === "used" || view === "joined") {
    return (
      <div aria-live="polite" className="flex flex-col gap-4">
        <Alert>
          <AlertTitle className="whitespace-normal">
            {view === "joined" ? joinCopy.joined : joinCopy.used}
          </AlertTitle>
        </Alert>
        <Link
          href="/login?next=/me"
          className={buttonVariants({ size: "lg", className: BUTTON })}
        >
          {joinCopy.goToLogin}
        </Link>
      </div>
    )
  }

  if (view === "expired" || view === "conflict") {
    return (
      <Alert aria-live="polite">
        <AlertTitle className="whitespace-normal">
          {view === "expired" ? (
            <ContactText
              text={errorMessage("LINK_EXPIRED")}
              href={contactHref}
              phrase={joinCopy.expiredContactPhrase}
            />
          ) : (
            <ContactText
              text={conflictMessage(
                state?.status === "conflict" ? state.reason : conflictReason
              )}
              href={contactHref}
              phrase={joinCopy.contactPhrase}
            />
          )}
        </AlertTitle>
      </Alert>
    )
  }

  const resultErrors: JoinFieldError[] =
    state?.status !== "error"
      ? []
      : babyErrorsClearedFor === state
        ? state.errors.filter(
            (error) => error.field !== "babyName" && error.field !== "birthDate"
          )
        : state.errors
  const allErrors =
    check && check.forState === state ? check.errors : resultErrors
  // Only the errors of the visible step are shown.
  const errors = errorsForStep(allErrors, step)
  const formError =
    state?.status === "error" && state.errors.length === 0 ? state.code : null

  const errorFor = (field: JoinField, index?: number) =>
    errors.find(
      (error) =>
        error.field === field && (index === undefined || error.index === index)
    )

  // Props of an input with its label, error and description wiring.
  const wiring = (field: JoinField, index?: number, hintId?: string) => {
    const error = errorFor(field, index)
    const id = fieldId(field, index)
    return {
      error,
      errorId: `${id}-error`,
      inputProps: {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? `${id}-error` : hintId,
      },
    }
  }

  // "הבא": the step 1 fields under the server's rules (validateJoin), with
  // only their errors shown; none: on to step 2.
  const goToStepTwo = (form: HTMLFormElement) => {
    const result = validateJoin(new FormData(form))
    const found = result.ok ? [] : stepOneErrors(result.errors)
    if (found.length > 0) {
      setCheck({ forState: state, errors: found })
      setFocusRequest({ kind: "errors", errors: found })
      return
    }
    // The step 1 errors of the last result are fixed; its step 2 ones stay.
    setCheck({ forState: state, errors: errorsForStep(resultErrors, 2) })
    if (!isStepTwoEntry(window.history.state)) {
      window.history.pushState(stepTwoHistoryState(window.history.state), "")
    }
    setStep(2)
    setFocusRequest({ kind: "heading", step: 2 })
  }

  // Not while a submission is pending: its result is shown against the
  // values that were sent.
  const goToStepOne = () => {
    if (pending) return
    setStep(1)
    setFocusRequest({ kind: "heading", step: 1 })
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    // Dispatched by hand (not <form action>), so React does not reset the
    // fields after a failed submission: values stay as typed.
    const data = new FormData(event.currentTarget)
    // Step 1 (Enter in a field) is "הבא"; in step 2 a missing answer is
    // shown here and never sent (submitDecision).
    const decision = submitDecision(step, validateJoin(data))
    if (decision.kind === "next") {
      goToStepTwo(event.currentTarget)
      return
    }
    if (decision.kind === "show-errors") {
      setCheck({ forState: state, errors: decision.errors })
      setStep(decision.step)
      setFocusRequest({ kind: "errors", errors: decision.shown })
      return
    }
    setCheck(null)
    startTransition(() => formAction(data))
  }

  const fullName = wiring("fullName")
  const phone = wiring("phone")
  const email = wiring("email", undefined, "email-hint")
  const dietary = wiring("dietaryNotes", undefined, "dietary-hint")
  const password = wiring("password", undefined, "password-hint")
  const confirm = wiring("confirm")
  const privacy = wiring("privacy")
  const photo = errorFor("photoConsent")
  const personalPhoto = errorFor("personalPhotoConsent")

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="idempotencyKey" value={nextKey} />

      {productName && amountAgorot !== null && (
        <p className="text-base font-semibold">
          {productName} · <bdi>{formatAgorot(amountAgorot)}</bdi>
        </p>
      )}

      {errors.length > 1 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-xl bg-error-tint px-4 py-3 text-[15px] text-error"
        >
          <p className="font-semibold">
            {joinCopy.errorSummary(errors.length)}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {errors.map((error) => (
              <li key={`${error.field}-${error.index ?? ""}`}>
                <a
                  href={`#${fieldId(error.field, error.index)}`}
                  className="underline"
                >
                  {messageOf(error.message)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div hidden={step !== 1} data-step="1" className="flex flex-col gap-5">
        <h2 ref={stepOneHeading} tabIndex={-1} className={STEP_HEADING}>
          {joinCopy.stepOneTitle}
        </h2>

        {state?.status === "identity_retry" && (
          <Alert variant="destructive">
            <AlertDescription>
              <ContactText
                text={joinCopy.identityRetry}
                href={contactHref}
                phrase={joinCopy.contactPhrase}
              />
            </AlertDescription>
          </Alert>
        )}

        {state?.status === "email_exists" && (
          <Alert variant="destructive">
            <AlertDescription>
              <ContactText
                text={joinCopy.emailExists}
                href={contactHref}
                phrase={joinCopy.contactShortPhrase}
              />
            </AlertDescription>
          </Alert>
        )}

        <Field data-invalid={fullName.error ? true : undefined}>
          <FieldLabel htmlFor="fullName">
            {joinCopy.fullName} {authCopy.required}
          </FieldLabel>
          <Input
            {...fullName.inputProps}
            name="fullName"
            autoComplete="name"
            maxLength={200}
            required
            aria-required
            className="h-12 text-base"
          />
          {fullName.error && (
            <FieldError id={fullName.errorId}>
              {messageOf(fullName.error.message)}
            </FieldError>
          )}
        </Field>

        <Field data-invalid={phone.error ? true : undefined}>
          <FieldLabel htmlFor="phone">
            {joinCopy.phone} {authCopy.required}
          </FieldLabel>
          <Input
            {...phone.inputProps}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            required
            aria-required
            className="h-12 text-start text-base"
          />
          {phone.error && (
            <FieldError id={phone.errorId}>
              {messageOf(phone.error.message)}
            </FieldError>
          )}
        </Field>

        <Field data-invalid={email.error ? true : undefined}>
          <FieldLabel htmlFor="email">
            {joinCopy.email} {authCopy.required}
          </FieldLabel>
          <Input
            {...email.inputProps}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            required
            aria-required
            className="h-12 text-start text-base"
          />
          {email.error ? (
            <FieldError id={email.errorId}>
              {messageOf(email.error.message)}
            </FieldError>
          ) : (
            <FieldDescription id="email-hint">
              {joinCopy.emailHint}
            </FieldDescription>
          )}
        </Field>

        {babyRows.map((rowId, index) => {
          const name = wiring("babyName", index)
          const birth = wiring("birthDate", index)
          return (
            <div key={rowId} className="flex flex-col gap-5">
              <Field data-invalid={name.error ? true : undefined}>
                <FieldLabel htmlFor={name.inputProps.id}>
                  {joinCopy.babyName} {authCopy.required}
                </FieldLabel>
                <Input
                  {...name.inputProps}
                  name="babyName"
                  maxLength={100}
                  required
                  aria-required
                  className="h-12 text-base"
                />
                {name.error && (
                  <FieldError id={name.errorId}>
                    {messageOf(name.error.message)}
                  </FieldError>
                )}
              </Field>
              <Field data-invalid={birth.error ? true : undefined}>
                <FieldLabel htmlFor={birth.inputProps.id}>
                  {joinCopy.birthDate} {authCopy.required}
                </FieldLabel>
                <Input
                  {...birth.inputProps}
                  name="birthDate"
                  type="date"
                  max={today}
                  required
                  aria-required
                  className="h-12 text-base"
                />
                {birth.error && (
                  <FieldError id={birth.errorId}>
                    {messageOf(birth.error.message)}
                  </FieldError>
                )}
              </Field>
              {index > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="self-start"
                  onClick={() => {
                    setBabyRows((rows) => rows.filter((id) => id !== rowId))
                    setBabyErrorsClearedFor(state)
                    // The form's own baby errors point at shifted rows too.
                    setCheck(
                      (current) =>
                        current && {
                          ...current,
                          errors: current.errors.filter(
                            (error) =>
                              error.field !== "babyName" &&
                              error.field !== "birthDate"
                          ),
                        }
                    )
                  }}
                >
                  {joinCopy.removeBaby}
                </Button>
              )}
            </div>
          )
        })}

        {babyRows.length < MAX_BABIES && (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              setBabyRows((rows) => [...rows, nextBabyId.current++])
            }
          >
            {joinCopy.addBaby}
          </Button>
        )}

        <Field data-invalid={dietary.error ? true : undefined}>
          <FieldLabel htmlFor="dietaryNotes">
            {joinCopy.dietaryNotes}
          </FieldLabel>
          {/* The hint stays under the label, also next to an error. */}
          <FieldDescription id="dietary-hint">
            {joinCopy.dietaryHint}
          </FieldDescription>
          <Textarea
            {...dietary.inputProps}
            aria-describedby={
              dietary.error ? `dietary-hint ${dietary.errorId}` : "dietary-hint"
            }
            name="dietaryNotes"
            maxLength={2000}
            placeholder={joinCopy.dietaryPlaceholder}
            className="min-h-24 text-base"
          />
          {dietary.error && (
            <FieldError id={dietary.errorId}>
              {messageOf(dietary.error.message)}
            </FieldError>
          )}
        </Field>

        <Field data-invalid={password.error ? true : undefined}>
          <FieldLabel htmlFor="password">
            {joinCopy.password} {authCopy.required}
          </FieldLabel>
          <PasswordInput
            {...password.inputProps}
            name="password"
            autoComplete="new-password"
            required
            aria-required
          />
          {password.error ? (
            <FieldError id={password.errorId}>
              {messageOf(password.error.message)}
            </FieldError>
          ) : (
            <FieldDescription id="password-hint">
              {authCopy.reset.passwordHint}
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={confirm.error ? true : undefined}>
          <FieldLabel htmlFor="confirm">
            {joinCopy.confirmPassword} {authCopy.required}
          </FieldLabel>
          <PasswordInput
            {...confirm.inputProps}
            name="confirm"
            autoComplete="new-password"
            required
            aria-required
          />
          {confirm.error && (
            <FieldError id={confirm.errorId}>
              {messageOf(confirm.error.message)}
            </FieldError>
          )}
        </Field>

        <Field data-invalid={privacy.error ? true : undefined}>
          <div className="flex items-start gap-3">
            <input
              {...privacy.inputProps}
              type="checkbox"
              name="privacyConsent"
              required
              aria-required
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <label htmlFor="privacy" className="text-base">
              {privacyHref ? (
                <>
                  {joinCopy.privacyConsentLead}
                  <a
                    href={privacyHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline underline-offset-4"
                  >
                    {joinCopy.privacyConsentLink}
                    <span className="sr-only"> {joinCopy.opensOutside}</span>
                  </a>
                </>
              ) : (
                joinCopy.privacyConsent
              )}{" "}
              {authCopy.required}
            </label>
          </div>
          {privacy.error && (
            <FieldError id={privacy.errorId}>
              {messageOf(privacy.error.message)}
            </FieldError>
          )}
        </Field>

        <Button
          type="button"
          size="lg"
          className={BUTTON}
          onClick={(event) => {
            const form = event.currentTarget.form
            if (form) goToStepTwo(form)
          }}
        >
          {joinCopy.next}
        </Button>
      </div>

      <div hidden={step !== 2} data-step="2" className="flex flex-col gap-5">
        <h2 ref={stepTwoHeading} tabIndex={-1} className={STEP_HEADING}>
          {joinCopy.stepTwoTitle}
        </h2>

        <PhotoConsentQuestions
          content={photoConsent}
          errors={{
            atmosphere: photo ? messageOf(photo.message) : undefined,
            personal: personalPhoto
              ? messageOf(personalPhoto.message)
              : undefined,
          }}
        />

        {formError && (
          <Alert variant="destructive">
            <AlertDescription>
              <ContactText
                text={errorMessage(formError)}
                href={contactHref}
                phrase={joinCopy.contactPhrase}
              />
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          size="lg"
          className={BUTTON}
          aria-busy={pending || undefined}
          aria-disabled={pending || undefined}
        >
          {pending && <Spinner aria-hidden />}
          {joinCopy.submit}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className={BUTTON}
          aria-disabled={pending || undefined}
          onClick={goToStepOne}
        >
          {joinCopy.back}
        </Button>
      </div>
    </form>
  )
}
