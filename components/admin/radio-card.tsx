import { cn } from "@/lib/utils"

// description: an optional line under the label (body-sm, ink-muted), part
// of the option's accessible name (story 3.7: the cancel choice).
export type RadioCardOption = {
  value: string
  label: string
  description?: string
}

// DESIGN.md › radio-card: a real radio group (fieldset + visible legend,
// native radios, so the arrow keys move between options); the whole card is
// the label. Card background, 1px ink-muted border, 4px corners, at least
// 48px high, 20px circle. Selected: muted background AND ink border AND a
// filled primary circle (the background alone is not enough). Two per row
// only when every label fits on one line; otherwise one column.
export function RadioCardGroup({
  legend,
  name,
  options,
  value,
  onChange,
  required = false,
  className,
}: {
  legend: React.ReactNode
  name: string
  options: readonly RadioCardOption[]
  value: string
  onChange: (value: string) => void
  required?: boolean
  className?: string
}) {
  const twoColumns = options.every(
    (option) => option.label.length <= 12 && !option.description
  )
  return (
    <fieldset
      aria-required={required || undefined}
      className={cn("flex flex-col gap-2", className)}
    >
      <legend className="mb-2 text-[15px] font-semibold">{legend}</legend>
      <div
        className={cn("grid gap-2", twoColumns ? "grid-cols-2" : "grid-cols-1")}
      >
        {options.map((option, index) => (
          <label
            key={option.value}
            className="group flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border border-muted-foreground bg-card px-4 py-2 text-base has-checked:border-foreground has-checked:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-primary has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background"
          >
            <input
              // "<name>-<n>": a target to move the focus to.
              id={`${name}-${index}`}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              required={required}
              className="sr-only"
            />
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-muted-foreground group-has-checked:border-primary"
            >
              <span className="size-2.5 rounded-full bg-primary opacity-0 group-has-checked:opacity-100" />
            </span>
            {option.description ? (
              <span className="flex min-w-0 flex-col gap-0.5 break-words">
                <span className="font-semibold">{option.label}</span>
                <span className="text-[15px] text-muted-foreground">
                  {option.description}
                </span>
              </span>
            ) : (
              <span className="min-w-0 break-words">{option.label}</span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
