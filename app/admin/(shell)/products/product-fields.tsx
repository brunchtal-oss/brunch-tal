"use client"

import { RadioCardGroup } from "@/components/admin/radio-card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { authCopy } from "@/lib/copy/auth"
import { errorMessage } from "@/lib/errors"
import { formatWeekdayIndex } from "@/lib/time"

import {
  ALL_WEEKDAYS,
  PRODUCT_TYPES,
  type EventKind,
  type ProductType,
  type ValidityMode,
} from "./product-draft"

const copy = adminCopy.products
const INPUT = "h-12 text-base"

// The fields of a product (story 2.6), controlled, shared by the create
// form and the editor. Required fields carry "(חובה)" as in the payment
// form; an error is shown under its field and linked by aria-describedby.

export type FieldProblem = "required" | "invalid" | "weekdays" | null

function problemText(problem: FieldProblem, invalidText?: string): string {
  if (problem === "required") return errorMessage("FIELD_REQUIRED")
  if (problem === "weekdays") return copy.weekdaysEmpty
  return invalidText ?? errorMessage("INVALID_INPUT")
}

export function TextField({
  id,
  label,
  value,
  onChange,
  problem = null,
  invalidText,
  required = false,
  numeric = false,
  decimal = false,
  maxLength,
  multiline = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  problem?: FieldProblem
  invalidText?: string
  required?: boolean
  numeric?: boolean
  decimal?: boolean
  maxLength?: number
  multiline?: boolean
}) {
  const errorId = `${id}-error`
  const shared = {
    id,
    value,
    maxLength,
    required,
    "aria-required": required || undefined,
    "aria-invalid": problem ? true : undefined,
    "aria-describedby": problem ? errorId : undefined,
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
          autoComplete="off"
          inputMode={numeric ? "numeric" : decimal ? "decimal" : undefined}
          dir={numeric || decimal ? "ltr" : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`${INPUT} ${numeric || decimal ? "text-start" : ""}`}
        />
      )}
      {problem && (
        <p id={errorId} className="text-[15px] text-error">
          {problemText(problem, invalidText)}
        </p>
      )}
    </Field>
  )
}

export function TypeField({
  name,
  value,
  onChange,
}: {
  name: string
  value: ProductType
  onChange: (value: ProductType) => void
}) {
  return (
    <RadioCardGroup
      legend={`${copy.fields.type} ${authCopy.required}`}
      name={name}
      options={PRODUCT_TYPES.map((type) => ({
        value: type,
        label: copy.types[type],
      }))}
      value={value}
      onChange={(next) => onChange(next as ProductType)}
      required
    />
  )
}

// Validity: the mode and its number of days together.
export function ValidityField({
  name,
  mode,
  daysText,
  onModeChange,
  onDaysChange,
  daysProblem = null,
}: {
  name: string
  mode: ValidityMode
  daysText: string
  onModeChange: (mode: ValidityMode) => void
  onDaysChange: (text: string) => void
  daysProblem?: FieldProblem
}) {
  return (
    <div className="flex flex-col gap-4">
      <RadioCardGroup
        legend={`${copy.fields.validity} ${authCopy.required}`}
        name={name}
        options={(["days", "session"] as const).map((value) => ({
          value,
          label: copy.validityModes[value],
        }))}
        value={mode}
        onChange={(next) => onModeChange(next as ValidityMode)}
        required
      />
      {mode === "days" && (
        <TextField
          id={`${name}-days`}
          label={copy.fields.validityDays}
          value={daysText}
          onChange={onDaysChange}
          problem={daysProblem}
          numeric
          maxLength={4}
        />
      )}
    </div>
  )
}

// A product is valid on every day by default (user decision 2026-10-04): the
// weekday picker stays closed behind this link until Tal opens it.
export function WeekdaysToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-4"
    >
      {copy.weekdaysOpen}
    </button>
  )
}

// Weekdays: seven checkboxes; all seven = every day, none is refused.
export function WeekdaysField({
  name,
  value,
  onChange,
  autoFocus = false,
}: {
  name: string
  value: readonly number[]
  onChange: (value: number[]) => void
  // Opened from WeekdaysToggle: the link is gone, so focus the first day.
  autoFocus?: boolean
}) {
  const empty = value.length === 0
  const errorId = `${name}-error`
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={empty ? errorId : undefined}
    >
      <legend className="mb-2 text-[15px] font-semibold">
        {copy.fields.weekdays}
      </legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {ALL_WEEKDAYS.map((day) => {
          const id = `${name}-${day}`
          const checked = value.includes(day)
          return (
            <div key={day} className="flex min-h-11 items-center gap-3">
              <Checkbox
                id={id}
                autoFocus={autoFocus && day === ALL_WEEKDAYS[0]}
                checked={checked}
                onCheckedChange={(next) =>
                  onChange(
                    next === true
                      ? [...value, day].sort((a, b) => a - b)
                      : value.filter((d) => d !== day)
                  )
                }
                className="size-6 rounded-[4px] border-[1.5px] border-muted-foreground"
              />
              <label htmlFor={id} className="text-base">
                {formatWeekdayIndex(day)}
              </label>
            </div>
          )
        })}
      </div>
      {empty ? (
        <p id={errorId} className="text-[15px] text-error">
          {copy.weekdaysEmpty}
        </p>
      ) : (
        value.length === ALL_WEEKDAYS.length && (
          <p className="text-[13px] text-muted-foreground">
            {copy.weekdaysAll}
          </p>
        )
      )}
    </fieldset>
  )
}

export function EventKindField({
  name,
  value,
  onChange,
}: {
  name: string
  value: EventKind
  onChange: (value: EventKind) => void
}) {
  return (
    <RadioCardGroup
      legend={`${copy.fields.eventKind} ${authCopy.required}`}
      name={name}
      options={(["regular", "couple"] as const).map((kind) => ({
        value: kind,
        label: copy.eventKinds[kind],
      }))}
      value={value}
      onChange={(next) => onChange(next as EventKind)}
      required
    />
  )
}

export function PartySizeField({
  name,
  value,
  onChange,
}: {
  name: string
  value: 1 | 2
  onChange: (value: 1 | 2) => void
}) {
  return (
    <RadioCardGroup
      legend={`${copy.fields.partySize} ${authCopy.required}`}
      name={name}
      options={[
        { value: "1", label: "1" },
        { value: "2", label: "2" },
      ]}
      value={String(value)}
      onChange={(next) => onChange(next === "2" ? 2 : 1)}
      required
    />
  )
}

export function IntroOnlyField({
  id,
  value,
  onChange,
}: {
  id: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Checkbox
        id={id}
        checked={value}
        onCheckedChange={(next) => onChange(next === true)}
        className="size-6 rounded-[4px] border-[1.5px] border-muted-foreground"
      />
      <label htmlFor={id} className="text-base">
        {copy.fields.introOnly}
      </label>
    </div>
  )
}
