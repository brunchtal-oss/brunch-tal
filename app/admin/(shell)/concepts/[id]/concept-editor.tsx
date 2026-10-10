"use client"

import { startTransition, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

import {
  deleteConceptAction,
  setConceptArchivedAction,
  setConceptImageAction,
  updateConceptAction,
} from "../actions"
import {
  conceptChanges,
  draftFromRow,
  imageChanged,
  type ConceptDraft,
  type ConceptImage,
  type ConceptRow,
} from "../concept-draft"
import { ConceptFields, ConceptImageField } from "../concept-fields"

const copy = adminCopy.concepts

type Notice =
  { tone: "success"; text: string } | { tone: "error"; code: ErrorCode } | null

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null
  return (
    <InlineNotice tone={notice.tone}>
      {notice.tone === "error" ? errorMessage(notice.code) : notice.text}
    </InlineNotice>
  )
}

// The editor of one concept (story 4.8): its fields with "שמירה" (each
// field's note says what a change does: the name on every session, the
// description and the kind on new sessions only), its image (saved and
// published on its own, as a session's), archive / restore, and delete
// through the concept_delete dialog. A concept that has sessions cannot be
// deleted: CONCEPT_IN_USE shows next to the archive button, the way out.
// The saved values come from the server after each save (router.refresh).
export function ConceptEditor({
  row,
  imagePreviewUrl = null,
}: {
  row: ConceptRow
  imagePreviewUrl?: string | null
}) {
  const [archiveError, setArchiveError] = useState<ErrorCode | null>(null)
  return (
    <div className="flex flex-col gap-8">
      <FieldsForm row={row} />
      <ImageBox row={row} previewUrl={imagePreviewUrl} />
      <ArchiveBox row={row} error={archiveError} onError={setArchiveError} />
      <DeleteBox row={row} onInUse={() => setArchiveError("CONCEPT_IN_USE")} />
    </div>
  )
}

function FieldsForm({ row }: { row: ConceptRow }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [draft, setDraft] = useState<ConceptDraft>(() => draftFromRow(row))
  // One key per change (AD-5): a retry of the same values reuses it.
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [tried, setTried] = useState(false)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    setTried(true)
    setNotice(null)
    const result = conceptChanges(row, draft)
    if (!result.ok) {
      formRef.current?.querySelector<HTMLElement>(`#${result.field}`)?.focus()
      return
    }
    if (!result.changes) {
      setNotice({ tone: "success", text: copy.saved })
      return
    }
    const changes = result.changes
    setPending(true)
    startTransition(async () => {
      try {
        const saved = await updateConceptAction({
          conceptId: row.id,
          changes,
          idempotencyKey: key,
        })
        if (saved.ok) {
          setKey(newIdempotencyKey())
          setTried(false)
          setNotice({ tone: "success", text: copy.saved })
          router.refresh()
        } else {
          setNotice({ tone: "error", code: saved.code })
        }
      } catch {
        setNotice({ tone: "error", code: "SERVER_ERROR" })
      }
      setPending(false)
    })
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-6"
    >
      <ConceptFields
        draft={draft}
        onChange={(patch) => {
          setDraft((current) => ({ ...current, ...patch }))
          setKey(newIdempotencyKey())
          setNotice(null)
        }}
        tried={tried}
        notes
      />
      <NoticeLine notice={notice} />
      <Button
        type="submit"
        size="lg"
        className="h-12 self-start px-6 text-base"
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
      >
        {pending && <Spinner aria-hidden />}
        {copy.save}
      </Button>
    </form>
  )
}

