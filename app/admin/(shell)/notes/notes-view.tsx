"use client"

import { useCallback, useId, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import {
  DeleteStep,
  ErrorNotice,
  MoveButtons,
  TEXT_BUTTON,
  TextForm,
  WorkPanel,
} from "@/components/admin/edit-kit"
import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import {
  AnnounceContext,
  useAnnounce,
  useWorkAction,
} from "@/components/admin/use-work-action"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import {
  addNoteTopicAction,
  deleteNoteTopicAction,
  previewDeleteNoteTopicAction,
  renameNoteTopicAction,
  setNoteTopicOrderAction,
} from "./actions"
import { AddNote, ArchivedNoteItem, NoteItem } from "./note-item"
import {
  MAX_TOPIC_NAME,
  needsConfirmedDelete,
  swapIds,
  topicHref,
  type Note,
  type NoteTopic,
} from "./notes-data"

// The notes tab (story 4.11; EXPERIENCE › רשימות): the topic switcher (one
// link per topic, the selected one is ?topic=), "+ נושא", then the selected
// topic: its name with "עריכה" (rename, up and down, delete), "+ פתק" and
// its notes (pinned first, on a muted ground; a check-item for "בוצע"; the
// pencil opens the note's sheet). Archived notes are hidden; "להציג ארכיון"
// shows them under the list with "החזרה". No optimistic update: every
// control is locked until the refreshed page arrives, and the result shows
// in an inline-notice (also read by screen readers).

const copy = adminCopy.notes

const PRIMARY_WIDE =
  "h-12 w-full rounded-[4px] px-6 text-base font-semibold sm:w-auto"

export function NotesView({
  topics,
  topic,
  notes,
  showArchive,
}: {
  topics: readonly NoteTopic[]
  topic: NoteTopic | null
  notes: readonly Note[]
  showArchive: boolean
}) {
  const [notice, setNotice] = useState("")
  const announce = useCallback((text: string) => {
    // A repeated text is shown and announced again.
    setNotice("")
    queueMicrotask(() => setNotice(text))
  }, [])

  return (
    <AnnounceContext value={announce}>
      <div className="flex flex-col gap-6">
        <div aria-live="polite" className="empty:hidden">
          {notice && <InlineNotice tone="success">{notice}</InlineNotice>}
        </div>

        {topic === null ? (
          <EmptyTopics />
        ) : (
          <>
            <TopicSwitcher topics={topics} selectedId={topic.id} />
            <TopicSection
              key={topic.id}
              topic={topic}
              topics={topics}
              notes={notes}
              showArchive={showArchive}
            />
          </>
        )}
      </div>
    </AnnounceContext>
  )
}

// empty-state (DESIGN › empty-state): the sentence and one action.
function EmptyTopics() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg bg-muted px-4 py-6 text-center">
      <p className="font-heading text-[22px] leading-[1.3] font-light text-balance">
        {copy.emptyTopics}
      </p>
      <AddTopicButton className={PRIMARY_WIDE} />
    </div>
  )
}

// One link per topic, wrapping (no hidden scroll on the phone); the
// selected one in primary with aria-current, as the segmented-switch.
function TopicSwitcher({
  topics,
  selectedId,
}: {
  topics: readonly NoteTopic[]
  selectedId: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label={copy.topicsNav}>
        <ul className="flex flex-wrap gap-2">
          {topics.map((t) => {
            const current = t.id === selectedId
            return (
              <li key={t.id} className="min-w-0">
                <Link
                  href={topicHref(t.id)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 max-w-full items-center rounded-[4px] border px-4 text-[15px] font-semibold",
                    current
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground text-foreground hover:bg-muted"
                  )}
                >
                  <bdi className="truncate">{t.name}</bdi>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <AddTopicButton
        className={cn(TEXT_BUTTON, "self-start font-semibold")}
        plain
      />
    </div>
  )
}

// "+ נושא": a sheet with the name. A new topic is last; the page then shows
// it.
function AddTopicButton({
  className,
  plain = false,
}: {
  className: string
  plain?: boolean
}) {
  const id = useId()
  const router = useRouter()
  const announce = useAnnounce()
  const { pending, error, run, clearError } = useWorkAction()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [key, setKey] = useState(newIdempotencyKey)

  return (
    <>
      {plain ? (
        <button
          type="button"
          className={className}
          onClick={() => setOpen(true)}
        >
          {copy.addTopic}
        </button>
      ) : (
        <Button
          type="button"
          size="lg"
          className={className}
          onClick={() => setOpen(true)}
        >
          {copy.addTopic}
        </Button>
      )}
      <WorkPanel
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) clearError()
        }}
        busy={pending}
        title={copy.addTopic}
      >
        <TextForm
          id={`${id}-name`}
          label={copy.topicName}
          value={name}
          onChange={setName}
          max={MAX_TOPIC_NAME}
          submitLabel={copy.add}
          pending={pending}
          onSubmit={() => {
            let topicId: string | null = null
            run(
              async () => {
                const result = await addNoteTopicAction({
                  name,
                  idempotencyKey: key,
                })
                if (!result.ok) return result
                topicId = result.data.topicId
                return { ok: true, data: undefined }
              },
              () => {
                setName("")
                setKey(newIdempotencyKey())
                setOpen(false)
                announce(copy.topicAdded)
                if (topicId) router.push(topicHref(topicId))
              }
            )
          }}
        />
        <ErrorNotice code={error} />
      </WorkPanel>
    </>
  )
}

