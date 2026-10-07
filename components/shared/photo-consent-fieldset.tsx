import {
  photoConsentQuestion,
  type PhotoConsentContent,
  type PhotoConsentKind,
} from "@/lib/content/schema"

// One photo consent question of the join form (CAP-40, story 2.13): its
// title, the published question (one line per "\n") and its two answers as a
// required radio group, none chosen in advance. Shared by the join form, the
// admin preview of its wording (story 5.3) and the customer's profile (story
// 2.10), so all show the same thing. name: the form field ("photoConsent" or
// "personalPhotoConsent"); the ids derive from it ("<name>-yes" is the first
// answer, the focus target of an error). error: the message under the
// answers (aria-describedby). defaultValue: the saved answer, checked when
// the group renders (the profile); none when not given.
export function PhotoConsentFieldset({
  name,
  title,
  question,
  yesLabel,
  noLabel,
  error,
  defaultValue,
}: {
  name: string
  title: string
  question: string
  yesLabel: string
  noLabel: string
  error?: string
  defaultValue?: boolean
}) {
  const questionId = `${name}-question`
  const errorId = `${name}-error`
  return (
    <fieldset
      role="radiogroup"
      aria-required
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${questionId} ${errorId}` : questionId}
      className="flex flex-col gap-3"
    >
      <legend className="mb-2 text-base font-semibold">{title}</legend>
      <p id={questionId} className="mb-1 text-base">
        {question.split("\n").map((line, index) => (
          <span key={index} className="block">
            {line}
          </span>
        ))}
      </p>
      {(
        [
          ["yes", yesLabel],
          ["no", noLabel],
        ] as const
      ).map(([value, label]) => (
        <div key={value} className="flex items-center gap-3">
          <input
            id={`${name}-${value}`}
            type="radio"
            name={name}
            value={value}
            required
            defaultChecked={
              defaultValue === undefined
                ? undefined
                : defaultValue === (value === "yes")
            }
            className="size-5 shrink-0 accent-primary"
          />
          <label htmlFor={`${name}-${value}`} className="text-base">
            {label}
          </label>
        </div>
      ))}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}

// The form field of each consent (the join form posts both).
export const PHOTO_CONSENT_FIELDS = {
  atmosphere: "photoConsent",
  personal: "personalPhotoConsent",
} as const satisfies Record<PhotoConsentKind, string>

// Both questions and the note under them, as the join form shows them (and
// its admin preview). errors: the message of each question, if any.
export function PhotoConsentQuestions({
  content,
  errors = {},
}: {
  content: PhotoConsentContent
  errors?: Partial<Record<PhotoConsentKind, string>>
}) {
  return (
    <>
      {(["atmosphere", "personal"] as const).map((kind) => (
        <PhotoConsentFieldset
          key={kind}
          name={PHOTO_CONSENT_FIELDS[kind]}
          {...photoConsentQuestion(content, kind)}
          error={errors[kind]}
        />
      ))}
      <PhotoConsentNote note={content.note} />
    </>
  )
}

// The note under both questions (one line per "\n").
export function PhotoConsentNote({ note }: { note: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      {note.split("\n").map((line, index) => (
        <span key={index} className="block">
          {line}
        </span>
      ))}
    </p>
  )
}