// The concept's image: image-upload-field, then "save the image" once it
// differs from the saved one (publish, then set; setConceptImageAction).
// Every session of the concept without its own image shows it.
function ImageBox({
  row,
  previewUrl,
}: {
  row: ConceptRow
  previewUrl: string | null
}) {
  const router = useRouter()
  const saved = row.image
  const [image, setImage] = useState<ConceptImage | null>(saved)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const changed = imageChanged(saved, image)

  const save = () => {
    if (pending || !changed) return
    setPending(true)
    setNotice(null)
    startTransition(async () => {
      try {
        const result = await setConceptImageAction({
          conceptId: row.id,
          image,
        })
        if (result.ok) {
          setNotice({
            tone: "success",
            text: image ? copy.image.saved : copy.image.removed,
          })
          router.refresh()
        } else {
          setNotice({ tone: "error", code: result.code })
        }
      } catch {
        setNotice({ tone: "error", code: "SERVER_ERROR" })
      }
      setPending(false)
    })
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-8">
      <ConceptImageField
        value={image}
        previewUrl={previewUrl}
        onChange={(next) => {
          setImage(next)
          setNotice(null)
        }}
      />
      <NoticeLine notice={notice} />
      {changed && (
        <Button
          type="button"
          size="lg"
          className="h-12 self-start px-6 text-base"
          aria-busy={pending || undefined}
          aria-disabled={pending || undefined}
          onClick={save}
        >
          {pending && <Spinner aria-hidden />}
          {copy.image.save}
        </Button>
      )}
    </section>
  )
}

// Archive / restore (no dialog): the note, then the button. An error of
// this box, or CONCEPT_IN_USE from a delete, shows next to it.
function ArchiveBox({
  row,
  error,
  onError,
}: {
  row: ConceptRow
  error: ErrorCode | null
  onError: (code: ErrorCode | null) => void
}) {
  const router = useRouter()
  const archived = row.archived_at !== null
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const toggle = () => {
    if (pending) return
    setPending(true)
    setDone(null)
    onError(null)
    startTransition(async () => {
      try {
        const result = await setConceptArchivedAction({
          conceptId: row.id,
          archived: !archived,
        })
        if (result.ok) {
          setDone(archived ? copy.restored : copy.archived)
          router.refresh()
        } else {
          onError(result.code)
        }
      } catch {
        onError("SERVER_ERROR")
      }
      setPending(false)
    })
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-8">
      <p className="text-[15px] text-muted-foreground">{copy.archiveNote}</p>
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      {done && <InlineNotice tone="success">{done}</InlineNotice>}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 self-start border-foreground px-4 text-base"
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        onClick={toggle}
      >
        {pending && <Spinner aria-hidden />}
        {archived ? copy.restore : copy.archive}
      </Button>
    </section>
  )
}

// Delete through the concept_delete dialog. A success goes back to the
// list; CONCEPT_IN_USE closes the dialog and shows next to the archive
// button; any other error shows here.
function DeleteBox({ row, onInUse }: { row: ConceptRow; onInUse: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)

  const confirm = () => {
    if (pending) return
    setPending(true)
    setError(null)
    startTransition(async () => {
      let code: ErrorCode | null = null
      try {
        const result = await deleteConceptAction({
          conceptId: row.id,
          idempotencyKey: key,
        })
        if (result.ok) {
          router.push("/admin/concepts")
          router.refresh()
          return
        }
        code = result.code
        // An answer (not a thrown call): a new key for the next try. After
        // a thrown call the same key is sent again.
        setKey(newIdempotencyKey())
      } catch {
        code = "SERVER_ERROR"
      }
      setPending(false)
      setOpen(false)
      if (code === "CONCEPT_IN_USE") onInUse()
      else setError(code)
    })
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-8">
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 self-start border-error px-4 text-base text-error"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        {copy.delete}
      </Button>
      {open && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setOpen(false)
          }}
          action="concept_delete"
          description={copy.deleteDialog.description}
          impact={[
            {
              label: copy.deleteDialog.concept,
              value: <bdi>{row.name}</bdi>,
            },
          ]}
          checkboxLabel={copy.deleteDialog.confirm(row.name)}
          confirmLabel={copy.deleteDialog.submit}
          destructive
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </section>
  )
}
