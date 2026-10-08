"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "lucide-react"

import { ImageUploadField } from "@/components/admin/image-upload-field"
import { RadioCardGroup } from "@/components/admin/radio-card"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import {
  createMediaAction,
  discardContentDraftAction,
  publishContentAction,
  saveContentDraftAction,
} from "./actions"
import {
  fieldErrorMessage,
  fieldErrors,
  missingStatementFields,
  sameContent,
  type ContentObject,
  type EditableSlug,
  type FieldError,
  type SectionRef,
} from "./content-items"
import { ContentStatusChip } from "./content-status-chip"
import { GalleryArrange } from "./gallery-arrange"
import {
  addItem,
  fieldId,
  fromContent,
  itemName,
  keptFields,
  moveItem,
  removeItem,
  sectionSpec,
  shownFor,
  swapItems,
  toContent,
  toggleItemHidden,
  type EditorItem,
  type EditorState,
  type ImageField,
  type ImageValue,
  type ListField,
  type TextField,
} from "./section-fields"

const copy = adminCopy.content
const BUTTON = "h-12 text-base"
const OUTLINE = `${BUTTON} rounded-[4px] border-foreground bg-transparent`

type Notice =
  { tone: "success"; text: string } | { tone: "error"; text: string }

type Errors = Record<string, FieldError>

