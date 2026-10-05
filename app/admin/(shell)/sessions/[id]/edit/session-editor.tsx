"use client"

import { startTransition, useState } from "react"
import { useRouter } from "next/navigation"

import {
  ValueChangeRow,
  type ValueSaveResult,
} from "@/components/admin/value-change-row"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ActionResult, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

import {
  duplicateEventAction,
  publishEventAction,
  updateEventAction,
} from "../../actions"
import {
  draftFromRow,
  fieldChange,
  fieldError,
  type EditorField,
  type SessionDraft,
  type SessionRow,
} from "../../session-draft"
import { SessionField, WhenFields } from "../../session-fields"

const copy = adminCopy.sessions

// The draft values behind each editor row (for its "cancel").
const DRAFT_KEYS: Record<EditorField, readonly (keyof SessionDraft)[]> = {
  when: ["date", "startTime", "endTime"],
  kind: ["kind"],
  description: ["description"],
  capacity: ["capacityText"],
  closes: ["closesLocal"],
  price: ["priceText"],
}

function asSaveResult(result: ActionResult<unknown>): ValueSaveResult {
  return result.ok ? { ok: true } : { ok: false, code: result.code }
}

// The editor of one session (story 3.1): each field in its own
// value-change-row ("old ← new", saved alone, logged), the date and times
// as one row, the registration close with its note (by the settings until
// Tal sets it for this session). A draft has "publish" on top; every session
// can be duplicated to a new draft on another date. The concept is fixed.
// The saved values come from the server after each save (router.refresh);
// a failure leaves them as they were.
export function SessionEditor({ row }: { row: SessionRow }) {
  const [draft, setDraft] = useState<SessionDraft>(() => draftFromRow(row))
  // A new date or time moves the close on the server (trigger); after the
  // refresh the close field takes the saved value, the others stay.
  const [seenCloses, setSeenCloses] = useState(row.registration_closes_at)
  if (seenCloses !== row.registration_closes_at) {
    setSeenCloses(row.registration_closes_at)
    setDraft((current) => ({
      ...current,
      closesLocal: draftFromRow(row).closesLocal,
    }))
  }
  const update = (patch: Partial<SessionDraft>) =>
    setDraft((current) => ({ ...current, ...patch }))
  const revert = (keys: readonly (keyof SessionDraft)[]) => {
    const saved = draftFromRow(row)
    update(Object.fromEntries(keys.map((key) => [key, saved[key]])))
  }

  const saveField = (field: EditorField) => async (key: string) => {
    const change = fieldChange(field, row, draft)
    if (!change) return null
    return asSaveResult(
      await updateEventAction({
        eventId: row.id,
        changes: change.changes,
        idempotencyKey: key,
      })
    )
  }

  const fieldRow = (
    field: EditorField,
    label: string,
    children: React.ReactNode,
    scope?: React.ReactNode
  ) => {
    const change = fieldChange(field, row, draft)
    return (
      <ValueChangeRow
        label={label}
        oldValue={change?.from ?? ""}
        newValue={change?.to ?? null}
        scope={scope}
        onSave={saveField(field)}
        onCancel={() => revert(DRAFT_KEYS[field])}
      >
        {children}
      </ValueChangeRow>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {row.status === "draft" && <PublishBox eventId={row.id} />}

      <ul className="flex flex-col divide-y divide-border border-y border-border">
        <li className="py-5">
          {fieldRow(
            "when",
            copy.fields.when,
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-medium">
                {copy.fields.when}
              </legend>
              <WhenFields
                idPrefix="when-"
                date={draft.date}
                startTime={draft.startTime}
                endTime={draft.endTime}
                onChange={update}
                problems={{
                  date: fieldError("date", draft),
                  startTime: fieldError("startTime", draft),
                  endTime: fieldError("endTime", draft),
                }}
              />
            </fieldset>
          )}
        </li>
        <li className="py-5">
          {fieldRow(
            "description",
            copy.fields.description,
            <SessionField
              id="description"
              label={copy.fields.description}
              value={draft.description}
              onChange={(description) => update({ description })}
              maxLength={2000}
              multiline
            />
          )}
        </li>
        <li className="py-5">
          {fieldRow(
            "capacity",
            copy.fields.capacity,
            <SessionField
              id="capacity"
              label={copy.fields.capacity}
              type="numeric"
              value={draft.capacityText}
              onChange={(capacityText) => update({ capacityText })}
              problem={fieldError("capacity", draft)}
              required
              maxLength={4}
            />
          )}
        </li>
        <li className="py-5">
          {fieldRow(
            "closes",
            copy.fields.closes,
            <SessionField
              id="closes"
              label={copy.fields.closes}
              type="datetime-local"
              value={draft.closesLocal}
              onChange={(closesLocal) => update({ closesLocal })}
              problem={fieldError("closes", draft)}
              hint={
                row.registration_close_overridden ? null : copy.closesByRule
              }
              required
            />,
            copy.closesScope
          )}
        </li>
        <li className="py-5">
          {fieldRow(
            "price",
            copy.fields.price,
            <SessionField
              id="price"
              label={copy.fields.price}
              type="decimal"
              value={draft.priceText}
              onChange={(priceText) => update({ priceText })}
              problem={fieldError("price", draft)}
              hint={copy.priceEmpty}
              maxLength={12}
            />
          )}
        </li>
      </ul>

      <DuplicateBox row={row} />
    </div>
  )
}

// "Publish" of a draft: the note, then the button (busy until the answer).
// A success refreshes the page, where the chip shows "פורסם".
function PublishBox({ eventId }: { eventId: string }) {
  const router = useRouter()
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)

  const publish = () => {
    if (pending) return
    setPending(true)
    setError(null)
    startTransition(async () => {
      try {
        const result = await publishEventAction({
          eventId,
          idempotencyKey: key,
        })
        if (result.ok) {
          setKey(newIdempotencyKey())
          router.refresh()
        } else {
          setError(result.code)
        }
      } catch {
        setError("SERVER_ERROR")
      }
      setPending(false)
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <InlineNotice tone="info">{copy.publishNote}</InlineNotice>
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      <Button
        type="button"
        size="lg"
        className="h-12 self-start px-5 text-base"
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        onClick={publish}
      >
        {pending && <Spinner aria-hidden />}
        {copy.publish}
      </Button>
    </section>
  )
}

// "Duplicate to a draft": opens the new draft's date and times (the source
// session's times to start with), then creates it and opens it.
function DuplicateBox({ row }: { row: SessionRow }) {
  const router = useRouter()
  const saved = draftFromRow(row)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(() => newIdempotencyKey())
  const initialWhen = () => ({
    date: "",
    startTime: saved.startTime,
    endTime: saved.endTime,
  })
  const [when, setWhen] = useState(initialWhen)
  const [tried, setTried] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)

  const asDraft = { ...saved, ...when }
  const problem = (field: "date" | "startTime" | "endTime") =>
    tried ? fieldError(field, asDraft) : null

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    setTried(true)
    setError(null)
    if (
      fieldError("date", asDraft) ||
      fieldError("startTime", asDraft) ||
      fieldError("endTime", asDraft)
    ) {
      return
    }
    setPending(true)
    startTransition(async () => {
      try {
        const result = await duplicateEventAction({
          eventId: row.id,
          date: when.date,
          startTime: when.startTime,
          endTime: when.endTime,
          idempotencyKey: key,
        })
        if (result.ok) {
          setKey(newIdempotencyKey())
          router.push(`/admin/sessions/${result.data.eventId}/edit`)
          return
        }
        setError(result.code)
      } catch {
        setError("SERVER_ERROR")
      }
      setPending(false)
    })
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 self-start border-foreground px-4 text-base"
        onClick={() => setOpen(true)}
      >
        {copy.duplicate}
      </Button>
    )
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-4 rounded-sm bg-muted px-4 py-4"
    >
      <h2 className="text-base font-semibold">{copy.duplicateWhen}</h2>
      <WhenFields
        idPrefix="duplicate-"
        date={when.date}
        startTime={when.startTime}
        endTime={when.endTime}
        onChange={(patch) => setWhen((current) => ({ ...current, ...patch }))}
        problems={{
          date: problem("date"),
          startTime: problem("startTime"),
          endTime: problem("endTime"),
        }}
      />
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="submit"
          size="lg"
          className="h-11 px-4 text-base"
          aria-busy={pending || undefined}
          aria-disabled={pending || undefined}
        >
          {pending && <Spinner aria-hidden />}
          {copy.duplicateSubmit}
        </Button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setOpen(false)
            setTried(false)
            setError(null)
            setWhen(initialWhen())
          }}
          className="min-h-11 px-1 text-base underline underline-offset-[3px] disabled:opacity-50"
        >
          {adminCopy.valueChange.cancel}
        </button>
      </div>
    </form>
  )
}
