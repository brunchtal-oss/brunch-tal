"use client"

import { startTransition, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

import { createEventAction } from "../actions"
import {
  capacityFor,
  createPayload,
  draftFieldOf,
  draftForConcept,
  fieldError,
  type CapacityDefaults,
  type ConceptOption,
  type DraftField,
  type SessionDraft,
} from "../session-draft"
import {
  ConceptField,
  KindField,
  SessionField,
  WhenFields,
} from "../session-fields"

const copy = adminCopy.sessions

// Where each field is, to move the focus to the first one to fix.
const FIELD_SELECTORS: Record<DraftField, string> = {
  concept: 'input[name="concept"]',
  date: "#date",
  startTime: "#start",
  endTime: "#end",
  capacity: "#capacity",
  price: "#price",
  closes: "#date",
}

// The create form (story 3.1). The concept comes first: it fills the kind
// and the description ("מהקונספט"), and the kind fills the capacity from the
// settings ("לפי ההגדרות"); Tal may change each of them. A hint stays only
// while the field holds the value it was filled with. Errors show under
// their field once she tried to save; nothing is sent until they are fixed.
// One idempotency key per session (AD-5); a success opens the new draft.
export function SessionCreateForm({
  concepts,
  capacityDefaults,
}: {
  concepts: readonly ConceptOption[]
  capacityDefaults: CapacityDefaults
}) {
  const router = useRouter()
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    newIdempotencyKey()
  )
  const formRef = useRef<HTMLFormElement>(null)
  const [draft, setDraft] = useState<SessionDraft>(() =>
    concepts[0]
      ? draftForConcept(concepts[0], capacityDefaults)
      : {
          conceptId: "",
          date: "",
          startTime: "",
          endTime: "",
          kind: "regular",
          description: "",
          capacityText: capacityFor("regular", capacityDefaults),
          priceText: "",
          closesLocal: "",
        }
  )
  const [tried, setTried] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<{
    code: ErrorCode
    field: DraftField | null
  } | null>(null)

  const concept = concepts.find((c) => c.id === draft.conceptId)
  const update = (patch: Partial<SessionDraft>) =>
    setDraft((current) => ({ ...current, ...patch }))
  const problem = (field: DraftField) => {
    if (serverError?.field === field) return "invalid"
    return tried ? fieldError(field, draft) : null
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    setTried(true)
    setServerError(null)
    const payload = createPayload(draft)
    if (!payload.ok) {
      formRef.current
        ?.querySelector<HTMLElement>(FIELD_SELECTORS[payload.field])
        ?.focus()
      return
    }
    setPending(true)
    startTransition(async () => {
      try {
        const result = await createEventAction({
          event: payload.event,
          idempotencyKey,
        })
        if (result.ok) {
          setIdempotencyKey(newIdempotencyKey())
          router.push(`/admin/sessions/${result.data.eventId}/edit`)
          return
        }
        setServerError({
          code: result.code,
          field: draftFieldOf(result.detail?.field),
        })
      } catch {
        // A thrown action (network): the same key may be sent again.
        setServerError({ code: "SERVER_ERROR", field: null })
      }
      setPending(false)
    })
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-5"
    >
      <ConceptField
        name="concept"
        concepts={concepts}
        value={draft.conceptId}
        onChange={(id) => {
          const next = concepts.find((c) => c.id === id)
          if (next) {
            setDraft((current) =>
              draftForConcept(next, capacityDefaults, current)
            )
          }
        }}
        problem={problem("concept")}
      />
      <WhenFields
        idPrefix=""
        date={draft.date}
        startTime={draft.startTime}
        endTime={draft.endTime}
        onChange={update}
        problems={{
          date: problem("date"),
          startTime: problem("startTime"),
          endTime: problem("endTime"),
        }}
      />
      <KindField
        name="kind"
        value={draft.kind}
        onChange={(kind) =>
          update({ kind, capacityText: capacityFor(kind, capacityDefaults) })
        }
        hint={
          concept && draft.kind === concept.default_kind
            ? copy.fromConcept
            : null
        }
      />
      <SessionField
        id="description"
        label={copy.fields.description}
        value={draft.description}
        onChange={(description) => update({ description })}
        hint={
          concept &&
          draft.description !== "" &&
          draft.description === (concept.description ?? "")
            ? copy.fromConcept
            : null
        }
        maxLength={2000}
        multiline
      />
      <SessionField
        id="capacity"
        label={copy.fields.capacity}
        type="numeric"
        value={draft.capacityText}
        onChange={(capacityText) => update({ capacityText })}
        problem={problem("capacity")}
        hint={
          draft.capacityText !== "" &&
          draft.capacityText === capacityFor(draft.kind, capacityDefaults)
            ? copy.fromSettings
            : null
        }
        required
        maxLength={4}
      />
      <SessionField
        id="price"
        label={copy.fields.price}
        type="decimal"
        value={draft.priceText}
        onChange={(priceText) => update({ priceText })}
        problem={problem("price")}
        hint={copy.priceEmpty}
        maxLength={12}
      />

      {serverError && (
        <InlineNotice tone="error">
          {errorMessage(serverError.code)}
        </InlineNotice>
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