function TopicSection({
  topic,
  topics,
  notes,
  showArchive,
}: {
  topic: NoteTopic
  topics: readonly NoteTopic[]
  notes: readonly Note[]
  showArchive: boolean
}) {
  const active = notes.filter((n) => !n.archived)
  const archived = notes.filter((n) => n.archived)

  return (
    <section aria-labelledby="notes-topic" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-b border-border pb-2">
        <h2
          id="notes-topic"
          className="min-w-0 font-heading text-[26px] leading-[1.2] font-light break-words"
        >
          <bdi>{topic.name}</bdi>
        </h2>
        <TopicTools
          topic={topic}
          topics={topics}
          confirmedDelete={needsConfirmedDelete(notes)}
        />
      </div>

      {active.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg bg-muted px-4 py-6 text-center">
          <p className="font-heading text-[22px] leading-[1.3] font-light text-balance">
            {copy.emptyNotes}
          </p>
          <AddNote topicId={topic.id} wide />
        </div>
      ) : (
        <>
          <AddNote topicId={topic.id} />
          <ul className="flex flex-col gap-2">
            {active.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                notes={notes}
                topic={topic}
                topics={topics}
              />
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-col gap-3 pt-2">
        <Link
          href={topicHref(topic.id, !showArchive)}
          scroll={false}
          className={cn(TEXT_BUTTON, "self-start")}
        >
          {showArchive ? copy.hideArchive : copy.showArchive}
        </Link>
        {showArchive && (
          <section aria-labelledby="notes-archive" className="flex flex-col">
            <h3
              id="notes-archive"
              className="text-[13px] font-semibold text-muted-foreground"
            >
              {copy.archiveTitle}
            </h3>
            {archived.length === 0 ? (
              <p className="py-3 text-muted-foreground">{copy.noArchive}</p>
            ) : (
              <ul className="flex flex-col">
                {archived.map((note) => (
                  <ArchivedNoteItem key={note.id} note={note} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </section>
  )
}

// "עריכה" of a topic: a sheet with rename, up and down, and delete. An
// empty topic is deleted with the two-step question; a topic with notes
// (archived ones too) only through the delete_note_topic sensitive dialog,
// whose impact comes from the preview (the same plan as the delete).
function TopicTools({
  topic,
  topics,
  confirmedDelete,
}: {
  topic: NoteTopic
  topics: readonly NoteTopic[]
  confirmedDelete: boolean
}) {
  const id = useId()
  const router = useRouter()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(topic.name)
  const [key, setKey] = useState(newIdempotencyKey)
  const [deleteKey, setDeleteKey] = useState(newIdempotencyKey)
  const [previewing, setPreviewing] = useState(false)
  const [plan, setPlan] = useState<{
    name: string
    noteCount: number
  } | null>(null)
  const [confirming, setConfirming] = useState(false)
  // A failed preview shows inside the open sheet; a failure after the
  // dialog closed shows next to "עריכה".
  const [previewError, setPreviewError] = useState<ErrorCode | null>(null)
  const [rowError, setRowError] = useState<ErrorCode | null>(null)
  const topicIds = topics.map((t) => t.id)
  const index = topicIds.indexOf(topic.id)

  function deleted() {
    setOpen(false)
    setPlan(null)
    announce(copy.topicDeleted)
    router.replace("/admin/notes")
  }

  async function openDialog() {
    if (previewing) return
    setPreviewing(true)
    setPreviewError(null)
    setRowError(null)
    try {
      const result = await previewDeleteNoteTopicAction({ topicId: topic.id })
      if (!result.ok) {
        setPreviewError(result.code)
        router.refresh()
        return
      }
      setDeleteKey(newIdempotencyKey())
      setOpen(false)
      setPlan(result.data)
    } catch {
      setPreviewError("SERVER_ERROR")
    } finally {
      setPreviewing(false)
    }
  }

  async function confirmDelete() {
    if (confirming) return
    setConfirming(true)
    let code: ErrorCode
    try {
      const result = await deleteNoteTopicAction({
        topicId: topic.id,
        confirmed: true,
        idempotencyKey: deleteKey,
      })
      if (result.ok) {
        deleted()
        return
      }
      code = result.code
    } catch {
      code = "SERVER_ERROR"
    } finally {
      setConfirming(false)
    }
    // A refusal closes the dialog; the next try reads a new plan.
    setPlan(null)
    setRowError(code)
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        aria-label={copy.editTopic(topic.name)}
        onClick={() => {
          setName(topic.name)
          setPreviewError(null)
          setRowError(null)
          setOpen(true)
        }}
        className={cn(TEXT_BUTTON, "shrink-0")}
      >
        {copy.edit}
      </button>
      {rowError && (
        <InlineNotice tone="error" className="basis-full">
          {errorMessage(rowError)}
        </InlineNotice>
      )}
      <WorkPanel
        open={open}
        onOpenChange={setOpen}
        busy={pending || previewing}
        title={<bdi>{topic.name}</bdi>}
      >
        <TextForm
          id={`${id}-name`}
          label={copy.rename}
          value={name}
          onChange={setName}
          max={MAX_TOPIC_NAME}
          submitLabel={copy.save}
          pending={pending}
          onSubmit={() =>
            run(
              () =>
                renameNoteTopicAction({
                  topicId: topic.id,
                  name,
                  idempotencyKey: key,
                }),
              () => {
                setKey(newIdempotencyKey())
                setOpen(false)
                announce(copy.topicRenamed)
              }
            )
          }
        />
        <MoveButtons
          canUp={index > 0}
          canDown={index >= 0 && index < topicIds.length - 1}
          pending={pending}
          onMove={(delta) => {
            const ids = swapIds(topicIds, topic.id, delta)
            if (!ids) return
            run(
              () => setNoteTopicOrderAction({ ids }),
              () => announce(copy.moved(ids.indexOf(topic.id) + 1, ids.length))
            )
          }}
        />
        {!confirmedDelete ? (
          <DeleteStep
            label={copy.deleteTopic}
            question={copy.deleteEmptyTopicQuestion}
            pending={pending}
            onDelete={() =>
              run(
                () =>
                  deleteNoteTopicAction({
                    topicId: topic.id,
                    confirmed: false,
                    idempotencyKey: deleteKey,
                  }),
                deleted
              )
            }
          />
        ) : (
          <>
            <button
              type="button"
              className={cn(TEXT_BUTTON, "self-start text-error")}
              aria-busy={previewing || undefined}
              aria-disabled={pending || previewing || undefined}
              onClick={() => {
                if (pending || previewing) return
                void openDialog()
              }}
            >
              {copy.deleteTopic}
            </button>
            <ErrorNotice code={previewError} />
          </>
        )}
        <ErrorNotice code={error} />
      </WorkPanel>
      {plan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !confirming) setPlan(null)
          }}
          action="delete_note_topic"
          description={copy.deleteTopicDescription}
          impact={[
            { label: copy.impactTopic, value: <bdi>{plan.name}</bdi> },
            {
              label: copy.impactNotes,
              value: copy.impactNotesValue(plan.noteCount),
            },
          ]}
          checkboxLabel={copy.deleteTopicCheckbox(plan.name)}
          confirmLabel={copy.deleteTopic}
          destructive
          pending={confirming}
          onConfirm={confirmDelete}
        />
      )}
    </>
  )
}