// The editor of one section (stories 5.1, 5.3), built from the section's
// field description (section-fields.ts): text fields, or a list of items
// that are added, moved up and down, hidden and shown, and deleted, all kept
// in the draft until publishing. "save draft", "preview" and "publish"
// (only when there is something to publish). Preview and publish save a
// changed form first, so they always act on what is on the screen. The
// content is checked with the section's schema before saving (the action
// checks again); an error is shown next to its field, also inside an item,
// and focus moves to the first one; a failed save keeps the previous draft.
// The publish key is kept until a publish succeeds, so a retry after a lost
// answer publishes once (AD-5).
export function ContentEditor({
  slug,
  sectionKey,
  kind,
  initial,
  keep: initialKeep = {},
  hasPending,
  publishKey,
  previewHref,
  draftInvalid,
  backHref = "/admin/content",
  backLabel = copy.backToList,
  previewUrls = {},
  statementBlock = false,
}: {
  // The accessibility statement before its first publish (story 5.5):
  // "publish" is aria-disabled, with the list of the missing required
  // fields above it, while the form lacks one.
  statementBlock?: boolean
  // Signed URLs of the saved images' draft files, by media id (story 5.4).
  previewUrls?: Record<string, string>
  slug: EditableSlug
  sectionKey: string
  kind: string
  initial: EditorState
  keep?: ContentObject
  hasPending: boolean
  publishKey: string
  previewHref?: string
  draftInvalid: boolean
  backHref?: string
  backLabel?: string
}) {
  const router = useRouter()
  const ref: SectionRef = useMemo(
    () => ({ slug, key: sectionKey, kind }),
    [slug, sectionKey, kind]
  )
  const spec = useMemo(() => sectionSpec(ref), [ref])
  const [busy, startTransition] = useTransition()
  const [busyWith, setBusyWith] = useState<
    "save" | "preview" | "publish" | "discard" | null
  >(null)
  const [state, setState] = useState<EditorState>(initial)
  const [saved, setSaved] = useState<EditorState>(initial)
  const [keep, setKeep] = useState<ContentObject>(initialKeep)
  // The item whose delete waits for its inline confirm (one at a time), and
  // the inline confirm of "back to what the site shows".
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [pending, setPending] = useState(hasPending)
  // A ref, so a key rotated by the save inside a publish is the one sent.
  const keyRef = useRef(publishKey)
  const [errors, setErrors] = useState<Errors | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [announcement, setAnnouncement] = useState("")
  // The gallery's arrange view (user decision 2026-10-08) instead of the
  // list; the same items in the same draft.
  const [arranging, setArranging] = useState(false)
  const noticeRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  // After a change: the element to focus once rendered (an id), or the
  // first invalid field ("error").
  const focusTarget = useRef<string | null>(null)
  const setFocusTarget = (target: string) => {
    focusTarget.current = target
  }
  const nextId = useRef(0)

  // The server's answer after a refresh (state adjusted during render).
  const [serverPending, setServerPending] = useState(hasPending)
  if (serverPending !== hasPending) {
    setServerPending(hasPending)
    setPending(hasPending)
  }

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  // Runs after every render: moves the focus asked for by the last change.
  useEffect(() => {
    const target = focusTarget.current
    if (!target) return
    focusTarget.current = null
    const element =
      target === "error"
        ? formRef.current?.querySelector<HTMLElement>(
            '[aria-invalid="true"], [data-focus-error="true"]'
          )
        : document.getElementById(target)
    element?.focus()
  })

  const content = toContent(spec, state, keep)
  const dirty = !sameContent(content, toContent(spec, saved, keep))

  const fail = (code: ErrorCode) =>
    setNotice({ tone: "error", text: errorMessage(code) })

  function update(next: EditorState) {
    setState(next)
    // A change closes the "back to what the site shows" confirm.
    setConfirmingDiscard(false)
    // An error goes away once its field is valid.
    if (errors) setErrors(fieldErrors(ref, toContent(spec, next, keep)))
  }

  // Saves the form when it changed. true when the draft on the server is
  // the form's content.
  async function saveIfDirty(): Promise<boolean> {
    if (!dirty) return true
    const found = fieldErrors(ref, content)
    setErrors(found)
    if (found) {
      setFocusTarget("error")
      return false
    }
    const answer = await saveContentDraftAction({
      slug,
      key: sectionKey,
      content,
    })
    if (!answer.ok) {
      if (answer.code === "INVALID_INPUT" && answer.detail?.field) {
        setErrors({ [answer.detail.field]: { kind: "invalid" } })
        setFocusTarget("error")
      } else {
        fail(answer.code)
      }
      return false
    }
    setSaved(state)
    setPending(true)
    // A new draft is a new publish: a kept key would replay the old result.
    keyRef.current = newIdempotencyKey()
    return true
  }

  function run(
    action: "save" | "preview" | "publish" | "discard",
    after: () => Promise<void>
  ) {
    if (busy) return
    setBusyWith(action)
    setNotice(null)
    startTransition(async () => {
      try {
        await after()
      } catch {
        // A thrown Server Action (network drop): nothing is known to be saved.
        fail("SERVER_ERROR")
      } finally {
        setBusyWith(null)
      }
    })
  }

  const save = () =>
    run("save", async () => {
      if (!dirty) {
        setNotice({ tone: "success", text: copy.saved })
        return
      }
      if (await saveIfDirty()) {
        setNotice({ tone: "success", text: copy.saved })
        router.refresh()
      }
    })

  const preview = () =>
    run("preview", async () => {
      if (previewHref && (await saveIfDirty())) router.push(previewHref)
    })

  const publish = () =>
    run("publish", async () => {
      if (!(await saveIfDirty())) return
      const answer = await publishContentAction({
        slug,
        idempotencyKey: keyRef.current,
      })
      if (!answer.ok) {
        if (answer.code === "INVALID_INPUT") {
          setNotice({ tone: "error", text: copy.draftInvalid })
        } else fail(answer.code)
        return
      }
      keyRef.current = newIdempotencyKey()
      setPending(false)
      setNotice({
        tone: "success",
        text: answer.data.changed > 0 ? copy.published : copy.nothingToPublish,
      })
      router.refresh()
    })

  const canPublish = pending || dirty

  // Undo, level 1: the form goes back to the saved draft (no server call).
  function revert() {
    setState(saved)
    setErrors(null)
    setConfirmingId(null)
    setNotice(null)
    setAnnouncement(copy.undo.reverted)
    // The button is gone once the form is not changed.
    setFocusTarget("save-draft")
  }

  // Undo, level 2: the saved draft becomes what the site shows, after an
  // inline confirm. Offered only when the form has no unsaved change (those
  // are undone with level 1 first).
  const discard = () =>
    run("discard", async () => {
      const answer = await discardContentDraftAction({
        slug,
        key: sectionKey,
      })
      if (!answer.ok) {
        fail(answer.code)
        return
      }
      const next = fromContent(spec, answer.data.content)
      setState(next)
      setSaved(next)
      setKeep(keptFields(ref, answer.data.content))
      setErrors(null)
      setConfirmingId(null)
      setConfirmingDiscard(false)
      setPending(false)
      // A new draft is a new publish.
      keyRef.current = newIdempotencyKey()
      setNotice({ tone: "success", text: copy.undo.discarded })
      router.refresh()
    })

  // The list's actions. Each keeps the focus on something that is still
  // there and announces what changed (aria-live).
  function onAdd(field: ListField) {
    nextId.current += 1
    const id = `n${nextId.current}`
    const items = addItem(state.items, field, id)
    update({ ...state, items })
    setAnnouncement(copy.item.added)
    // The new item's first shown field (a choice is a radio group: its
    // first option).
    const added = items[items.length - 1]
    const first = field.fields.find((sub) => shownFor(sub, added.values))
    setFocusTarget(
      first?.type === "choice"
        ? `${id}-${first.name}-0`
        : fieldId(`items.${state.items.length}.${first?.name ?? ""}`)
    )
  }

  function onMove(field: ListField, index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= state.items.length) return
    const item = state.items[index]
    const items = moveItem(state.items, index, delta)
    update({ ...state, items })
    setAnnouncement(
      copy.item.moved(itemName(field, item, index), target + 1, items.length)
    )
    // The same button, now at the item's new place.
    setFocusTarget(`${delta < 0 ? "up" : "down"}-${item.id}`)
  }

  function onToggleHidden(field: ListField, index: number) {
    const item = state.items[index]
    const name = itemName(field, item, index)
    update({ ...state, items: toggleItemHidden(state.items, index) })
    setAnnouncement(
      item.hidden ? copy.item.shownNow(name) : copy.item.hiddenNow(name)
    )
  }

  // "Delete" asks first, in the item's row (one row at a time).
  function onAskRemove(index: number) {
    const item = state.items[index]
    setConfirmingId(item.id)
    setFocusTarget(`confirm-${item.id}-q`)
  }

  function onCancelRemove(index: number) {
    const item = state.items[index]
    setConfirmingId(null)
    setFocusTarget(`remove-${item.id}`)
  }

  function onRemove(field: ListField, index: number) {
    const item = state.items[index]
    const next = state.items[index + 1]
    update({ ...state, items: removeItem(state.items, index) })
    setConfirmingId(null)
    setAnnouncement(copy.item.removed(itemName(field, item, index)))
    // The next item's name, else the list's heading.
    setFocusTarget(next ? `item-${next.id}` : "list-heading")
  }

  // The statement's missing required fields, live from the form (story
  // 5.5), with their labels; publishing waits for them.
  const missing = statementBlock
    ? missingStatementFields(content).map((name) => ({
        name,
        label:
          spec.fields.find(
            (field): field is TextField =>
              field.type === "text" && field.name === name
          )?.label ?? name,
      }))
    : []
  const blocked = missing.length > 0

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      className="flex flex-col gap-6"
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {draftInvalid && !dirty && (
        <InlineNotice tone="warning">{copy.draftInvalid}</InlineNotice>
      )}

      {spec.fields.map((field) =>
        field.type === "text" ? (
          <TextInput
            key={field.name}
            field={field}
            path={field.name}
            value={state.text[field.name] ?? ""}
            error={errors?.[field.name]}
            onChange={(value) =>
              update({ ...state, text: { ...state.text, [field.name]: value } })
            }
          />
        ) : field.type === "choice" ? (
          <RadioCardGroup
            key={field.name}
            legend={field.label}
            name={`block-${field.name}`}
            options={field.options}
            value={state.text[field.name] ?? field.defaultValue}
            onChange={(value) =>
              update({ ...state, text: { ...state.text, [field.name]: value } })
            }
          />
        ) : field.type === "image" ? (
          <ImageInput
            key={field.name}
            field={field}
            path={field.name}
            value={state.images?.[field.name] ?? null}
            previewUrls={previewUrls}
            error={errors?.[field.name]}
            onChange={(value) =>
              update({
                ...state,
                images: { ...state.images, [field.name]: value },
              })
            }
          />
        ) : kind === "gallery" && arranging ? (
          <div key={field.name} className="flex flex-col gap-3">
            <ArrangeSwitch arranging={arranging} onChange={setArranging} />
            <GalleryArrange
              items={state.items}
              columns={state.text.columns ?? "3"}
              previewUrls={previewUrls}
              announce={setAnnouncement}
              onSwap={(a, b) =>
                update({ ...state, items: swapItems(state.items, a, b) })
              }
            />
          </div>
        ) : (
          <div key={field.name} className="flex flex-col gap-3">
            {kind === "gallery" && (
              <ArrangeSwitch arranging={arranging} onChange={setArranging} />
            )}
            <ItemList
              key={field.name}
              field={field}
              items={state.items}
              errors={errors}
              previewUrls={previewUrls}
              onImage={(index, name, value) =>
                update({
                  ...state,
                  items: state.items.map((item, i) =>
                    i === index
                      ? { ...item, images: { ...item.images, [name]: value } }
                      : item
                  ),
                })
              }
              onChange={(index, name, value) =>
                update({
                  ...state,
                  items: state.items.map((item, i) =>
                    i === index
                      ? { ...item, values: { ...item.values, [name]: value } }
                      : item
                  ),
                })
              }
              onAdd={() => onAdd(field)}
              onMove={(index, delta) => onMove(field, index, delta)}
              onToggleHidden={(index) => onToggleHidden(field, index)}
              confirmingId={confirmingId}
              onAskRemove={onAskRemove}
              onCancelRemove={onCancelRemove}
              onRemove={(index) => onRemove(field, index)}
            />
          </div>
        )
      )}

      {spec.hideable && (
        <div className="flex flex-col gap-3">
          {state.hidden && (
            <InlineNotice tone="warning">
              {copy.sectionHiddenNotice}
            </InlineNotice>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => update({ ...state, hidden: !state.hidden })}
            className={cn(OUTLINE, "self-start")}
          >
            {state.hidden ? copy.showSection : copy.hideSection}
          </Button>
        </div>
      )}

      {notice && (
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>
        </div>
      )}

      {blocked && (
        <InlineNotice
          tone="warning"
          actions={
            <ul className="flex flex-wrap justify-center gap-x-4">
              {missing.map((field) => (
                <li key={field.name}>
                  <a
                    href={`#${fieldId(field.name)}`}
                    onClick={(event) => {
                      event.preventDefault()
                      document.getElementById(fieldId(field.name))?.focus()
                    }}
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                  >
                    {field.label}
                  </a>
                </li>
              ))}
            </ul>
          }
        >
          <span id="publish-blocked">{copy.statement.blocked}</span>
        </InlineNotice>
      )}

      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-end">
        {(canPublish || blocked) && (
          <Button
            type="button"
            size="lg"
            onClick={blocked ? undefined : publish}
            className={`${BUTTON} rounded-[4px] aria-disabled:opacity-50`}
            aria-busy={busyWith === "publish" || undefined}
            aria-disabled={busy || blocked || undefined}
            aria-describedby={blocked ? "publish-blocked" : undefined}
          >
            {busyWith === "publish" && <Spinner aria-hidden />}
            {copy.publish}
          </Button>
        )}
        {previewHref && (
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={preview}
            className={OUTLINE}
            aria-busy={busyWith === "preview" || undefined}
            aria-disabled={busy || undefined}
          >
            {busyWith === "preview" && <Spinner aria-hidden />}
            {copy.preview}
          </Button>
        )}
        <Button
          id="save-draft"
          type="submit"
          size="lg"
          variant="outline"
          className={OUTLINE}
          aria-busy={busyWith === "save" || undefined}
          aria-disabled={busy || undefined}
        >
          {busyWith === "save" && <Spinner aria-hidden />}
          {copy.saveDraft}
        </Button>
      </div>

      {dirty && (
        <Button
          type="button"
          variant="ghost"
          onClick={revert}
          className={cn(LINK_BUTTON, "self-start")}
        >
          {copy.undo.revert}
        </Button>
      )}

      {pending &&
        !dirty &&
        (confirmingDiscard ? (
          <InlineConfirm
            id="discard"
            question={copy.undo.discardQuestion}
            detail={copy.undo.discardDetail}
            confirmLabel={copy.undo.discardConfirm}
            cancelLabel={copy.undo.cancel}
            busy={busyWith === "discard"}
            onConfirm={discard}
            onCancel={() => {
              setConfirmingDiscard(false)
              setFocusTarget("discard-open")
            }}
          />
        ) : (
          <Button
            id="discard-open"
            type="button"
            variant="ghost"
            onClick={() => {
              setConfirmingDiscard(true)
              setFocusTarget("discard-q")
            }}
            className={cn(LINK_BUTTON, "self-start")}
          >
            {copy.undo.discard}
          </Button>
        ))}

      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-4"
      >
        {backLabel}
      </Link>
    </form>
  )
}

