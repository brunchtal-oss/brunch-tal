"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { PasswordInput } from "@/components/auth/password-input"
import { ContactText } from "@/components/shared/contact-text"
import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { cubeTitleClass } from "@/components/shared/section-title"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { SpecialBrunchFieldset } from "@/components/shared/special-brunch-fieldset"
import type { SpecialBrunchContent } from "@/lib/content/schema"
import { customerCopy } from "@/lib/copy/customer"
import { joinCopy } from "@/lib/copy/join"
import { MAX_EMAIL_LENGTH } from "@/lib/email"
import { errorMessage, type ErrorCode, type ErrorDetail } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import {
  SPECIAL_BRUNCH_FIELD,
  specialBrunchLabels,
  type SpecialBrunchCode,
} from "@/lib/special-brunch"

import { updateDetails, updateDetailsWithEmailAction } from "./actions"
import { EmailRow } from "./email-row"
import { toastSaved } from "./profile-toaster"

const copy = customerCopy.profile
const INPUT = "h-12 text-start text-base"

// The customer's details (story 2.10): name and dietary notes, editable
// together. Story 6.11 (user decision 2026-11-12): the edit form also
// holds her email (a change needs the new address twice and her current
// password) and shows the phone read only, with the way to ask for a
// change; the view shows both under a line. An empty field shows nothing, but the
// dietary row, which says where to add them. No
// optimistic update: the view shows what the server returned after the
// save (revalidatePath). A cube (DESIGN › card) with a cube title (fix 11,
// user decision 2026-10-20). Story 2.16: the special-brunch question is
// part of the details (the join form's fieldset, her answers checked).
export function DetailsSection({
  fullName,
  dietaryNotes,
  specialBrunch,
  specialBrunchInterests,
  phone,
  email,
  emailVerified = false,
  contactHref = null,
  defaultEditing = false,
}: {
  fullName: string
  dietaryNotes: string | null
  specialBrunch: SpecialBrunchContent
  specialBrunchInterests: SpecialBrunchCode[]
  phone: string | null
  email: string | null
  // Story 6.11: get_my_email_verified (never true without the record).
  emailVerified?: boolean
  // The business WhatsApp, for the phone's note (null: plain text).
  contactHref?: string | null
  // Opens in the edit form (a static render in tests).
  defaultEditing?: boolean
}) {
  const [editing, setEditing] = useState(defaultEditing)
  const [error, setError] = useState<{
    code: ErrorCode
    detail?: ErrorDetail
  } | null>(null)
  const [pending, startTransition] = useTransition()
  // Story 6.11: the email part of the form.
  const [emailChanged, setEmailChanged] = useState(false)
  const [changedTo, setChangedTo] = useState<string | null>(null)
  const [key, setKey] = useState(() => newIdempotencyKey())
  const editRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  // Set when the form closes, so focus goes back to "עריכה" (not on load).
  const returnFocus = useRef(false)

  // Opening moves focus to the name field; closing returns it to "עריכה".
  useEffect(() => {
    if (editing) {
      nameRef.current?.focus()
    } else if (returnFocus.current) {
      returnFocus.current = false
      editRef.current?.focus()
    }
  }, [editing])

  const close = () => {
    returnFocus.current = true
    setError(null)
    setEmailChanged(false)
    setEditing(false)
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    const newEmail = String(data.get("email") ?? "")
    // The email part only when the address really changed.
    const withEmail = email !== null && emailDiffers(newEmail, email)
    startTransition(async () => {
      if (!withEmail) {
        const result = await updateDetails(detailsInput(data))
        if (result.ok) {
          close()
          toastSaved()
        } else {
          setError({ code: result.code, detail: result.detail })
        }
        return
      }
      const result = await updateDetailsWithEmailAction({
        ...detailsInput(data),
        email: newEmail,
        confirm: String(data.get("confirmEmail") ?? ""),
        password: String(data.get("currentPassword") ?? ""),
        idempotencyKey: key,
      })
      // A new key after every answer (one key per call).
      setKey(newIdempotencyKey())
      if (result.ok) {
        setChangedTo(result.data.email)
        close()
      } else {
        setError({ code: result.code, detail: result.detail })
      }
    })
  }

  const field = error?.detail?.field ?? null
  const nameError = !!error && field === "full_name"
  const notesError = !!error && field === "dietary_notes"
  const interestsError = !!error && field === "special_brunch_interests"
  // An error that one of the fields shows (the contact part's included).
  const fieldError =
    !!error &&
    (!!field ||
      error.code === "EMAIL_TAKEN" ||
      error.code === "EMAIL_UNCHANGED" ||
      error.code === "WRONG_PASSWORD")
  const interestLabels = specialBrunchLabels(
    specialBrunch,
    specialBrunchInterests
  )

  return (
    <section
      aria-labelledby="details-title"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="details-title" className={cubeTitleClass}>
          {copy.detailsTitle}
        </h2>
        {!editing && (
          <Button
            ref={editRef}
            type="button"
            variant="ghost"
            className="min-h-11 underline underline-offset-4"
            onClick={() => {
              setError(null)
              setChangedTo(null)
              setKey(newIdempotencyKey())
              setEditing(true)
            }}
          >
            {copy.edit}
            <span className="sr-only">{copy.detailsSuffix}</span>
          </Button>
        )}
      </div>

      {editing ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
          <Field data-invalid={nameError || undefined}>
            <FieldLabel htmlFor="fullName">{copy.fullName}</FieldLabel>
            <Input
              ref={nameRef}
              id="fullName"
              name="fullName"
              autoComplete="name"
              defaultValue={fullName}
              maxLength={200}
              required
              aria-required
              aria-invalid={nameError || undefined}
              aria-describedby={nameError ? "fullName-error" : undefined}
              className="h-12 text-base"
            />
            {nameError && (
              <FieldError id="fullName-error">
                {errorMessage(error!.code)}
              </FieldError>
            )}
          </Field>
          <Field data-invalid={notesError || undefined}>
            <FieldLabel htmlFor="dietaryNotes">{copy.dietaryNotes}</FieldLabel>
            <Textarea
              id="dietaryNotes"
              name="dietaryNotes"
              defaultValue={dietaryNotes ?? ""}
              maxLength={2000}
              placeholder={joinCopy.dietaryPlaceholder}
              aria-invalid={notesError || undefined}
              aria-describedby={notesError ? "dietaryNotes-error" : undefined}
              className="min-h-24 text-base"
            />
            {notesError && (
              <FieldError id="dietaryNotes-error">
                {errorMessage("INVALID_INPUT")}
              </FieldError>
            )}
          </Field>
          <SpecialBrunchFieldset
            content={specialBrunch}
            defaultValue={specialBrunchInterests}
            error={interestsError ? errorMessage("INVALID_INPUT") : undefined}
          />
          {(phone || email !== null) && (
            <ContactFields
              phone={phone}
              email={email}
              contactHref={contactHref}
              emailChanged={emailChanged}
              onEmailInput={(value) =>
                setEmailChanged(emailDiffers(value, email))
              }
              error={error}
            />
          )}
          {error && !fieldError && (
            <InlineNotice tone="error">{errorMessage(error.code)}</InlineNotice>
          )}
          <FormButtons pending={pending} onCancel={close} />
        </form>
      ) : (
        <dl className="flex flex-col gap-3">
          <Row label={copy.fullName}>
            <bdi className="break-words">{fullName}</bdi>
          </Row>
          {/* Shown when empty too, so she knows where to add them (phone
              check, user decision 2026-10-21). */}
          <Row label={copy.dietaryNotes}>
            {dietaryNotes?.trim() ? (
              <bdi className="break-words whitespace-pre-line">
                {dietaryNotes}
              </bdi>
            ) : (
              <span className="text-muted-foreground">
                {copy.dietaryNotesEmpty}
              </span>
            )}
          </Row>
          <Row label={copy.specialBrunch}>
            {interestLabels.length > 0 ? (
              interestLabels.join(" · ")
            ) : (
              <span className="text-muted-foreground">
                {copy.specialBrunchEmpty}
              </span>
            )}
          </Row>
        </dl>
      )}

      {!editing && (phone || email) && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <dl className="flex flex-col gap-3">
            {phone && (
              <Row label={copy.phone}>
                <bdi dir="ltr">{phone}</bdi>
              </Row>
            )}
            {/* Story 6.11: the verified state; the change is in the form. */}
            {email && (
              <EmailRow
                email={email}
                verified={emailVerified}
                changedTo={changedTo}
              />
            )}
          </dl>
        </div>
      )}
    </section>
  )
}

