"use client"

import { useState, useTransition } from "react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { PhotoConsentFieldset } from "@/components/shared/photo-consent-fieldset"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { PhotoConsentContent } from "@/lib/content/schema"
import { customerCopy } from "@/lib/copy/customer"
import { errorMessage, type ErrorCode } from "@/lib/errors"

import { setPhotoConsent } from "./actions"
import { toastSaved } from "./profile-toaster"

const copy = customerCopy.profile

// The photo consent (story 2.10, CAP-40, user decision 2026-10-06): the
// join form's question and its two answers, the saved answer checked, and a
// save button. set_photo_consent stores the time and the wording version;
// the same answer writes nothing. An error stays as an inline-notice.
export function PhotoConsentForm({
  content,
  consent,
}: {
  content: PhotoConsentContent
  consent: boolean
}) {
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, startTransition] = useTransition()

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const answer = new FormData(event.currentTarget).get("photoConsent")
    if (answer !== "yes" && answer !== "no") return
    startTransition(async () => {
      const result = await setPhotoConsent({ consent: answer === "yes" })
      if (result.ok) {
        setError(null)
        toastSaved()
      } else {
        setError(result.code)
      }
    })
  }

  return (
    <section aria-labelledby="photo-title" className="flex flex-col gap-4">
      <h2
        id="photo-title"
        className="font-heading text-xl leading-tight font-light"
      >
        {copy.photoTitle}
      </h2>
      {/* The key re-checks the saved answer after a save elsewhere. */}
      <form
        key={String(consent)}
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
      >
        <PhotoConsentFieldset content={content} defaultValue={consent} />
        {error && (
          <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>
        )}
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
    </section>
  )
}
