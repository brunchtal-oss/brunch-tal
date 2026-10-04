"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

import { publishContentAction, saveContentDraftAction } from "./actions"
import {
  fieldErrorMessage,
  fieldErrors,
  type EditableSlug,
  type FieldError,
} from "./content-items"

const copy = adminCopy.content
const BUTTON = "h-12 text-base"

export type EditorField = {
  name: string
  label: string
  hint?: string
  multiline?: boolean
  maxLength?: number
  type?: "text" | "tel" | "url"
  // Numbers and links read left to right inside the RTL form.
  ltr?: boolean
}

type Values = Record<string, string>

type Notice =
  { tone: "success"; text: string } | { tone: "error"; text: string }

function same(a: Values, b: Values): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => (a[key] ?? "") === (b[key] ?? ""))
}

// The editor of one section (story 5.1): the fields of its kind, "save
// draft", "preview" (when the page has one) and "publish" (only when there
// is something to publish). Preview and publish save a changed form first,
// so they always act on what is on the screen. Each field is checked with
// the kind's schema before saving (the action checks again); a failed save
// keeps the previous draft. The publish key is kept until a publish
// succeeds, so a retry after a lost answer publishes once (AD-5).
export function ContentEditor({
  slug,
  kind,
  fields,
  initial,
  hasPending,
  publishKey,
  previewHref,
  draftInvalid,
}: {
  slug: EditableSlug
  kind: string
  fields: readonly EditorField[]
  initial: Values
  hasPending: boolean
  publishKey: string
  previewHref?: string
  draftInvalid: boolean
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [busyWith, setBusyWith] = useState<
    "save" | "preview" | "publish" | null
  >(null)
  const [values, setValues] = useState<Values>(initial)
  const [saved, setSaved] = useState<Values>(initial)
  const [pending, setPending] = useState(hasPending)
  // A ref, so a key rotated by the save inside a publish is the one sent.
  const keyRef = useRef(publishKey)
  const [errors, setErrors] = useState<Record<string, FieldError> | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)

  // The server's answer after a refresh (state adjusted during render).
  const [serverPending, setServerPending] = useState(hasPending)
  if (serverPending !== hasPending) {
    setServerPending(hasPending)
    setPending(hasPending)
  }

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const dirty = !same(values, saved)

  const fail = (code: ErrorCode) =>
    setNotice({ tone: "error", text: errorMessage(code) })

  // Saves the form when it changed. true when the draft on the server is
  // the form's content.
  async function saveIfDirty(): Promise<boolean> {
    if (!dirty) return true
    const found = fieldErrors(kind, values)
    setErrors(found)
    if (found) {
      focusFirstError(found)
      return false
    }
    const answer = await saveContentDraftAction({ slug, content: values })
    if (!answer.ok) {
      if (answer.code === "INVALID_INPUT" && answer.detail?.field) {
        const field = answer.detail.field
        setErrors({ [field]: { kind: "invalid" } })
        focusFirstError({ [field]: { kind: "invalid" } })
      } else {
        fail(answer.code)
      }
      return false
    }
    setSaved(values)
    setPending(true)
    // A new draft is a new publish: a kept key would replay the old result.
    keyRef.current = newIdempotencyKey()
    return true
  }

  function focusFirstError(found: Record<string, FieldError>) {
    const first = fields.find((field) => field.name in found)
    if (first) document.getElementById(`field-${first.name}`)?.focus()
  }

  function run(
    action: "save" | "preview" | "publish",
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

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      className="flex flex-col gap-6"
    >
      {draftInvalid && !dirty && (
        <InlineNotice tone="warning">{copy.draftInvalid}</InlineNotice>
      )}

      {fields.map((field) => {
        const error = errors?.[field.name]
        const hintId = field.hint ? `field-${field.name}-hint` : undefined
        const errorId = error ? `field-${field.name}-error` : undefined
        const describedBy = [hintId, errorId].filter(Boolean).join(" ")
        const common = {
          id: `field-${field.name}`,
          name: field.name,
          value: values[field.name] ?? "",
          maxLength: field.maxLength,
          dir: field.ltr ? ("ltr" as const) : undefined,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy || undefined,
          onChange: (
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
          ) => {
            const next = { ...values, [field.name]: event.target.value }
            setValues(next)
            // A field's error goes away once it is valid.
            if (errors?.[field.name]) {
              const found = fieldErrors(kind, next)
              setErrors(found)
            }
          },
        }
        return (
          <Field key={field.name} data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`field-${field.name}`}>
              {field.label}
            </FieldLabel>
            {field.multiline ? (
              <Textarea {...common} rows={4} className="min-h-28 text-base" />
            ) : (
              <Input
                {...common}
                type={field.type ?? "text"}
                inputMode={field.type === "tel" ? "tel" : undefined}
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
      })}

      {notice && (
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-end">
        {canPublish && (
          <Button
            type="button"
            size="lg"
            onClick={publish}
            className={`${BUTTON} rounded-[4px]`}
            aria-busy={busyWith === "publish" || undefined}
            aria-disabled={busy || undefined}
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
            className={`${BUTTON} rounded-[4px] border-foreground bg-transparent`}
            aria-busy={busyWith === "preview" || undefined}
            aria-disabled={busy || undefined}
          >
            {busyWith === "preview" && <Spinner aria-hidden />}
            {copy.preview}
          </Button>
        )}
        <Button
          type="submit"
          size="lg"
          variant="outline"
          className={`${BUTTON} rounded-[4px] border-foreground bg-transparent`}
          aria-busy={busyWith === "save" || undefined}
          aria-disabled={busy || undefined}
        >
          {busyWith === "save" && <Spinner aria-hidden />}
          {copy.saveDraft}
        </Button>
      </div>

      <Link
        href="/admin/content"
        className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-4"
      >
        {copy.backToList}
      </Link>
    </form>
  )
}
