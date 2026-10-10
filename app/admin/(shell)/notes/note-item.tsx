"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ArchiveIcon, PencilIcon, PinIcon, PinOffIcon } from "lucide-react"

import {
  DeleteStep,
  ErrorNotice,
  MoveButtons,
  OUTLINE,
  TEXT_BUTTON,
  TextForm,
  WorkPanel,
} from "@/components/admin/edit-kit"
import { useAnnounce, useWorkAction } from "@/components/admin/use-work-action"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { adminCopy } from "@/lib/copy/admin"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import {
  addNoteAction,
  deleteNoteAction,
  setNoteArchivedAction,
  setNoteDoneAction,
  setNoteOrderAction,
  setNotePinnedAction,
  updateNoteAction,
} from "./actions"
import {
  MAX_NOTE_BODY,
  moveGroup,
  noteLabel,
  noteOrderAfterMove,
  type Note,
  type NoteTopic,
} from "./notes-data"

// A note of the notes tab (story 4.11): a check-item for "בוצע" (a real
// checkbox, saved at once and announced; a done note is struck through and
// muted, and stays in its place), a pinned note on a muted ground with a pin
// mark, and the pencil that opens the note's sheet: the text, "העברה
// לנושא", pin, archive, up and down, delete.

const copy = adminCopy.notes

