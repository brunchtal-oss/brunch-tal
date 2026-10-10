"use client"

import { useRef, useState } from "react"

import {
  asSaveResult,
  ValueChangeRow,
  type ValueSaveResult,
} from "@/components/admin/value-change-row"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { checkTemplate, renderSample } from "@/lib/admin/template-check"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"

import { updateTemplateAction } from "../actions"

const copy = adminCopy.settings.templates

export type TemplateRow = {
  type: string
  recipient_kind: "customer" | "admin"
  push: boolean
  body_mode: "template" | "template_or_override" | "override"
  title: string
  body: string | null
  allowed_vars: string[]
  version: number
}

type Part = "title" | "body"
const MAX: Record<Part, number> = { title: 200, body: 1000 }

// Why the text cannot be saved, or null. The same rules as the RPC (the
// server decides): 1..max characters after trimming, and checkTemplate.
export function templateProblem(
  part: Part,
  text: string,
  allowed: readonly string[]
): string | null {
  const trimmed = text.trim()
  // Code points, like char_length in the RPC (an emoji is one).
  const length = [...trimmed].length
  if (length === 0) return errorMessage("FIELD_REQUIRED")
  if (length > MAX[part]) return copy.tooLong(MAX[part])
  const check = checkTemplate(trimmed, allowed)
  if (check.ok) return null
  return check.reason === "unknown_field"
    ? copy.unknownField(check.field)
    : copy.unbalanced
}

// The editor of one template (story 4.7): the title and, unless the body is
// written at each send (override), the body, each in its own
// value-change-row ("old ← new", "applies to new notifications only").
// Chips add an allowed {field} where the caret was in the last focused
// field; the hint under a field comes from checkTemplate before saving, and
// the server checks again (TEMPLATE_INVALID). The preview renders the draft
// as a notification-item with sample values.
export function TemplateEditor({ row }: { row: TemplateRow }) {
  const hasBody = row.body_mode !== "override"
  const [title, setTitle] = useState(row.title)
  const [body, setBody] = useState(row.body ?? "")
  const [target, setTarget] = useState<Part>(hasBody ? "body" : "title")
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const titleProblem = templateProblem("title", title, row.allowed_vars)
  const bodyProblem = hasBody
    ? templateProblem("body", body, row.allowed_vars)
    : null
  const titleNew =
    !titleProblem && title.trim() !== row.title ? title.trim() : null
  const bodyNew =
    hasBody && !bodyProblem && body.trim() !== (row.body ?? "")
      ? body.trim()
      : null

  const save =
    (part: Part) =>
    async (key: string): Promise<ValueSaveResult | null> => {
      const next = part === "title" ? titleNew : bodyNew
      if (next === null) return null
      const result = await updateTemplateAction({
        type: row.type,
        title: part === "title" ? next : row.title,
        body: hasBody ? (part === "body" ? next : row.body) : null,
        expectedVersion: row.version,
        idempotencyKey: key,
      })
      return asSaveResult(result)
    }

  // Adds "{field}" at the caret of the target field and puts the caret
  // after it.
  const insertField = (name: string) => {
    const token = `{${name}}`
    const element = target === "title" ? titleRef.current : bodyRef.current
    const current = target === "title" ? title : body
    const start = element?.selectionStart ?? current.length
    const end = element?.selectionEnd ?? current.length
    const next = current.slice(0, start) + token + current.slice(end)
    if (target === "title") setTitle(next)
    else setBody(next)
    requestAnimationFrame(() => {
      if (!element) return
      element.focus()
      const caret = start + token.length
      element.setSelectionRange(caret, caret)
    })
  }

  const samples = Object.fromEntries(
    row.allowed_vars.map((name) => [name, copy.samples[name] ?? name])
  )

  return (
    <div className="flex flex-col gap-8">
      <p className="text-[15px] text-muted-foreground">
        {row.recipient_kind === "admin"
          ? copy.recipient.admin
          : copy.recipient.customer}
        {row.push && ` · ${copy.push}`}
      </p>

      {row.type === "purchase_new_card" && (
        <InlineNotice tone="info">{copy.cardTipNote}</InlineNotice>
      )}

      <FieldChips allowed={row.allowed_vars} onInsert={insertField} />

      <ul className="flex flex-col divide-y divide-border border-y border-border">
        <li className="py-6">
          <ValueChangeRow
            label={copy.fields.title}
            oldValue={row.title}
            newValue={titleNew}
            scope={copy.scope}
            onSave={save("title")}
            onCancel={() => setTitle(row.title)}
          >
            <Field data-invalid={titleProblem ? true : undefined}>
              <FieldLabel htmlFor="template-title">
                {copy.fields.title}
              </FieldLabel>
              <Input
                ref={titleRef}
                id="template-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onFocus={() => setTarget("title")}
                autoComplete="off"
                aria-invalid={titleProblem ? true : undefined}
                aria-describedby={
                  titleProblem ? "template-title-error" : undefined
                }
                className="h-12 text-base"
              />
              {titleProblem && (
                <p id="template-title-error" className="text-[15px] text-error">
                  {titleProblem}
                </p>
              )}
            </Field>
          </ValueChangeRow>
        </li>
        <li className="py-6">
          {hasBody ? (
            <ValueChangeRow
              label={copy.fields.body}
              oldValue={row.body ?? ""}
              newValue={bodyNew}
              scope={copy.scope}
              onSave={save("body")}
              onCancel={() => setBody(row.body ?? "")}
            >
              <Field data-invalid={bodyProblem ? true : undefined}>
                <FieldLabel htmlFor="template-body">
                  {copy.fields.body}
                </FieldLabel>
                <Textarea
                  ref={bodyRef}
                  id="template-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  onFocus={() => setTarget("body")}
                  aria-invalid={bodyProblem ? true : undefined}
                  aria-describedby={
                    bodyProblem ? "template-body-error" : undefined
                  }
                  className="min-h-28 text-base"
                />
                {bodyProblem && (
                  <p
                    id="template-body-error"
                    className="text-[15px] text-error"
                  >
                    {bodyProblem}
                  </p>
                )}
              </Field>
            </ValueChangeRow>
          ) : (
            <InlineNotice tone="info">{copy.overrideNote}</InlineNotice>
          )}
        </li>
      </ul>

      <section
        aria-labelledby="template-preview"
        className="flex flex-col gap-2"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2
            id="template-preview"
            className="font-heading text-[22px] leading-[1.25] font-light"
          >
            {copy.preview}
          </h2>
          <span className="text-[13px] text-muted-foreground">
            {copy.previewNote}
          </span>
        </div>
        <NotificationPreview
          title={renderSample(title, samples)}
          body={hasBody ? renderSample(body, samples) : null}
        />
      </section>
    </div>
  )
}

