"use client"

import { useId, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { buttonClass } from "@/components/shared/button-class"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ActionResult } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import { addCustomerNoteAction, deleteCustomerNoteAction } from "./actions"
import { NOTE_MAX, type NoteItem } from "./card-items"

const copy = adminCopy.customers.card

const OUTLINE = buttonClass({
  variant: "outline",
  size: "lg",
  className:
    "h-11 rounded-[4px] border-foreground px-4 text-[15px] font-semibold",
})

type Result = { tone: "success" | "error"; text: string } | null

// One write: no optimistic update. The control stays locked from the call
// until the refreshed card arrives; the result is an inline-notice. A
// rejected call (network, deploy) is a SERVER_ERROR.
function useNoteAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<Result>(null)

  function run(
    call: () => Promise<ActionResult>,
    success: string,
    onOk?: () => void
  ) {
    if (pending) return
    setResult(null)
    startTransition(async () => {
      let outcome: ActionResult
      try {
        outcome = await call()
      } catch {
        outcome = { ok: false, code: "SERVER_ERROR" }
      }
      if (outcome.ok) {
        onOk?.()
        setResult({ tone: "success", text: success })
      } else {
        setResult({ tone: "error", text: errorMessage(outcome.code) })
      }
      startTransition(() => router.refresh())
    })
  }

  return { pending, result, run }
}

// The internal notes (story 4.2): Tal's only, never shown to the customer.
// Add and delete (with a confirm step); no editing (user decision
// 2026-10-07).
export function CustomerNotes({
  customerId,
  notes,
}: {
  customerId: string
  notes: NoteItem[]
}) {
  const id = useId()
  const { pending, result, run } = useNoteAction()
  const [body, setBody] = useState("")
  const [key, setKey] = useState(newIdempotencyKey)
  const empty = body.trim() === ""
  const tooLong = body.trim().length > NOTE_MAX

  return (
    <div className="flex flex-col gap-4">
      {result && <InlineNotice tone={result.tone}>{result.text}</InlineNotice>}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (pending || empty || tooLong) return
          run(
            () =>
              addCustomerNoteAction({
                customerId,
                body,
                idempotencyKey: key,
              }),
            copy.noteAdded,
            () => {
              setBody("")
              setKey(newIdempotencyKey())
            }
          )
        }}
      >
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>{copy.noteLabel}</FieldLabel>
          <Textarea
            id={`${id}-note`}
            value={body}
            rows={3}
            aria-invalid={tooLong || undefined}
            aria-describedby={tooLong ? `${id}-too-long` : undefined}
            onChange={(event) => {
              // A changed text is a new request: a new key, so a retry
              // after an uncertain failure is never IDEMPOTENCY_KEY_REUSED.
              // An unchanged retry keeps its key.
              setBody(event.target.value)
              setKey(newIdempotencyKey())
            }}
            className="min-h-24 text-base"
          />
          {tooLong && (
            <p id={`${id}-too-long`} className="text-[15px] text-error">
              {copy.noteTooLong(NOTE_MAX)}
            </p>
          )}
        </Field>
        <Button
          type="submit"
          size="lg"
          aria-busy={pending || undefined}
          aria-disabled={pending || empty || tooLong || undefined}
          className="h-12 self-start rounded-[4px] px-6 text-base font-semibold"
        >
          {pending && <Spinner aria-hidden />}
          {copy.addNote}
        </Button>
      </form>

      {notes.length === 0 ? (
        <p className="text-base text-muted-foreground">{copy.noNotes}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              pending={pending}
              onDelete={(deleteKey) =>
                run(
                  () =>
                    deleteCustomerNoteAction({
                      noteId: note.id,
                      idempotencyKey: deleteKey,
                    }),
                  copy.noteDeleted
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function NoteRow({
  note,
  pending,
  onDelete,
}: {
  note: NoteItem
  pending: boolean
  onDelete: (idempotencyKey: string) => void
}) {
  const [asking, setAsking] = useState(false)
  const [deleteKey] = useState(newIdempotencyKey)

  return (
    <li className="flex flex-col gap-1 rounded-lg bg-muted px-4 pt-3 pb-1">
      <p className="text-base whitespace-pre-line">
        <bdi>{note.body}</bdi>
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-[13px] text-muted-foreground">{note.when}</p>
        {!asking && (
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-[4px] text-[15px] text-error underline underline-offset-[3px]"
            onClick={() => setAsking(true)}
          >
            {copy.deleteNote}
          </button>
        )}
      </div>
      {asking && (
        <div
          role="group"
          aria-label={copy.deleteQuestion}
          className="mb-3 flex flex-col gap-3 rounded-lg bg-card px-4 py-3"
        >
          <p className="font-semibold">{copy.deleteQuestion}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              size="lg"
              aria-busy={pending || undefined}
              aria-disabled={pending || undefined}
              onClick={() => !pending && onDelete(deleteKey)}
              className="h-11 rounded-[4px] text-[15px] font-semibold"
            >
              {pending && <Spinner aria-hidden />}
              {copy.delete}
            </Button>
            <button
              type="button"
              className={cn(OUTLINE)}
              disabled={pending}
              onClick={() => setAsking(false)}
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
