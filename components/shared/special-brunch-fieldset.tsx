import type { SpecialBrunchContent } from "@/lib/content/schema"
import {
  SPECIAL_BRUNCH_FIELD,
  specialBrunchOptions,
  type SpecialBrunchCode,
} from "@/lib/special-brunch"

// The special-brunch interest question (story 2.16): the question as the
// legend and one checkbox per option, its title as the label and its hint
// (when there is one) as a small line under it (aria-describedby). Optional:
// nothing is checked in advance and nothing is required. Shared by the join
// form (both paths, 2.15 too) and the profile's details, so both show the
// same thing. name: the form field (one value per checked code); the first
// checkbox's id is "<name>-couples", the focus target of an error.
// defaultValue: the saved codes, checked when it renders (the profile).
export function SpecialBrunchFieldset({
  content,
  name = SPECIAL_BRUNCH_FIELD,
  defaultValue = [],
  error,
}: {
  content: SpecialBrunchContent
  name?: string
  defaultValue?: readonly SpecialBrunchCode[]
  error?: string
}) {
  const errorId = `${name}-error`
  return (
    <fieldset
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      className="flex flex-col gap-3"
    >
      <legend className="mb-2 text-base font-semibold">
        {content.question}
      </legend>
      {specialBrunchOptions(content).map((option) => {
        const id = `${name}-${option.code}`
        const hintId = `${id}-hint`
        return (
          <div key={option.code} className="flex items-start gap-3">
            <input
              id={id}
              type="checkbox"
              name={name}
              value={option.code}
              defaultChecked={defaultValue.includes(option.code)}
              aria-describedby={option.hint ? hintId : undefined}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <div className="flex flex-col gap-0.5">
              <label htmlFor={id} className="text-base">
                {option.title}
              </label>
              {option.hint && (
                <p id={hintId} className="text-[15px] text-muted-foreground">
                  {option.hint}
                </p>
              )}
            </div>
          </div>
        )
      })}
      {error && (
        <p id={errorId} className="text-[15px] text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}
