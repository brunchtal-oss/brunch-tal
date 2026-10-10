"use client"

import { startTransition, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

import { createConceptAction } from "../actions"
import { createPayload, emptyDraft, type ConceptDraft } from "../concept-draft"
import { ConceptFields } from "../concept-fields"

const copy = adminCopy.concepts

// The create form (story 4.8). Errors show under their field once Tal tried
// to save; nothing is sent until they are fixed. One idempotency key per
// concept (AD-5); a success opens the new concept's editor.
export function ConceptCreateForm() {
  const router = useRouter()
  // Made in the browser, so Back after a success never replays the key of
  // the concept already created; a new one after it.
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    newIdempotencyKey()
  )
  const formRef = useRef<HTMLFormElement>(null)
  const [draft, setDraft] = useState<ConceptDraft>(emptyDraft)
  const [tried, setTried] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<ErrorCode | null>(null)

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    setTried(true)
    setServerError(null)
    const payload = createPayload(draft)
    if (!payload.ok) {
      formRef.current?.querySelector<HTMLElement>(`#${payload.field}`)?.focus()
      return
    }
    setPending(true)
    startTransition(async () => {
      try {
        const result = await createConceptAction({
          concept: payload.concept,
          idempotencyKey,
        })
        if (result.ok) {
          setIdempotencyKey(newIdempotencyKey())
          router.push(`/admin/concepts/${result.data.conceptId}`)
          return
        }
        setServerError(result.code)
      } catch {
        // A thrown action (network): the same key may be sent again.
        setServerError("SERVER_ERROR")
      }
      setPending(false)
    })
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-6"
    >
      <ConceptFields
        draft={draft}
        onChange={(patch) => {
          setDraft((current) => ({ ...current, ...patch }))
          // A changed draft is a new request (AD-5).
          setIdempotencyKey(newIdempotencyKey())
        }}
        tried={tried}
      />
      {serverError && (
        <InlineNotice tone="error">{errorMessage(serverError)}</InlineNotice>
      )}
      <Button
        type="submit"
        size="lg"
        className="h-12 text-base"
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
      >
        {pending && <Spinner aria-hidden />}
        {copy.create.submit}
      </Button>
    </form>
  )
}