// The allowed {fields} as chips; a click adds one where the caret was.
function FieldChips({
  allowed,
  onInsert,
}: {
  allowed: readonly string[]
  onInsert: (name: string) => void
}) {
  if (allowed.length === 0) {
    return <p className="text-[15px] text-muted-foreground">{copy.noFields}</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <p id="template-fields" className="text-[15px] font-semibold">
        {copy.fieldsLegend}
      </p>
      <div
        role="group"
        aria-labelledby="template-fields"
        className="flex flex-wrap gap-2"
      >
        {allowed.map((name) => (
          <button
            key={name}
            type="button"
            // Keep the caret in the field: the click must not take focus.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onInsert(name)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-[15px] hover:bg-muted"
          >
            <span aria-hidden className="text-muted-foreground">
              +
            </span>
            {copy.fieldNames[name] ?? name}
          </button>
        ))}
      </div>
      <p className="text-[13px] text-muted-foreground">{copy.fieldsHint}</p>
    </div>
  )
}

// The draft as it would look in a notification center (DESIGN ›
// notification-item, unread): an accent dot, the title in body-strong, the
// body in body-sm, the time in label. Static: no link, no read toggle.
function NotificationPreview({
  title,
  body,
}: {
  title: string
  body: string | null
}) {
  return (
    <div className="rounded-sm border border-border px-4">
      <div className="flex flex-col gap-1 py-4">
        <span className="flex items-baseline gap-2">
          <span
            aria-hidden
            className="size-2 shrink-0 translate-y-[-0.1em] rounded-full bg-brand-accent"
          />
          <span className="text-base leading-snug font-semibold text-pretty break-words">
            {title}
          </span>
        </span>
        {body && (
          <span className="ps-4 text-[15px] leading-normal text-pretty break-words whitespace-pre-line">
            {body}
          </span>
        )}
        <span className="ps-4 text-[13px] leading-tight text-muted-foreground">
          {copy.previewTime}
        </span>
      </div>
    </div>
  )
}
