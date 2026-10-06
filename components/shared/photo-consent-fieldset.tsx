import type { PhotoConsentContent } from "@/lib/content/schema"

// The photo consent question of the join form (CAP-40): the published
// question (one line per "\n") and its two answers as a required radio
// group, none chosen in advance. Shared by the join form, the admin
// preview of its wording (story 5.3) and the customer's profile (story
// 2.10), so all show the same thing. error: the message under the answers
// (aria-describedby). defaultValue: the saved answer, checked when the
// group renders (the profile); none when not given.
export function PhotoConsentFieldset({
  content,
  error,
  defaultValue,
}: {
  content: PhotoConsentContent
  error?: string
  defaultValue?: boolean
}) {
  const questionLines = content.question.split("\n")
  return (
    <fieldset
      role="radiogroup"
      aria-required
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? "photoConsent-error" : undefined}
      className="flex flex-col gap-3"
    >
      <legend className="mb-3 text-base">
        {questionLines.map((line, index) => (
          <span key={index} className="block">
            {line}
          </span>
        ))}
      </legend>
      {(
        [
          ["yes", content.yes_label],
          ["no", content.no_label],
        ] as const
      ).map(([value, label]) => (
        <div key={value} className="flex items-center gap-3">
          <input
            id={`photoConsent-${value}`}
            type="radio"
            name="photoConsent"
            value={value}
            required
            defaultChecked={
              defaultValue === undefined
                ? undefined
                : defaultValue === (value === "yes")
            }
            className="size-5 shrink-0 accent-primary"
          />
          <label htmlFor={`photoConsent-${value}`} className="text-base">
            {label}
          </label>
        </div>
      ))}
      {error && (
        <p id="photoConsent-error" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}