// Story 6.11 (user decision 2026-11-12): the contact part of the edit form.
// The phone is read only (the source document, line 169: a phone change
// goes through Tal), with the way to ask. The email is a field with her
// address; once it differs, the new address again and her current
// password open under it (both required for a change).
function ContactFields({
  phone,
  email,
  contactHref,
  emailChanged,
  onEmailInput,
  error,
}: {
  phone: string | null
  email: string | null
  contactHref: string | null
  emailChanged: boolean
  onEmailInput: (value: string) => void
  error: { code: ErrorCode; detail?: ErrorDetail } | null
}) {
  const field = error?.detail?.field ?? null
  const emailError =
    !!error &&
    (field === "email" ||
      error.code === "EMAIL_TAKEN" ||
      error.code === "EMAIL_UNCHANGED")
  const confirmError = !!error && field === "confirm"
  const passwordError =
    !!error && (field === "password" || error.code === "WRONG_PASSWORD")

  return (
    <div className="flex flex-col gap-6 border-t border-border pt-5">
      {phone && (
        <div className="flex flex-col gap-1">
          <span className="text-[15px] text-muted-foreground">
            {copy.phone}
          </span>
          <bdi dir="ltr" className="text-base">
            {phone}
          </bdi>
          <span className="text-[15px] text-muted-foreground">
            <ContactText
              text={copy.phoneChangeNote}
              href={contactHref}
              phrase={copy.contactPhrase}
            />
          </span>
        </div>
      )}
      {email !== null && (
        <>
          <Field data-invalid={emailError || undefined}>
            <FieldLabel htmlFor="email">{copy.email}</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              defaultValue={email}
              maxLength={MAX_EMAIL_LENGTH}
              required
              aria-required
              aria-invalid={emailError || undefined}
              aria-describedby={emailError ? "email-error" : undefined}
              onChange={(event) => onEmailInput(event.currentTarget.value)}
              className={INPUT}
            />
            {emailError && (
              <FieldError id="email-error">
                {errorMessage(error!.code)}
              </FieldError>
            )}
          </Field>
          {emailChanged && (
            <>
              <Field data-invalid={confirmError || undefined}>
                <FieldLabel htmlFor="confirmEmail">
                  {copy.confirmEmail}
                </FieldLabel>
                <Input
                  id="confirmEmail"
                  name="confirmEmail"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  dir="ltr"
                  maxLength={MAX_EMAIL_LENGTH}
                  required
                  aria-required
                  aria-invalid={confirmError || undefined}
                  aria-describedby={
                    confirmError ? "confirmEmail-error" : undefined
                  }
                  className={INPUT}
                />
                {confirmError && (
                  <FieldError id="confirmEmail-error">
                    {errorMessage(error!.code)}
                  </FieldError>
                )}
              </Field>
              <Field data-invalid={passwordError || undefined}>
                <FieldLabel htmlFor="currentPassword">
                  {copy.currentPassword}
                </FieldLabel>
                <PasswordInput
                  id="currentPassword"
                  name="currentPassword"
                  autoComplete="current-password"
                  required
                  aria-required
                  aria-invalid={passwordError || undefined}
                  aria-describedby={
                    passwordError ? "currentPassword-error" : undefined
                  }
                />
                {passwordError && (
                  <FieldError id="currentPassword-error">
                    {errorMessage(error!.code)}
                  </FieldError>
                )}
              </Field>
            </>
          )}
        </>
      )}
    </div>
  )
}

