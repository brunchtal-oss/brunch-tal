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
import type { JoinLinkState } from "@/lib/auth/join-link-state"
import { authCopy } from "@/lib/copy/auth"
import { joinCopy, type JoinErrorKey } from "@/lib/copy/join"
import type { PhotoConsentContent } from "@/lib/content/schema"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { formatAgorot } from "@/lib/money"

import { submitJoinAction, type JoinFormState } from "./actions"
import { MAX_BABIES, type JoinField, type JoinFieldError } from "./join-input"
import { joinView } from "./join-view"

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
  if (field === "photoConsent") return "photoConsent-yes"
  return field
}

const BUTTON = "h-12 text-base"

// Always rendered at the same place for every link state, so the result of
// a submission (used, expired, conflict) replaces the form in place.
export function JoinForm({
  token,
  idempotencyKey,
  linkState,
  productName,
  amountAgorot,
  photoConsent,
  today,
}: {
  token: string
  idempotencyKey: string
  linkState: JoinLinkState
  productName: string | null
  amountAgorot: number | null
  photoConsent: PhotoConsentContent
  today: string
}) {
  const [state, formAction, pending] = useActionState<JoinFormState, FormData>(
    submitJoinAction,
    null
  )
  // One id per baby row; the first row is always there.
  const [babyRows, setBabyRows] = useState<number[]>([0])
  const nextBabyId = useRef(1)
  const summaryRef = useRef<HTMLDivElement>(null)
  // Removing a baby row shifts the rows after it, so the baby errors of the
  // last result no longer match their rows: hide them until the next submit.
  const [babyErrorsClearedFor, setBabyErrorsClearedFor] =
    useState<JoinFormState>(null)

  const view = joinView(state, linkState)
  const errors: JoinFieldError[] =
    state?.status !== "error"
      ? []
      : babyErrorsClearedFor === state
        ? state.errors.filter(
            (error) => error.field !== "babyName" && error.field !== "birthDate"
          )
        : state.errors
  const formError =
    state?.status === "error" && state.errors.length === 0 ? state.code : null

  // One error: focus moves to the field; two or more: to the summary
  // (EXPERIENCE › Accessibility Floor).
  useEffect(() => {
    if (state?.status !== "error" || state.errors.length === 0) return
    if (state.errors.length === 1) {
      const [only] = state.errors
      document.getElementById(fieldId(only.field, only.index))?.focus()
    } else {
      summaryRef.current?.focus()
    }
  }, [state])

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
          {view === "expired"
            ? errorMessage("LINK_EXPIRED")
            : joinCopy.conflict}
        </AlertTitle>
      </Alert>
    )
  }

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

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    // Dispatched by hand (not <form action>), so React does not reset the
    // fields after a failed submission: values stay as typed.
    const data = new FormData(event.currentTarget)
    startTransition(() => formAction(data))
  }

  const fullName = wiring("fullName")
  const phone = wiring("phone")
  const email = wiring("email", undefined, "email-hint")
  const dietary = wiring("dietaryNotes")
  const password = wiring("password", undefined, "password-hint")
  const confirm = wiring("confirm")
  const privacy = wiring("privacy")
  const photo = errorFor("photoConsent")
  const questionLines = photoConsent.question.split("\n")

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

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
          onClick={() => setBabyRows((rows) => [...rows, nextBabyId.current++])}
        >
          {joinCopy.addBaby}
        </Button>
      )}

      <Field data-invalid={dietary.error ? true : undefined}>
        <FieldLabel htmlFor="dietaryNotes">{joinCopy.dietaryNotes}</FieldLabel>
        <Textarea
          {...dietary.inputProps}
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
            {joinCopy.privacyConsent} {authCopy.required}
          </label>
        </div>
        {privacy.error && (
          <FieldError id={privacy.errorId}>
            {messageOf(privacy.error.message)}
          </FieldError>
        )}
      </Field>

      <fieldset
        role="radiogroup"
        aria-required
        aria-invalid={photo ? true : undefined}
        aria-describedby={photo ? "photoConsent-error" : undefined}
        className="flex flex-col gap-3"
      >
        <legend className="mb-3 text-base">
          {questionLines.map((line, index) => (
            <span key={index} className="block">
              {line}
            </span>
          ))}
        </legend>
        {(
          [
            ["yes", photoConsent.yes_label],
            ["no", photoConsent.no_label],
          ] as const
        ).map(([value, label]) => (
          <div key={value} className="flex items-center gap-3">
            <input
              id={`photoConsent-${value}`}
              type="radio"
              name="photoConsent"
              value={value}
              required
              className="size-5 shrink-0 accent-primary"
            />
            <label htmlFor={`photoConsent-${value}`} className="text-base">
              {label}
            </label>
          </div>
        ))}
        {photo && (
          <p id="photoConsent-error" className="text-sm text-destructive">
            {messageOf(photo.message)}
          </p>
        )}
      </fieldset>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(formError)}</AlertDescription>
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
    </form>
  )
}