// One text field (input, or textarea when multiline) with its hint and its
// error under it (aria-describedby).
function TextInput({
  field,
  path,
  value,
  error,
  onChange,
}: {
  field: TextField
  path: string
  value: string
  error: FieldError | undefined
  onChange: (value: string) => void
}) {
  const id = fieldId(path)
  const hintId = field.hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ")
  const common = {
    id,
    name: path,
    value,
    maxLength: field.maxLength,
    dir: field.ltr ? ("ltr" as const) : undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => onChange(event.target.value),
  }
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
      {field.multiline ? (
        <Textarea
          {...common}
          rows={field.large ? 18 : 4}
          className={cn("text-base", field.large ? "min-h-96" : "min-h-28")}
        />
      ) : (
        <Input
          {...common}
          type={field.inputType ?? "text"}
          inputMode={field.inputType === "tel" ? "tel" : undefined}
          autoComplete="off"
          className="h-12 text-base"
        />
      )}
      {field.hint && (
        <FieldDescription id={hintId}>{field.hint}</FieldDescription>
      )}
      {error && (
        <p id={errorId} className="text-[15px] text-error">
          {fieldErrorMessage(error)}
        </p>
      )}
    </Field>
  )
}

// An image field (story 5.4): image-upload-field with the field's aspect,
// its saved draft file as the preview, and its error under it.
function ImageInput({
  field,
  path,
  value,
  previewUrls,
  error,
  removable = true,
  onChange,
}: {
  field: ImageField
  path: string
  value: ImageValue | null
  previewUrls: Record<string, string>
  error: FieldError | undefined
  // false in a list item: deleting the item removes its image.
  removable?: boolean
  onChange: (value: ImageValue | null) => void
}) {
  return (
    <ImageUploadField
      id={fieldId(path)}
      label={field.label}
      hint={field.hint}
      altHint={field.altHint}
      aspectRatio={field.aspects[0]?.ratio}
      value={value}
      previewUrl={value ? previewUrls[value.media_id] : null}
      error={error ? fieldErrorMessage(error) : null}
      onChange={onChange}
      createMedia={createMediaAction}
      removable={removable}
    />
  )
}

