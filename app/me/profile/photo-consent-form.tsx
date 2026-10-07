"use client"

import { useState, useTransition } from "react"

import { InlineNotice } from "@/components/shared/inline-notice"
import {
  PHOTO_CONSENT_FIELDS,
  PhotoConsentFieldset,
  PhotoConsentNote,
} from "@/components/shared/photo-consent-fieldset"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  photoConsentQuestion,
  type PhotoConsentContent,
  type PhotoConsentKind,
} from "@/lib/content/schema"
import { customerCopy } from "@/lib/copy/customer"
import { errorMessage, type ErrorCode } from "@/lib/errors"

import { setPersonalPhotoConsent, setPhotoConsent } from "./actions"
import { toastSaved } from "./profile-toaster"

const copy = customerCopy.profile

// Each consent's action and form field: the personal answer must never be
// saved into the atmosphere consent (tested).
export const CONSENT_SAVERS = {
  atmosphere: { save: setPhotoConsent, field: PHOTO_CONSENT_FIELDS.atmosphere },
  personal: {
    save: setPersonalPhotoConsent,
    field: PHOTO_CONSENT_FIELDS.personal,
  },
} as const

// The photo consents (story 2.10, CAP-40; two consents from story 2.13):
// one heading, then a form per consent (the join form's question, the saved
// answer checked and its own save button), and the note under both.
export function PhotoConsentSection({
  content,
  consents,
}: {
  content: PhotoConsentContent
  consents: Record<PhotoConsentKind, boolean>
}) {
  return (
    <section aria-labelledby="photo-title" className="flex flex-col gap-6">
      <h2
        id="photo-title"
        className="font-heading text-xl leading-tight font-light"
      >
        {copy.photoTitle}
      </h2>
      <PhotoConsentForm
        kind="atmosphere"
        content={content}
        consent={consents.atmosphere}
      />
      <PhotoConsentForm
        kind="personal"
        content={content}
        consent={consents.personal}
      />
      <PhotoConsentNote note={content.note} />
    </section>
  )
}

// One consent: set_photo_consent (atmosphere) or set_personal_photo_consent
// stores the time and the wording version; the same answer writes nothing.
// An error stays as an inline-notice.
export function PhotoConsentForm({
  kind,
  content,
  consent,
}: {
  kind: PhotoConsentKind
  content: PhotoConsentContent
  consent: boolean
}) {
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, startTransition] = useTransition()
  const { save, field: name } = CONSENT_SAVERS[kind]

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const answer = new FormData(event.currentTarget).get(name)
    if (answer !== "yes" && answer !== "no") return
    startTransition(async () => {
      const result = await save({ consent: answer === "yes" })
      if (result.ok) {
        setError(null)
        toastSaved()
      } else {
        setError(result.code)
      }
    })
  }

  // The key re-checks the saved answer after a save elsewhere.
  return (
    <form
      key={String(consent)}
      onSubmit={onSubmit}
      className="flex flex-col gap-5"
    >
      <PhotoConsentFieldset
        name={name}
        {...photoConsentQuestion(content, kind)}
        defaultValue={consent}
      />
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      <Button
        type="submit"
        size="lg"
        className="h-12 min-w-32 self-start text-base"
        aria-disabled={pending || undefined}
      >
        {pending && <Spinner aria-hidden />}
        {pending ? copy.saving : copy.save}
      </Button>
    </form>
  )
}
