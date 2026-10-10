"use client"

import { ImageUploadField } from "@/components/admin/image-upload-field"
import { RadioCardGroup } from "@/components/admin/radio-card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { authCopy } from "@/lib/copy/auth"
import { errorMessage } from "@/lib/errors"

import { createConceptMediaAction } from "./actions"
import {
  fieldError,
  MAX_DESCRIPTION,
  MAX_NAME,
  type ConceptDraft,
  type ConceptImage,
  type ConceptKind,
  type ConceptProblem,
} from "./concept-draft"

const copy = adminCopy.concepts

// The fields of a concept (story 4.8), controlled, shared by the create form
// and the editor: name, description and kind, each with an optional note
// under it (the editor's "what this change does"). An error replaces the
// note once Tal tried to save; both are linked by aria-describedby.

function problemText(problem: ConceptProblem, field: "name" | "description") {
  if (problem === "required") return errorMessage("FIELD_REQUIRED")
  return field === "name" ? copy.nameTooLong : copy.descriptionTooLong
}

function TextField({
  id,
  label,
  value,
  onChange,
  problem,
  note,
  required = false,
  maxLength,
  multiline = false,
  field,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  problem: ConceptProblem
  note?: string
  required?: boolean
  maxLength: number
  multiline?: boolean
  field: "name" | "description"
}) {
  const errorId = `${id}-error`
  const noteId = `${id}-note`
  const shared = {
    id,
    value,
    maxLength,
    required,
    "aria-required": required || undefined,
    "aria-invalid": problem ? true : undefined,
    "aria-describedby": problem ? errorId : note ? noteId : undefined,
  }
  return (
    <Field data-invalid={problem ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {required && ` ${authCopy.required}`}
      </FieldLabel>
      {multiline ? (
        <Textarea
          {...shared}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-28 text-base"
        />
      ) : (
        <Input
          {...shared}
          type="text"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className="h-12 text-base"
        />
      )}
      {problem ? (
        <p id={errorId} className="text-[15px] text-error">
          {problemText(problem, field)}
        </p>
      ) : (
        note && (
          <p id={noteId} className="text-[13px] text-muted-foreground">
            {note}
          </p>
        )
      )}
    </Field>
  )
}

export function ConceptFields({
  draft,
  onChange,
  tried,
  notes = false,
}: {
  draft: ConceptDraft
  onChange: (patch: Partial<ConceptDraft>) => void
  // Errors show once Tal tried to save.
  tried: boolean
  // The editor's notes under each field.
  notes?: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      <TextField
        id="name"
        field="name"
        label={copy.fields.name}
        value={draft.name}
        onChange={(name) => onChange({ name })}
        problem={tried ? fieldError("name", draft) : null}
        note={notes ? copy.nameNote : undefined}
        required
        maxLength={MAX_NAME + 20}
      />
      <TextField
        id="description"
        field="description"
        label={copy.fields.description}
        value={draft.description}
        onChange={(description) => onChange({ description })}
        problem={tried ? fieldError("description", draft) : null}
        note={notes ? copy.descriptionNote : undefined}
        maxLength={MAX_DESCRIPTION + 200}
        multiline
      />
      <div className="flex flex-col gap-2">
        <RadioCardGroup
          legend={`${copy.fields.kind} ${authCopy.required}`}
          name="kind"
          options={(["regular", "couple"] as const).map((kind) => ({
            value: kind,
            label: copy.kinds[kind],
          }))}
          value={draft.kind}
          onChange={(kind) => onChange({ kind: kind as ConceptKind })}
          required
        />
        {notes && (
          <p className="text-[13px] text-muted-foreground">{copy.kindNote}</p>
        )}
      </div>
    </div>
  )
}

// The concept's image: image-upload-field framed as the session card (2:1),
// with the alt text. Saving it (the editor's own button) publishes it.
export function ConceptImageField({
  value,
  previewUrl,
  onChange,
}: {
  value: ConceptImage | null
  previewUrl?: string | null
  onChange: (value: ConceptImage | null) => void
}) {
  return (
    <ImageUploadField
      id="concept-image"
      label={copy.image.label}
      hint={copy.image.hint}
      aspectRatio={2}
      value={value}
      previewUrl={previewUrl}
      onChange={onChange}
      createMedia={createConceptMediaAction}
    />
  )
}
