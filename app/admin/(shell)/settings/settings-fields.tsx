"use client"

import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

import { PREP_OFFSETS } from "./settings-draft"

const copy = adminCopy.settings
const INPUT = "h-12 text-base"

// The fields of the settings screen (story 4.7), controlled. A problem is
// shown under its field and linked by aria-describedby; the saved value is
// shown in the change line of the row (value-change-row), not here.

function ProblemLine({ id, text }: { id: string; text: string | null }) {
  if (!text) return null
  return (
    <p id={id} className="text-[15px] text-error">
      {text}
    </p>
  )
}

// A whole number (hours, days, places): numeric keyboard, LTR digits.
export function NumberField({
  id,
  label,
  value,
  onChange,
  problem,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  problem: string | null
}) {
  const errorId = `${id}-error`
  return (
    <Field data-invalid={problem ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        maxLength={4}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        className={cn(INPUT, "max-w-40 text-start")}
      />
      <ProblemLine id={errorId} text={problem} />
    </Field>
  )
}

export function TimeField({
  id,
  label,
  value,
  onChange,
  problem,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  problem: string | null
}) {
  const errorId = `${id}-error`
  return (
    <Field data-invalid={problem ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        className={cn(INPUT, "text-start")}
      />
      <ProblemLine id={errorId} text={problem} />
    </Field>
  )
}

// The default prep days of a session's work sheet: seven toggle chips from
// "6 days before" to "the session's day" (-6..0), at least one.
export function PrepDaysField({
  value,
  onChange,
}: {
  value: readonly number[]
  onChange: (value: number[]) => void
}) {
  const empty = value.length === 0
  const errorId = "prep-days-error"
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={empty ? errorId : undefined}
    >
      <legend className="mb-2 text-sm font-medium">
        {copy.fields.prepDays}
      </legend>
      <div className="flex flex-wrap gap-2">
        {PREP_OFFSETS.map((offset) => {
          const on = value.includes(offset)
          return (
            <button
              key={offset}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange(
                  on
                    ? value.filter((d) => d !== offset)
                    : [...value, offset].sort((a, b) => a - b)
                )
              }
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-[15px] transition-colors",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-transparent text-foreground hover:bg-muted"
              )}
            >
              {copy.show.prepDay(offset)}
            </button>
          )
        })}
      </div>
      <ProblemLine id={errorId} text={empty ? copy.prepDaysEmpty : null} />
    </fieldset>
  )
}
