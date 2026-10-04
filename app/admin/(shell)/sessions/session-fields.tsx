"use client"

import { RadioCardGroup } from "@/components/admin/radio-card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { authCopy } from "@/lib/copy/auth"
import { errorMessage } from "@/lib/errors"

import type { ConceptOption, EventKind } from "./session-draft"

const copy = adminCopy.sessions

// The fields of a session (story 3.1), controlled, shared by the create
// form, the editor and the duplicate box. Required fields carry "(חובה)";
// an error is shown under its field and a hint ("מהקונספט") under it
// otherwise, both linked by aria-describedby.

export type FieldProblem = "required" | "invalid" | null

export function SessionField({
  id,
  label,
  value,
  onChange,
  problem = null,
  hint,
  required = false,
  type = "text",
  maxLength,
  multiline = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  problem?: FieldProblem
  hint?: string | null
  required?: boolean
  type?: "text" | "date" | "time" | "datetime-local" | "numeric" | "decimal"
  maxLength?: number
  multiline?: boolean
}) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const ltr = type !== "text"
  const shared = {
    id,
    value,
    maxLength,
    required,
    "aria-required": required || undefined,
    "aria-invalid": problem ? true : undefined,
    "aria-describedby": problem ? errorId : hint ? hintId : undefined,
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
          className="min-h-24 text-base"
        />
      ) : (
        <Input
          {...shared}
          type={
            type === "numeric" || type === "decimal" || type === "text"
              ? "text"
              : type
          }
          autoComplete="off"
          inputMode={
            type === "numeric"
              ? "numeric"
              : type === "decimal"
                ? "decimal"
                : undefined
          }
          dir={ltr ? "ltr" : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`h-12 text-base ${ltr ? "text-start" : ""}`}
        />
      )}
      {problem ? (
        <p id={errorId} className="text-[15px] text-error">
          {errorMessage(
            problem === "required" ? "FIELD_REQUIRED" : "INVALID_INPUT"
          )}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-[13px] text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </Field>
  )
}

export function KindField({
  name,
  value,
  onChange,
  hint,
}: {
  name: string
  value: EventKind
  onChange: (value: EventKind) => void
  hint?: string | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <RadioCardGroup
        legend={`${copy.fields.kind} ${authCopy.required}`}
        name={name}
        options={(["regular", "couple"] as const).map((kind) => ({
          value: kind,
          label: copy.kinds[kind],
        }))}
        value={value}
        onChange={(next) => onChange(next as EventKind)}
        required
      />
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ConceptField({
  name,
  concepts,
  value,
  onChange,
  problem = null,
}: {
  name: string
  concepts: readonly ConceptOption[]
  value: string
  onChange: (value: string) => void
  problem?: FieldProblem
}) {
  return (
    <div className="flex flex-col gap-2">
      <RadioCardGroup
        legend={`${copy.fields.concept} ${authCopy.required}`}
        name={name}
        options={concepts.map((concept) => ({
          value: concept.id,
          label: concept.name,
        }))}
        value={value}
        onChange={onChange}
        required
      />
      {problem && (
        <p className="text-[15px] text-error">
          {errorMessage(
            problem === "required" ? "FIELD_REQUIRED" : "INVALID_INPUT"
          )}
        </p>
      )}
    </div>
  )
}

// Date, start and end together (the editor's "מועד" row, the duplicate box).
export function WhenFields({
  idPrefix,
  date,
  startTime,
  endTime,
  onChange,
  problems = {},
}: {
  idPrefix: string
  date: string
  startTime: string
  endTime: string
  onChange: (patch: {
    date?: string
    startTime?: string
    endTime?: string
  }) => void
  problems?: {
    date?: FieldProblem
    startTime?: FieldProblem
    endTime?: FieldProblem
  }
}) {
  return (
    <div className="flex flex-col gap-4">
      <SessionField
        id={`${idPrefix}date`}
        label={copy.fields.date}
        type="date"
        value={date}
        onChange={(next) => onChange({ date: next })}
        problem={problems.date ?? null}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <SessionField
          id={`${idPrefix}start`}
          label={copy.fields.startTime}
          type="time"
          value={startTime}
          onChange={(next) => onChange({ startTime: next })}
          problem={problems.startTime ?? null}
          required
        />
        <SessionField
          id={`${idPrefix}end`}
          label={copy.fields.endTime}
          type="time"
          value={endTime}
          onChange={(next) => onChange({ endTime: next })}
          problem={problems.endTime ?? null}
          required
        />
      </div>
    </div>
  )
}
