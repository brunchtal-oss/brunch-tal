"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { customerCopy } from "@/lib/copy/customer"
import { joinCopy } from "@/lib/copy/join"
import { errorMessage, type ErrorCode, type ErrorDetail } from "@/lib/errors"

import { updateDetails } from "./actions"
import { toastSaved } from "./profile-toaster"

const copy = customerCopy.profile

// The customer's details (story 2.10): name and dietary notes, editable
// together; phone and email read-only, with no contact line (user
// decision 2026-10-06). An empty field shows nothing. No
// optimistic update: the view shows what the server returned after the
// save (revalidatePath).
export function DetailsSection({
  fullName,
  dietaryNotes,
  phone,
  email,
}: {
  fullName: string
  dietaryNotes: string | null
  phone: string | null
  email: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<{
    code: ErrorCode
    detail?: ErrorDetail
  } | null>(null)
  const [pending, startTransition] = useTransition()
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
    setEditing(false)
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await updateDetails({
        fullName: String(data.get("fullName") ?? ""),
        dietaryNotes: String(data.get("dietaryNotes") ?? ""),
      })
      if (result.ok) {
        close()
        toastSaved()
      } else {
        setError({ code: result.code, detail: result.detail })
      }
    })
  }

  const field = error?.detail?.field ?? null
  const nameError = !!error && field === "full_name"
  const notesError = !!error && field === "dietary_notes"

  return (
    <section aria-labelledby="details-title" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="details-title"
          className="font-heading text-[22px] leading-[1.25] font-light"
        >
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
          {error && !nameError && !notesError && (
            <InlineNotice tone="error">{errorMessage(error.code)}</InlineNotice>
          )}
          <FormButtons pending={pending} onCancel={close} />
        </form>
      ) : (
        <dl className="flex flex-col gap-3">
          <Row label={copy.fullName}>
            <bdi className="break-words">{fullName}</bdi>
          </Row>
          {dietaryNotes && (
            <Row label={copy.dietaryNotes}>
              <bdi className="break-words whitespace-pre-line">
                {dietaryNotes}
              </bdi>
            </Row>
          )}
        </dl>
      )}

      {(phone || email) && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <dl className="flex flex-col gap-3">
            {phone && (
              <Row label={copy.phone}>
                <bdi dir="ltr">{phone}</bdi>
              </Row>
            )}
            {email && (
              <Row label={copy.email}>
                <bdi dir="ltr" className="break-all">
                  {email}
                </bdi>
              </Row>
            )}
          </dl>
        </div>
      )}
    </section>
  )
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
      <Button
        type="submit"
        size="lg"
        className="h-12 min-w-32 text-base"
        aria-disabled={pending || undefined}
      >
        {pending && <Spinner aria-hidden />}
        {pending ? copy.saving : copy.save}
      </Button>
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