// Whether the field holds another address than hers (case and spaces
// aside, as the server compares).
export function emailDiffers(value: string, email: string | null): boolean {
  return value.trim().toLowerCase() !== (email ?? "").trim().toLowerCase()
}

// What the details form sends to updateDetails: every checked special
// brunch (none = [], which clears them).
export function detailsInput(
  data: FormData
): Parameters<typeof updateDetails>[0] {
  return {
    fullName: String(data.get("fullName") ?? ""),
    dietaryNotes: String(data.get("dietaryNotes") ?? ""),
    specialBrunchInterests: data
      .getAll(SPECIAL_BRUNCH_FIELD)
      .map((value) => String(value)),
  }
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[15px] text-muted-foreground">{label}</dt>
      <dd className="text-base">{children}</dd>
    </div>
  )
}

// Save and cancel of an inline edit form (details and babies).
export function FormButtons({
  pending,
  onCancel,
}: {
  pending: boolean
  onCancel: () => void
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <OnlineButton
        type="submit"
        size="lg"
        className="h-12 min-w-32 text-base"
        aria-disabled={pending || undefined}
      >
        {pending && <Spinner aria-hidden />}
        {pending ? copy.saving : copy.save}
      </OnlineButton>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 text-base"
        disabled={pending}
        onClick={onCancel}
      >
        {copy.cancel}
      </Button>
    </div>
  )
}