// "רשימה | סידור" (DESIGN › segmented-switch): two views of the gallery's
// photos; the chosen one in primary, aria-pressed.
function ArrangeSwitch({
  arranging,
  onChange,
}: {
  arranging: boolean
  onChange: (arranging: boolean) => void
}) {
  const arrange = copy.arrange
  return (
    <div
      role="group"
      aria-label={arrange.views}
      className="inline-flex self-start overflow-hidden rounded-lg border border-muted-foreground"
    >
      {[
        { value: false, label: arrange.list },
        { value: true, label: arrange.grid },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={arranging === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-11 px-4 text-[15px] font-semibold",
            arranging === option.value
              ? "bg-primary text-primary-foreground"
              : "bg-transparent text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const ICON_BUTTON =
  "size-11 rounded-[4px] border-foreground bg-transparent p-0 aria-disabled:opacity-50"
const LINK_BUTTON =
  "h-11 px-2 text-[15px] font-normal underline underline-offset-[3px] hover:bg-muted"

// An inline confirm (user decision 2026-10-05): a question with a
// destructive action and "cancel", in place of the button that asked. The
// question takes the focus when it opens (tabIndex -1), as in a dialog.
function InlineConfirm({
  id,
  question,
  detail,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  id: string
  question: string
  detail?: string
  confirmLabel: string
  cancelLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="group"
      aria-labelledby={`${id}-q`}
      className="flex flex-col gap-3 rounded-[8px] bg-muted p-4"
    >
      <p
        id={`${id}-q`}
        tabIndex={-1}
        className="text-base leading-[1.35] font-semibold break-words outline-none"
      >
        {question}
      </p>
      {detail && <p className="text-[15px] text-pretty">{detail}</p>}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={() => {
            if (!busy) onConfirm()
          }}
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
          className="h-11 rounded-[4px] bg-error px-6 text-[15px] font-semibold text-primary-foreground hover:bg-error/90"
        >
          {busy && <Spinner aria-hidden />}
          {confirmLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="h-11 rounded-[4px] border-foreground bg-transparent px-6 text-[15px]"
        >
          {cancelLabel}
        </Button>
      </div>
    </div>
  )
}

// A list of items (DESIGN › content-section-row): each item is a row with
// its name, a "hidden" chip, its fields, and its actions outside the
// fields: up and down (44x44, aria-disabled at the ends), hide / show and
// delete. "+ add" at the end opens an empty item and focuses its first
// field.
export function ItemList({
  field,
  items,
  errors,
  previewUrls = {},
  onChange,
  onImage,
  onAdd,
  onMove,
  onToggleHidden,
  confirmingId,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  field: ListField
  items: readonly EditorItem[]
  errors: Errors | null
  previewUrls?: Record<string, string>
  onChange: (index: number, name: string, value: string) => void
  onImage?: (index: number, name: string, value: ImageValue | null) => void
  onAdd: () => void
  onMove: (index: number, delta: -1 | 1) => void
  onToggleHidden: (index: number) => void
  confirmingId: string | null
  onAskRemove: (index: number) => void
  onCancelRemove: (index: number) => void
  onRemove: (index: number) => void
}) {
  const listError = errors?.items
  return (
    <section aria-labelledby="list-heading" className="flex flex-col gap-3">
      <h2
        id="list-heading"
        tabIndex={-1}
        className="text-base font-semibold outline-none"
      >
        {copy.itemCount(items.length)}
      </h2>
      {listError && (
        <p className="text-[15px] text-error">{fieldErrorMessage(listError)}</p>
      )}
      {field.addAtTop && items.length > 0 && (
        <Button
          type="button"
          variant="outline"
          onClick={onAdd}
          className={cn(OUTLINE, "self-start")}
        >
          <PlusIcon aria-hidden strokeWidth={1.5} className="size-5" />
          {field.addLabel}
        </Button>
      )}
      {items.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">{copy.emptyList}</p>
      ) : (
        <ol className="flex flex-col border-t border-border">
          {items.map((item, index) => {
            const name = itemName(field, item, index)
            const first = index === 0
            const last = index === items.length - 1
            return (
              <li
                key={item.id}
                className="flex flex-col gap-4 border-b border-border py-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    id={`item-${item.id}`}
                    tabIndex={-1}
                    className="min-w-0 flex-1 text-base font-semibold break-words outline-none"
                  >
                    {name}
                  </h3>
                  {item.hidden && <ContentStatusChip status="hidden" />}
                </div>
                {item.hidden && (
                  <p className="-mt-2 text-[15px] text-muted-foreground">
                    {copy.hiddenItemHint}
                  </p>
                )}
                {field.fields.map((sub, subIndex) => {
                  if (!shownFor(sub, item.values)) return null
                  const path = `items.${index}.${sub.name}`
                  const key = `${sub.name}-${subIndex}`
                  if (sub.type === "choice") {
                    return (
                      <RadioCardGroup
                        key={key}
                        legend={sub.label}
                        name={`${item.id}-${sub.name}`}
                        options={sub.options}
                        value={item.values[sub.name] ?? sub.defaultValue}
                        onChange={(value) => onChange(index, sub.name, value)}
                      />
                    )
                  }
                  if (sub.type === "image") {
                    return (
                      <ImageInput
                        key={key}
                        field={sub}
                        path={path}
                        value={item.images?.[sub.name] ?? null}
                        previewUrls={previewUrls}
                        error={errors?.[path]}
                        removable={false}
                        onChange={(value) => onImage?.(index, sub.name, value)}
                      />
                    )
                  }
                  return (
                    <TextInput
                      key={key}
                      field={sub}
                      path={path}
                      value={item.values[sub.name] ?? ""}
                      error={errors?.[path]}
                      onChange={(value) => onChange(index, sub.name, value)}
                    />
                  )
                })}
                {confirmingId === item.id ? (
                  <InlineConfirm
                    id={`confirm-${item.id}`}
                    question={copy.item.confirmRemove(name)}
                    confirmLabel={copy.item.remove}
                    cancelLabel={copy.item.cancel}
                    onConfirm={() => onRemove(index)}
                    onCancel={() => onCancelRemove(index)}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      id={`up-${item.id}`}
                      type="button"
                      variant="outline"
                      className={ICON_BUTTON}
                      aria-label={copy.item.moveUp(name)}
                      aria-disabled={first || undefined}
                      onClick={() => onMove(index, -1)}
                    >
                      <ChevronUpIcon
                        aria-hidden
                        strokeWidth={1.5}
                        className="size-5"
                      />
                    </Button>
                    <Button
                      id={`down-${item.id}`}
                      type="button"
                      variant="outline"
                      className={ICON_BUTTON}
                      aria-label={copy.item.moveDown(name)}
                      aria-disabled={last || undefined}
                      onClick={() => onMove(index, 1)}
                    >
                      <ChevronDownIcon
                        aria-hidden
                        strokeWidth={1.5}
                        className="size-5"
                      />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className={LINK_BUTTON}
                      onClick={() => onToggleHidden(index)}
                    >
                      {item.hidden ? copy.item.show : copy.item.hide}
                      <span className="sr-only"> {name}</span>
                    </Button>
                    <Button
                      id={`remove-${item.id}`}
                      type="button"
                      variant="ghost"
                      className={LINK_BUTTON}
                      onClick={() => onAskRemove(index)}
                    >
                      {copy.item.remove}
                      <span className="sr-only"> {name}</span>
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={onAdd}
        className={cn(OUTLINE, "self-start")}
      >
        <PlusIcon aria-hidden strokeWidth={1.5} className="size-5" />
        {field.addLabel}
      </Button>
    </section>
  )
}
