"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { babyAgeText } from "@/lib/copy/baby-age"
import { customerCopy } from "@/lib/copy/customer"
import {
  errorMessage,
  type ActionResult,
  type ErrorCode,
  type ErrorDetail,
} from "@/lib/errors"
import { babyAge, formatFullDate } from "@/lib/time"

import { addBaby, deleteBaby, updateBaby } from "./actions"
import { FormButtons } from "./details-section"
import { toastSaved } from "./profile-toaster"

const copy = customerCopy.profile

// The same limit as private.babies_guard (the database decides).
const MAX_BABIES = 10

export type ProfileBaby = { id: string; name: string; birthDate: string }

type Failure = { code: ErrorCode; detail?: ErrorDetail }

// The customer's babies (story 2.10): one row each, "{name} · {age}" (the
// age on the local today, display only) and the birth date; edit opens the
// row's fields in place, delete asks once in the row. With one baby left
// there is no delete button (the database refuses it too, LAST_BABY).
// "+ תינוק נוסף" opens an empty pair of fields.
export function BabiesSection({
  babies,
  today,
}: {
  babies: readonly ProfileBaby[]
  today: string
}) {
  // The row being edited or confirmed for delete, or "new".
  const [open, setOpen] = useState<
    { kind: "edit" | "delete"; id: string } | { kind: "new" } | null
  >(null)
  const [error, setError] = useState<Failure | null>(null)
  const [pending, startTransition] = useTransition()
  // The id of the element that gets focus back when the open form or
  // confirmation closes: the row's "עריכה", or "+ תינוק נוסף".
  const returnFocusTo = useRef<string | null>(null)

  // Opening moves focus into the form (its first field) or to the delete
  // confirmation's button; closing returns it where it came from, when that
  // element still exists (a deleted row has none).
  useEffect(() => {
    if (open?.kind === "delete") {
      document.getElementById(`baby-delete-confirm-${open.id}`)?.focus()
    } else if (open) {
      const id = open.kind === "new" ? "new" : open.id
      document.getElementById(`babyName-${id}`)?.focus()
    } else if (returnFocusTo.current) {
      document.getElementById(returnFocusTo.current)?.focus()
      returnFocusTo.current = null
    }
  }, [open])

  const closeOpen = () => {
    returnFocusTo.current =
      open === null
        ? null
        : open.kind === "new"
          ? "baby-add"
          : `baby-edit-${open.id}`
    setError(null)
    setOpen(null)
  }

  const run = (action: () => Promise<ActionResult>) => {
    if (pending) return
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        closeOpen()
        toastSaved()
      } else {
        setError({ code: result.code, detail: result.detail })
      }
    })
  }

  const close = () => {
    if (!pending) closeOpen()
  }

  // The row's id comes from the form (empty for a new baby).
  const submitBaby = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const id = String(data.get("babyId") ?? "")
    const fields = {
      name: String(data.get("babyName") ?? ""),
      birthDate: String(data.get("birthDate") ?? ""),
    }
    run(() => (id ? updateBaby({ id, ...fields }) : addBaby(fields)))
  }

  const canDelete = babies.length > 1

  return (
    <section aria-labelledby="babies-title" className="flex flex-col gap-4">
      <h2
        id="babies-title"
        className="font-heading text-[22px] leading-[1.25] font-light"
      >
        {copy.babiesTitle}
      </h2>

      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {babies.map((baby) => {
          const editing = open?.kind === "edit" && open.id === baby.id
          const confirming = open?.kind === "delete" && open.id === baby.id
          return (
            <li key={baby.id} className="py-3">
              {editing ? (
                <BabyForm
                  id={baby.id}
                  baby={baby}
                  today={today}
                  error={error}
                  pending={pending}
                  onSubmit={submitBaby}
                  onCancel={close}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-[17px] leading-snug font-semibold">
                        <bdi className="break-words">
                          {copy.babyLine(
                            baby.name,
                            babyAgeText(babyAge(baby.birthDate, today))
                          )}
                        </bdi>
                      </p>
                      <p className="text-[15px] text-muted-foreground">
                        <time dateTime={baby.birthDate}>
                          {copy.bornOn(formatFullDate(baby.birthDate))}
                        </time>
                      </p>
                    </div>
                    {!confirming && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          id={`baby-edit-${baby.id}`}
                          type="button"
                          variant="ghost"
                          className="min-h-11 underline underline-offset-4"
                          onClick={() => {
                            setError(null)
                            setOpen({ kind: "edit", id: baby.id })
                          }}
                        >
                          {copy.edit}
                          <span className="sr-only">
                            {copy.babySuffix(baby.name)}
                          </span>
                        </Button>
                        {canDelete && (
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-11 text-error underline underline-offset-4"
                            onClick={() => {
                              setError(null)
                              setOpen({ kind: "delete", id: baby.id })
                            }}
                          >
                            {copy.deleteBaby}
                            <span className="sr-only">
                              {copy.babySuffix(baby.name)}
                            </span>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {confirming && (
                    <div
                      role="group"
                      aria-label={copy.deleteBabyOf(baby.name)}
                      className="flex flex-col gap-3 rounded-xl bg-muted px-4 py-3"
                    >
                      <p className="text-base">
                        <bdi>{copy.confirmDelete(baby.name)}</bdi>
                      </p>
                      {error && (
                        <InlineNotice tone="error">
                          {errorMessage(error.code)}
                        </InlineNotice>
                      )}
                      <div className="flex flex-wrap gap-3">
                        <Button
                          id={`baby-delete-confirm-${baby.id}`}
                          type="button"
                          size="lg"
                          className="h-12 min-w-32 text-base"
                          aria-disabled={pending || undefined}
                          onClick={() => run(() => deleteBaby({ id: baby.id }))}
                        >
                          {pending && <Spinner aria-hidden />}
                          {pending ? copy.deleting : copy.confirmDeleteYes}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="h-12 text-base"
                          disabled={pending}
                          onClick={close}
                        >
                          {copy.cancel}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {open?.kind === "new" ? (
        <BabyForm
          id="new"
          baby={null}
          today={today}
          error={error}
          pending={pending}
          onSubmit={submitBaby}
          onCancel={close}
        />
      ) : (
        babies.length < MAX_BABIES && (
          <Button
            id="baby-add"
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => {
              setError(null)
              setOpen({ kind: "new" })
            }}
          >
            {copy.addBaby}
          </Button>
        )
      )}
    </section>
  )
}

function BabyForm({
  id,
  baby,
  today,
  error,
  pending,
  onSubmit,
  onCancel,
}: {
  id: string
  baby: ProfileBaby | null
  today: string
  error: Failure | null
  pending: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}) {
  const field = error?.detail?.field ?? null
  const nameError = field === "baby_name" ? error : null
  const dateError = field === "birth_date" ? error : null
  const nameId = `babyName-${id}`
  const dateId = `birthDate-${id}`

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="babyId" value={baby?.id ?? ""} />
      <Field data-invalid={nameError ? true : undefined}>
        <FieldLabel htmlFor={nameId}>{copy.babyName}</FieldLabel>
        <Input
          id={nameId}
          name="babyName"
          defaultValue={baby?.name ?? ""}
          maxLength={100}
          required
          aria-required
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${nameId}-error` : undefined}
          className="h-12 text-base"
        />
        {nameError && (
          <FieldError id={`${nameId}-error`}>
            {errorMessage(nameError.code)}
          </FieldError>
        )}
      </Field>
      <Field data-invalid={dateError ? true : undefined}>
        <FieldLabel htmlFor={dateId}>{copy.birthDate}</FieldLabel>
        <Input
          id={dateId}
          name="birthDate"
          type="date"
          defaultValue={baby?.birthDate ?? ""}
          max={today}
          required
          aria-required
          aria-invalid={dateError ? true : undefined}
          aria-describedby={dateError ? `${dateId}-error` : undefined}
          className="h-12 text-base"
        />
        {dateError && (
          <FieldError id={`${dateId}-error`}>
            {dateError.code === "INVALID_INPUT"
              ? copy.birthDateFuture
              : errorMessage(dateError.code)}
          </FieldError>
        )}
      </Field>
      {error && !nameError && !dateError && (
        <InlineNotice tone="error">{errorMessage(error.code)}</InlineNotice>
      )}
      <FormButtons pending={pending} onCancel={onCancel} />
    </form>
  )
}
