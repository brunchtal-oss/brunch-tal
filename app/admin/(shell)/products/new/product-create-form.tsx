"use client"

import { startTransition, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

import { createProductAction } from "../actions"
import {
  createPayload,
  draftForType,
  fieldError,
  type DraftField,
  type ProductDraft,
} from "../product-draft"
import {
  EventKindField,
  IntroOnlyField,
  PartySizeField,
  TextField,
  TypeField,
  ValidityField,
  WeekdaysField,
} from "../product-fields"

const copy = adminCopy.products

// Where each field is, to move the focus to the first one to fix.
const FIELD_IDS: Record<DraftField, string> = {
  name: "name",
  price: "price",
  units: "units",
  validityDays: "validity-days",
  weekdays: "weekdays-0",
}

// The create form (story 2.6). The type comes first and fills defaults
// (product-draft.ts › draftForType) that Tal may change; the name, price
// and the texts she typed are kept when she switches type. Errors show
// under their field once she tried to save; nothing is sent until they are
// fixed. One idempotency key per product (AD-5); a success opens the new
// product with "the product was added".
export function ProductCreateForm({
  defaultValidityDays,
}: {
  defaultValidityDays: number | null
}) {
  const router = useRouter()
  // Made in the browser, so Back after a success (a restored page) never
  // replays the key of the product already created; a new one after it.
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    newIdempotencyKey()
  )
  const formRef = useRef<HTMLFormElement>(null)
  const [draft, setDraft] = useState<ProductDraft>(() =>
    draftForType("single", defaultValidityDays)
  )
  const [tried, setTried] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<ErrorCode | null>(null)

  const update = (patch: Partial<ProductDraft>) =>
    setDraft((current) => ({ ...current, ...patch }))
  const problem = (field: DraftField) => {
    if (!tried) return null
    // An empty number of days takes the setting's default on create.
    if (field === "validityDays" && draft.validityDaysText.trim() === "") {
      return null
    }
    return fieldError(field, draft)
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    setTried(true)
    setServerError(null)
    const payload = createPayload(draft)
    if (!payload.ok) {
      formRef.current
        ?.querySelector<HTMLElement>(`#${FIELD_IDS[payload.field]}`)
        ?.focus()
      return
    }
    setPending(true)
    startTransition(async () => {
      try {
        const result = await createProductAction({
          product: payload.product,
          idempotencyKey,
        })
        if (result.ok) {
          setIdempotencyKey(newIdempotencyKey())
          router.push(`/admin/products/${result.data.productId}?added=1`)
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
      className="flex flex-col gap-5"
    >
      <InlineNotice tone="info">{copy.scopeNote}</InlineNotice>

      <TypeField
        name="type"
        value={draft.type}
        onChange={(type) =>
          setDraft((current) =>
            draftForType(type, defaultValidityDays, current)
          )
        }
      />
      <TextField
        id="name"
        label={copy.fields.name}
        value={draft.name}
        onChange={(name) => update({ name })}
        problem={problem("name")}
        required
        maxLength={200}
      />
      <TextField
        id="price"
        label={copy.fields.price}
        value={draft.priceText}
        onChange={(priceText) => update({ priceText })}
        problem={problem("price")}
        invalidText={adminCopy.payments.amountInvalid}
        required
        decimal
        maxLength={12}
      />
      <TextField
        id="units"
        label={copy.fields.units}
        value={draft.unitsText}
        onChange={(unitsText) => update({ unitsText })}
        problem={problem("units")}
        required
        numeric
        maxLength={4}
      />
      <ValidityField
        name="validity"
        mode={draft.validityMode}
        daysText={draft.validityDaysText}
        onModeChange={(validityMode) => update({ validityMode })}
        onDaysChange={(validityDaysText) => update({ validityDaysText })}
        daysProblem={problem("validityDays")}
      />
      <WeekdaysField
        name="weekdays"
        value={draft.weekdays}
        onChange={(weekdays) => update({ weekdays })}
      />
      <EventKindField
        name="eventKind"
        value={draft.eventKind}
        onChange={(eventKind) => update({ eventKind })}
      />
      <PartySizeField
        name="partySize"
        value={draft.partySize}
        onChange={(partySize) => update({ partySize })}
      />
      <IntroOnlyField
        id="introOnly"
        value={draft.introOnly}
        onChange={(introOnly) => update({ introOnly })}
      />
      <TextField
        id="postJoinMessage"
        label={copy.fields.postJoinMessage}
        value={draft.postJoinMessage}
        onChange={(postJoinMessage) => update({ postJoinMessage })}
        maxLength={1000}
        multiline
      />
      <TextField
        id="postJoinButtonLabel"
        label={copy.fields.postJoinButtonLabel}
        value={draft.postJoinButtonLabel}
        onChange={(postJoinButtonLabel) => update({ postJoinButtonLabel })}
        maxLength={100}
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
