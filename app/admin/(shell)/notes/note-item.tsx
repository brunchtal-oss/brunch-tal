"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ArchiveIcon, PencilIcon, PinIcon, PinOffIcon } from "lucide-react"

import {
  DeleteStep,
  ErrorNotice,
  MoveButtons,
  OUTLINE,
  TextForm,
  WorkPanel,
} from "@/components/admin/edit-kit"
import { useAnnounce, useWorkAction } from "@/components/admin/use-work-action"
import { useOnlineGuard } from "@/components/shared/online-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  noteTitle,
  type Note,
} from "./notes-data"

// A note on the board (story 4.11; fix 13, sketch A): a paper card with a
// slight tilt; its first line is the title (body-strong 17px), the rest the
// text under it (body-sm, ink-muted), in full. A pinned note sits on a muted
// ground with a strip of tape (decorative, brand-accent). The footer: the
// check-item for "בוצע" (a real checkbox, saved at once and announced; a
// done note is struck through and muted, and stays in its place), the pin
// toggle (saved at once) and the pencil that opens the note's sheet: the
// text, pin, archive, up and down, delete.

const copy = adminCopy.notes

const TILT = ["-rotate-[0.6deg]", "rotate-[0.5deg]", ""] as const

const ICON_BUTTON =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-border"

export function NoteItem({
  note,
  notes,
  tilt = 0,
}: {
  note: Note
  notes: readonly Note[]
  tilt?: number
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [open, setOpen] = useState(false)
  // "בוצע" and the pin write at once: offline they are dimmed and described
  // (5.21).
  const doneGuard = useOnlineGuard()
  const pinGuard = useOnlineGuard({ "aria-describedby": `${id}-title` })
  const { title, rest } = noteTitle(note.body)

  return (
    <li
      data-pinned={note.pinned || undefined}
      data-done={note.done || undefined}
      className={cn(
        "relative flex min-w-0 flex-col gap-1.5 rounded-lg border px-3 pt-3 pb-1 motion-reduce:rotate-0",
        TILT[tilt % TILT.length],
        note.pinned
          ? "border-transparent bg-muted pt-[18px]"
          : "border-border bg-card"
      )}
    >
      {note.pinned && (
        // A strip of tape: decorative only.
        <span
          aria-hidden
          data-tape
          className="pointer-events-none absolute start-1/2 -top-[7px] h-3.5 w-14 translate-x-1/2 -rotate-3 rounded-[2px] bg-brand-accent/45"
        />
      )}
      {/* Plain text, not a label: tapping it to read or copy a phone
          number must not toggle "בוצע"; only the checkbox (44px) does. */}
      <p
        id={`${id}-title`}
        className={cn(
          "text-[17px] leading-[1.35] font-semibold [overflow-wrap:anywhere]",
          note.done && "text-muted-foreground line-through"
        )}
      >
        <bdi>{title}</bdi>
      </p>
      {rest && (
        <p
          className={cn(
            "text-[15px] leading-normal [overflow-wrap:anywhere] whitespace-pre-line text-muted-foreground",
            note.done && "line-through"
          )}
        >
          <bdi>{rest}</bdi>
        </p>
      )}
      <div className="mt-0.5 flex min-w-0 items-center gap-1">
        <Checkbox
          id={`${id}-done`}
          checked={note.done}
          disabled={pending}
          aria-busy={pending || undefined}
          aria-labelledby={`${id}-done-label ${id}-title`}
          onCheckedChange={(value) => {
            const done = value === true
            run(
              () => setNoteDoneAction({ noteId: note.id, done }),
              () => announce(done ? copy.markedDone : copy.markedNotDone)
            )
          }}
          className="relative size-6 rounded-[4px] border-[1.5px] border-muted-foreground bg-card after:absolute after:-inset-2.5 after:content-['']"
          {...doneGuard}
        />
        <span id={`${id}-done-label`} className="sr-only">
          {copy.done}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={note.pinned}
          aria-label={note.pinned ? copy.unpin : copy.pin}
          aria-describedby={`${id}-title`}
          aria-busy={pending || undefined}
          aria-disabled={pending || undefined}
          onClick={() => {
            if (pending) return
            const pinned = !note.pinned
            run(
              () => setNotePinnedAction({ noteId: note.id, pinned }),
              () => announce(pinned ? copy.notePinned : copy.noteUnpinned)
            )
          }}
          className={cn(ICON_BUTTON, note.pinned && "text-foreground")}
          {...pinGuard}
        >
          <PinIcon
            aria-hidden
            strokeWidth={1.5}
            className={cn("size-[18px]", note.pinned && "fill-current")}
          />
        </button>
        <button
          type="button"
          aria-label={copy.editNote(noteLabel(note.body))}
          onClick={() => setOpen(true)}
          className={cn(ICON_BUTTON, "-me-2.5")}
        >
          <PencilIcon aria-hidden strokeWidth={1.5} className="size-5" />
        </button>
      </div>
      {note.pinned && <span className="sr-only">{copy.pinned}</span>}
      <ErrorNotice code={error} />
      {open && (
        <NotePanel note={note} notes={notes} onClose={() => setOpen(false)} />
      )}
    </li>
  )
}

function BodyHint() {
  return <p className="text-[13px] text-muted-foreground">{copy.bodyHint}</p>
}

function NotePanel({
  note,
  notes,
  onClose,
}: {
  note: Note
  notes: readonly Note[]
  onClose: () => void
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const guard = useOnlineGuard()
  const [body, setBody] = useState(note.body)
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
                body,
                idempotencyKey: key,
              }),
            () => {
              setKey(newIdempotencyKey())
              onClose()
              announce(copy.noteSaved)
            }
          )
        }
      >
        <BodyHint />
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
          {...guard}
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
          {...guard}
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
            () => setNoteOrderAction({ ids }),
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

// "+ פתק" (primary, at the inline start): opens a sheet with the note's
// text; the new note is at the top of the unpinned notes. A successful add
// closes it and returns focus to the opener.
export function AddNote({ wide = false }: { wide?: boolean }) {
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

  return (
    <>
      <Button
        ref={openerRef}
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        className={cn(
          "h-12 rounded-[4px] px-6 text-base font-semibold",
          wide ? "w-full sm:w-auto" : "self-start"
        )}
      >
        {copy.addNote}
      </Button>
      <WorkPanel
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            clearError()
            refocus.current = true
          }
        }}
        busy={pending}
        title={copy.newNote}
      >
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
              () => addNoteAction({ body, idempotencyKey: key }),
              () => {
                setBody("")
                setKey(newIdempotencyKey())
                refocus.current = true
                setOpen(false)
                announce(copy.noteAdded)
              }
            )
          }
        >
          <BodyHint />
        </TextForm>
        <ErrorNotice code={error} />
      </WorkPanel>
    </>
  )
}

// An archived note (shown with "להציג ארכיון"): its title and the rest,
// muted (struck through when done), and "החזרה", which returns it to the
// same place.
export function ArchivedNoteItem({ note }: { note: Note }) {
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const guard = useOnlineGuard()
  const { title, rest } = noteTitle(note.body)
  return (
    <li className="flex flex-col gap-1 border-b border-border py-2">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-0.5 py-2.5 leading-normal break-words text-muted-foreground",
            note.done && "line-through"
          )}
        >
          <p className="font-semibold">
            <bdi>{title}</bdi>
          </p>
          {rest && (
            <p className="whitespace-pre-line">
              <bdi>{rest}</bdi>
            </p>
          )}
        </div>
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
          {...guard}
        >
          {copy.restore}
        </button>
      </div>
      <ErrorNotice code={error} />
    </li>
  )
}