export function NoteItem({
  note,
  notes,
  topic,
  topics,
}: {
  note: Note
  notes: readonly Note[]
  topic: NoteTopic
  topics: readonly NoteTopic[]
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [open, setOpen] = useState(false)

  return (
    <li
      data-pinned={note.pinned || undefined}
      className={cn(
        "flex flex-col gap-1 rounded-lg px-3",
        note.pinned && "bg-muted"
      )}
    >
      <div className="flex min-h-11 items-start gap-2">
        <Checkbox
          id={`${id}-done`}
          checked={note.done}
          disabled={pending}
          aria-busy={pending || undefined}
          aria-labelledby={`${id}-done-label ${id}-body`}
          onCheckedChange={(value) => {
            const done = value === true
            run(
              () => setNoteDoneAction({ noteId: note.id, done }),
              () => announce(done ? copy.markedDone : copy.markedNotDone)
            )
          }}
          className="relative mt-2.5 size-6 rounded-[4px] border-[1.5px] border-muted-foreground bg-card after:absolute after:-inset-2.5 after:content-['']"
        />
        <span id={`${id}-done-label`} className="sr-only">
          {copy.done}
        </span>
        {/* Plain text, not a label: tapping it to read or copy a phone
            number must not toggle "בוצע"; only the checkbox (44px) does. */}
        <p
          id={`${id}-body`}
          className={cn(
            "min-w-0 flex-1 py-2.5 text-base leading-normal break-words whitespace-pre-line",
            note.done && "text-muted-foreground line-through"
          )}
        >
          <bdi>{note.body}</bdi>
        </p>
        {note.pinned && (
          <span className="mt-3 shrink-0 text-muted-foreground">
            <PinIcon aria-hidden strokeWidth={1.5} className="size-4" />
            <span className="sr-only">{copy.pinned}</span>
          </span>
        )}
        <button
          type="button"
          aria-label={copy.editNote(noteLabel(note.body))}
          onClick={() => setOpen(true)}
          className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-border"
        >
          <PencilIcon aria-hidden strokeWidth={1.5} className="size-5" />
        </button>
      </div>
      <ErrorNotice code={error} />
      {open && (
        <NotePanel
          note={note}
          notes={notes}
          topic={topic}
          topics={topics}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  )
}

function NotePanel({
  note,
  notes,
  topic,
  topics,
  onClose,
}: {
  note: Note
  notes: readonly Note[]
  topic: NoteTopic
  topics: readonly NoteTopic[]
  onClose: () => void
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [body, setBody] = useState(note.body)
  const [target, setTarget] = useState(topic.id)
  const [key, setKey] = useState(newIdempotencyKey)
  const [deleteKey] = useState(newIdempotencyKey)
  const group = moveGroup(notes, note)
  const index = group.indexOf(note.id)

  return (
    <WorkPanel
      open
      onOpenChange={(next) => !next && onClose()}
      busy={pending}
      title={copy.noteSheet}
    >
      <TextForm
        id={`${id}-body`}
        label={copy.noteBody}
        value={body}
        onChange={setBody}
        max={MAX_NOTE_BODY}
        multiline
        submitLabel={copy.save}
        pending={pending}
        onSubmit={() =>
          run(
            () =>
              updateNoteAction({
                noteId: note.id,
                topicId: target,
                body,
                idempotencyKey: key,
              }),
            () => {
              setKey(newIdempotencyKey())
              onClose()
              const moved = topics.find(
                (t) => t.id === target && t.id !== topic.id
              )
              announce(moved ? copy.noteMoved(moved.name) : copy.noteSaved)
            }
          )
        }
      >
        {topics.length > 1 && (
          <Field>
            <FieldLabel htmlFor={`${id}-topic`}>{copy.moveTo}</FieldLabel>
            <NativeSelect
              id={`${id}-topic`}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-12 w-full text-base"
            >
              {topics.map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {t.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
      </TextForm>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={OUTLINE}
          aria-disabled={pending || undefined}
          onClick={() => {
            if (pending) return
            const pinned = !note.pinned
            run(
              () => setNotePinnedAction({ noteId: note.id, pinned }),
              () => {
                onClose()
                announce(pinned ? copy.notePinned : copy.noteUnpinned)
              }
            )
          }}
        >
          {note.pinned ? (
            <PinOffIcon aria-hidden strokeWidth={1.5} className="size-5" />
          ) : (
            <PinIcon aria-hidden strokeWidth={1.5} className="size-5" />
          )}
          {note.pinned ? copy.unpin : copy.pin}
        </button>
        <button
          type="button"
          className={OUTLINE}
          aria-disabled={pending || undefined}
          onClick={() => {
            if (pending) return
            run(
              () => setNoteArchivedAction({ noteId: note.id, archived: true }),
              () => {
                onClose()
                announce(copy.noteArchived)
              }
            )
          }}
        >
          <ArchiveIcon aria-hidden strokeWidth={1.5} className="size-5" />
          {copy.archive}
        </button>
      </div>

      <MoveButtons
        canUp={index > 0}
        canDown={index >= 0 && index < group.length - 1}
        pending={pending}
        onMove={(delta) => {
          const ids = noteOrderAfterMove(notes, note.id, delta)
          if (!ids) return
          const position = index + delta + 1
          run(
            () => setNoteOrderAction({ topicId: topic.id, ids }),
            () => announce(copy.moved(position, group.length))
          )
        }}
      />

      <DeleteStep
        label={copy.deleteNote}
        question={copy.deleteNoteQuestion}
        pending={pending}
        onDelete={() =>
          run(
            () =>
              deleteNoteAction({ noteId: note.id, idempotencyKey: deleteKey }),
            () => {
              onClose()
              announce(copy.noteDeleted)
            }
          )
        }
      />
      <ErrorNotice code={error} />
    </WorkPanel>
  )
}

// "+ פתק": opens a short form in place; the new note is at the top of the
// unpinned notes. A successful add closes it and returns focus to the
// opener; "ביטול" closes it without adding.
export function AddNote({
  topicId,
  wide = false,
}: {
  topicId: string
  wide?: boolean
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run, clearError } = useWorkAction()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState("")
  const [key, setKey] = useState(newIdempotencyKey)
  const openerRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (open || !refocus.current) return
    refocus.current = false
    openerRef.current?.focus()
  }, [open])

  if (!open) {
    return (
      <Button
        ref={openerRef}
        type="button"
        size="lg"
        onClick={() => {
          setOpen(true)
          queueMicrotask(() => document.getElementById(`${id}-body`)?.focus())
        }}
        className={cn(
          "h-12 rounded-[4px] px-6 text-base font-semibold",
          wide ? "w-full sm:w-auto" : "self-start"
        )}
      >
        {copy.addNote}
      </Button>
    )
  }

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg bg-muted px-3 py-3 text-start">
      <TextForm
        id={`${id}-body`}
        label={copy.noteBody}
        value={body}
        onChange={setBody}
        max={MAX_NOTE_BODY}
        multiline
        submitLabel={copy.add}
        pending={pending}
        onSubmit={() =>
          run(
            () => addNoteAction({ topicId, body, idempotencyKey: key }),
            () => {
              setBody("")
              setKey(newIdempotencyKey())
              setOpen(false)
              refocus.current = true
              announce(copy.noteAdded)
            }
          )
        }
      />
      <ErrorNotice code={error} />
      <button
        type="button"
        className={cn(TEXT_BUTTON, "self-start")}
        disabled={pending}
        onClick={() => {
          setOpen(false)
          setBody("")
          clearError()
          refocus.current = true
        }}
      >
        {copy.cancel}
      </button>
    </div>
  )
}

// An archived note (shown with "להציג ארכיון"): its text, muted (struck
// through when done), and "החזרה", which returns it to the same place.
export function ArchivedNoteItem({ note }: { note: Note }) {
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  return (
    <li className="flex flex-col gap-1 border-b border-border py-2">
      <div className="flex items-start gap-3">
        <p
          className={cn(
            "min-w-0 flex-1 py-2.5 leading-normal break-words whitespace-pre-line text-muted-foreground",
            note.done && "line-through"
          )}
        >
          <bdi>{note.body}</bdi>
        </p>
        <button
          type="button"
          className={cn(OUTLINE, "shrink-0")}
          aria-label={copy.restoreNamed(noteLabel(note.body))}
          aria-busy={pending || undefined}
          aria-disabled={pending || undefined}
          onClick={() => {
            if (pending) return
            run(
              () => setNoteArchivedAction({ noteId: note.id, archived: false }),
              () => announce(copy.noteRestored)
            )
          }}
        >
          {copy.restore}
        </button>
      </div>
      <ErrorNotice code={error} />
    </li>
  )
}
