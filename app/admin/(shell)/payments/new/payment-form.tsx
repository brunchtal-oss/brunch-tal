"use client"

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { LinkShare } from "@/components/admin/link-share"
import { RadioCardGroup } from "@/components/admin/radio-card"
import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { authCopy } from "@/lib/copy/auth"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import {
  formatAgorot,
  formatAgorotInput,
  parseShekelsToAgorot,
} from "@/lib/money"
import {
  formatDayMonth,
  formatLocalDate,
  formatSessionDateTime,
  formatWeekday,
} from "@/lib/time"

import {
  approvePaymentAction,
  previewPaymentAction,
  type ApprovePaymentState,
  type PaymentPreview,
} from "./actions"
import {
  eventOptionsFor,
  type BookableEvent,
  type EventOption,
  type PinnedProductRules,
} from "./event-options"

const copy = adminCopy.payments
const BUTTON = "h-12 text-base"
const PREVIEW_DEBOUNCE_MS = 250

export type ProductOption = {
  id: string
  name: string
  priceAgorot: number
  // A pinned product (validity_mode 'session', story 3.11): the rules of its
  // session field; null for a days product.
  pinned?: PinnedProductRules | null
}
export type MethodOption = { id: string; name: string }
// A pinned product's session, as chosen in the form (story 3.11).
export type PlacedSession = {
  productName: string
  conceptName: string
  startsAt: string
}
// phone: already formatted for display (formatLocalPhone), or empty.
export type CustomerOption = { id: string; name: string; phone: string }

type PreviewAnswer =
  { ok: true; data: PaymentPreview } | { ok: false; code: ErrorCode }

// The inputs a preview answers; a preview is shown only while they are
// still the current ones.
export function previewKey(input: {
  customerId: string | null
  // Trimmed; a different label may make a similar payment another payer's.
  payerLabel: string
  productId: string
  // A pinned product's session; empty for a days product.
  eventId?: string
  amountAgorot: number | null
  paidOn: string
  methodId: string
}): string | null {
  if (!input.productId || !input.paidOn || !input.methodId) return null
  if (input.amountAgorot === null) return null
  return [
    input.customerId ?? "",
    input.payerLabel,
    input.productId,
    input.eventId ?? "",
    input.amountAgorot,
    input.paidOn,
    input.methodId,
  ].join("|")
}

// What blocks the approval on the screen, before any request (in the order of
// the fields): a new customer without a payer name (required, user decision
// 2026-10-05), an amount that cannot be read, a pinned product without its
// session, a similar payment
// that was not checked as separate. A changed amount opens the dialog
// instead (it is confirmed there).
export function submitBlock(input: {
  payerMissing?: boolean
  amountAgorot: number | null
  eventMissing?: boolean
  hasSimilar: boolean
  duplicateChecked: boolean
}): "payer" | "amount" | "event" | "duplicate" | null {
  if (input.payerMissing) return "payer"
  if (input.amountAgorot === null) return "amount"
  if (input.eventMissing) return "event"
  if (input.hasSimilar && !input.duplicateChecked) return "duplicate"
  return null
}

// Tal approves a payment (CAP-2, CAP-6): for a new customer (no customer
// field, a join link) or for an existing one (her name at the head, the
// purchase is hers at once). Product (a pinned one asks for its session,
// story 3.11), amount
// from the product and editable (a change asks for the price_change
// dialog), purchase date, payment method, reference and note folded. "What
// will be created" comes from the same plan as the approval (AD-7), with the
// expiry warning and the similar payments.
export function PaymentForm({
  customer,
  products,
  methods,
  events = [],
  today,
  idempotencyKey,
  onApproved,
}: {
  customer: CustomerOption | null
  products: readonly ProductOption[]
  methods: readonly MethodOption[]
  // The open sessions (admin_list_bookable_events) for a pinned product.
  events?: readonly BookableEvent[]
  today: string
  idempotencyKey: string
  // Called once when the approval succeeded (payment-form-host.tsx pushes
  // the history entry of the success screen).
  onApproved?: () => void
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const eventRef = useRef<HTMLFieldSetElement>(null)
  const eventNoneRef = useRef<HTMLParagraphElement>(null)
  const [state, formAction, pending] = useActionState<
    ApprovePaymentState,
    FormData
  >(approvePaymentAction, null)
  const [productId, setProductId] = useState(products[0]?.id ?? "")
  const [amountText, setAmountText] = useState(
    products[0] ? formatAgorotInput(products[0].priceAgorot) : ""
  )
  const [amountError, setAmountError] = useState(false)
  const [eventId, setEventId] = useState("")
  const [eventError, setEventError] = useState(false)
  // The pinned session sent with the approval, for the success screen (the
  // list may change after the refresh).
  const [placed, setPlaced] = useState<PlacedSession | null>(null)
  const [reason, setReason] = useState("")
  const [paidOn, setPaidOn] = useState(today)
  const [payerLabel, setPayerLabel] = useState("")
  const [payerError, setPayerError] = useState(false)
  const payerRef = useRef<HTMLInputElement>(null)
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "")
  const [duplicateChecked, setDuplicateChecked] = useState(false)
  const [localError, setLocalError] = useState<ErrorCode | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [previewNonce, setPreviewNonce] = useState(0)
  const [preview, setPreview] = useState<{
    key: string
    answer: PreviewAnswer
  } | null>(null)
  const previewRequest = useRef(0)
  // A DUPLICATE_CONFIRM_REQUIRED from the server is hidden once the box is
  // checked, until the next submit.
  const [duplicateErrorDismissed, setDuplicateErrorDismissed] = useState(false)

  const product = products.find((p) => p.id === productId)
  const pinned = product?.pinned ?? null
  const eventOptions = pinned ? eventOptionsFor(pinned, events) : []
  // Only a session that is still offered and has room counts as chosen.
  const chosenEvent = eventOptions.find((e) => e.id === eventId && !e.full)
  const sentEventId = pinned ? (chosenEvent?.id ?? "") : ""
  const amountAgorot = parseShekelsToAgorot(amountText)
  const changed =
    product !== undefined &&
    amountAgorot !== null &&
    amountAgorot !== product.priceAgorot
  const trimmedLabel = customer ? "" : payerLabel.trim()
  const currentKey = previewKey({
    customerId: customer?.id ?? null,
    payerLabel: trimmedLabel,
    productId: product?.id ?? "",
    eventId: sentEventId,
    amountAgorot,
    paidOn,
    methodId,
  })
  const shownPreview =
    preview && preview.key === currentKey ? preview.answer : null
  const similar = shownPreview?.ok ? shownPreview.data.similar : []

  useEffect(() => {
    if (!currentKey || !product || amountAgorot === null) return
    // A new customer is previewed once her payer name is typed.
    if (!customer && !trimmedLabel) return
    // A pinned product is previewed once its session is chosen.
    if (product.pinned && !sentEventId) return
    const request = ++previewRequest.current
    const timer = setTimeout(() => {
      startTransition(async () => {
        const answer = await previewPaymentAction({
          customerId: customer?.id ?? null,
          payerLabel: trimmedLabel,
          productId: product.id,
          eventId: sentEventId || null,
          amountAgorot,
          paidOn,
          methodId,
        })
        // Only the answer to the latest choice counts.
        if (request === previewRequest.current) {
          setPreview({ key: currentKey, answer })
        }
      })
    }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // currentKey covers every input of the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, previewNonce])

  // A method hidden, a price changed or a session filled or closed in the
  // meantime: reload the lists. A
  // similar payment created in the meantime: reload the preview, which then
  // shows it.
  useEffect(() => {
    if (!state || state.ok) return
    if (
      state.code === "PAYMENT_METHOD_NOT_SELECTABLE" ||
      state.code === "CONFIRM_REQUIRED" ||
      // The session list's places are stale (story 3.11).
      state.code === "EVENT_FULL" ||
      state.code === "EVENT_NOT_BOOKABLE"
    ) {
      router.refresh()
    }
    if (state.code === "DUPLICATE_CONFIRM_REQUIRED") {
      startTransition(() => setPreviewNonce((n) => n + 1))
    }
  }, [state, router])

  // Once per success; the latest callback is read through a ref.
  const onApprovedRef = useRef(onApproved)
  useEffect(() => {
    onApprovedRef.current = onApproved
  })
  const approved = state?.ok === true
  // The approval took a place: the session list's counts are reloaded for
  // the next payment (story 3.11).
  useEffect(() => {
    if (!approved) return
    onApprovedRef.current?.()
    router.refresh()
  }, [approved, router])

  if (state?.ok) {
    if (state.data.kind === "existing" && customer) {
      return (
        <ApprovedPurchase
          customerId={customer.id}
          customerName={customer.name}
          productName={state.data.productName}
          units={state.data.units}
          expiresOn={state.data.expiresOn}
          placed={placed}
        />
      )
    }
    if (state.data.kind === "link") {
      return (
        <ApprovedLink
          link={state.data.link}
          linkExpiresAt={state.data.linkExpiresAt}
          payerLabel={state.data.payerLabel}
          placed={placed}
        />
      )
    }
  }

  // Any change of what the payment is drops the "separate payment" check:
  // the similar payments may be others now.
  const changeProduct = (id: string) => {
    setProductId(id)
    const next = products.find((p) => p.id === id)
    setAmountText(next ? formatAgorotInput(next.priceAgorot) : "")
    setAmountError(false)
    setEventId("")
    setEventError(false)
    setDuplicateChecked(false)
  }

  const dispatch = (confirmed: boolean) => {
    const form = formRef.current
    if (!form) return
    const data = new FormData(form)
    if (confirmed) data.set("confirmed", "1")
    setPlaced(
      product && chosenEvent
        ? {
            productName: product.name,
            conceptName: chosenEvent.conceptName,
            startsAt: chosenEvent.startsAt,
          }
        : null
    )
    setLocalError(null)
    setDuplicateErrorDismissed(false)
    // Dispatched by hand so the fields keep their values after an error.
    startTransition(() => formAction(data))
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const block = submitBlock({
      payerMissing: !customer && !trimmedLabel,
      amountAgorot,
      eventMissing: pinned !== null && !sentEventId,
      hasSimilar: similar.length > 0,
      duplicateChecked,
    })
    if (block === "payer") {
      setPayerError(true)
      payerRef.current?.focus()
      return
    }
    if (block === "amount") {
      setAmountError(true)
      amountRef.current?.focus()
      return
    }
    if (block === "event") {
      setEventError(true)
      // The first session that can be chosen; with every one full, the group.
      const target =
        eventRef.current?.querySelector<HTMLInputElement>(
          "input:not(:disabled)"
        ) ??
        eventRef.current ??
        eventNoneRef.current
      target?.focus()
      return
    }
    if (block === "duplicate") {
      setLocalError("DUPLICATE_CONFIRM_REQUIRED")
      return
    }
    if (changed) {
      setDialogOpen(true)
      return
    }
    dispatch(false)
  }

  const submitLabel = customer ? copy.submitExisting : copy.submit
  const serverError = state && !state.ok ? state.code : null
  const error =
    localError ??
    (serverError === "DUPLICATE_CONFIRM_REQUIRED" && duplicateErrorDismissed
      ? null
      : serverError)
  const priceText = product ? formatAgorot(product.priceAgorot) : ""
  const amountShown = amountAgorot !== null ? formatAgorot(amountAgorot) : ""
  const units = shownPreview?.ok ? shownPreview.data.units : null

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="flex flex-col gap-5"
      noValidate
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="customerId" value={customer?.id ?? ""} />
      <input type="hidden" name="amountAgorot" value={amountAgorot ?? ""} />
      <input type="hidden" name="eventId" value={sentEventId} />
      <input
        type="hidden"
        name="duplicateConfirmed"
        value={duplicateChecked ? "1" : ""}
      />

      {customer ? (
        <div className="flex items-center justify-between gap-3 rounded-sm bg-muted px-4 py-3">
          <p className="min-w-0 text-base font-semibold break-words">
            <bdi>{copy.customerHead(customer.name, customer.phone)}</bdi>
          </p>
          <Link
            href="/admin/payments/new/existing"
            className="inline-flex min-h-11 shrink-0 items-center text-[15px] underline underline-offset-4"
          >
            {copy.changeCustomer}
          </Link>
        </div>
      ) : (
        <>
          <Link
            href="/admin/links"
            className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-4"
          >
            {copy.allLinks}
          </Link>
          <p className="text-base font-semibold">{copy.newCustomer}</p>
          <Field data-invalid={payerError || undefined}>
            <FieldLabel htmlFor="payerLabel">
              {copy.payerLabel} {authCopy.required}
            </FieldLabel>
            <Input
              ref={payerRef}
              id="payerLabel"
              name="payerLabel"
              value={payerLabel}
              maxLength={40}
              autoComplete="off"
              onChange={(event) => {
                const next = event.target.value
                // Only a change of the label itself can change the similar
                // payments (outer spaces are ignored).
                if (next.trim() !== payerLabel.trim())
                  setDuplicateChecked(false)
                setPayerLabel(next)
                if (next.trim()) setPayerError(false)
              }}
              required
              aria-required
              aria-invalid={payerError || undefined}
              aria-describedby={
                payerError
                  ? "payerLabel-error payerLabel-hint"
                  : "payerLabel-hint"
              }
              className="h-12 text-base"
            />
            {payerError && (
              <p id="payerLabel-error" className="text-[15px] text-error">
                {errorMessage("FIELD_REQUIRED")}
              </p>
            )}
            <FieldDescription id="payerLabel-hint">
              {copy.payerLabelHint}
            </FieldDescription>
          </Field>
        </>
      )}

      <Field>
        <FieldLabel htmlFor="productId">
          {copy.product} {authCopy.required}
        </FieldLabel>
        <NativeSelect
          id="productId"
          name="productId"
          value={productId}
          onChange={(event) => changeProduct(event.target.value)}
          required
          aria-required
          className="h-12 w-full text-base"
        >
          {products.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      {pinned && (
        <Field data-invalid={eventError || undefined}>
          {eventOptions.length === 0 ? (
            // No control to label: the title and the reason, which takes
            // the focus (and the error) when the approval is blocked.
            <>
              <FieldTitle id="event-title">
                {copy.event} {authCopy.required}
              </FieldTitle>
              <p
                ref={eventNoneRef}
                id="event-none"
                tabIndex={-1}
                aria-labelledby="event-title event-none"
                aria-describedby={eventError ? "event-error" : undefined}
                className="text-[15px] text-muted-foreground outline-none"
              >
                {copy.eventNone}
              </p>
            </>
          ) : (
            <EventRadioGroup
              ref={eventRef}
              options={eventOptions}
              value={chosenEvent ? chosenEvent.id : ""}
              invalid={eventError}
              onChange={(id) => {
                setEventId(id)
                setEventError(false)
                setDuplicateChecked(false)
              }}
            />
          )}
          {eventError && (
            <p id="event-error" className="text-[15px] text-error">
              {errorMessage("PINNED_EVENT_REQUIRED")}
            </p>
          )}
        </Field>
      )}

      {product && (
        <Field data-invalid={amountError || undefined}>
          <FieldLabel htmlFor="amount">
            {copy.amount} {authCopy.required}
          </FieldLabel>
          <Input
            ref={amountRef}
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            dir="ltr"
            value={amountText}
            onChange={(event) => {
              setAmountText(event.target.value)
              setAmountError(false)
              setDuplicateChecked(false)
            }}
            onBlur={() => setAmountError(amountAgorot === null)}
            required
            aria-required
            aria-invalid={amountError || undefined}
            aria-describedby={amountError ? "amount-error" : "amount-hint"}
            className="h-12 text-start text-base"
          />
          {amountError ? (
            <p id="amount-error" className="text-[15px] text-error">
              {copy.amountInvalid}
            </p>
          ) : (
            <FieldDescription id="amount-hint">
              {changed
                ? copy.amountChanged(priceText)
                : copy.amountFromProduct(priceText)}
            </FieldDescription>
          )}
        </Field>
      )}

      {changed && (
        <Field>
          <FieldLabel htmlFor="amountOverrideReason">
            {copy.overrideReason}
          </FieldLabel>
          <Textarea
            id="amountOverrideReason"
            name="amountOverrideReason"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-20 text-base"
          />
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor="paidOn">
          {copy.paidOn} {authCopy.required}
        </FieldLabel>
        <Input
          id="paidOn"
          name="paidOn"
          type="date"
          value={paidOn}
          max={today}
          onChange={(event) => {
            setPaidOn(event.target.value)
            setDuplicateChecked(false)
          }}
          required
          aria-required
          className="h-12 text-base"
        />
      </Field>

      <RadioCardGroup
        legend={`${copy.method} ${authCopy.required}`}
        name="paymentMethodId"
        options={methods.map((m) => ({ value: m.id, label: m.name }))}
        value={methodId}
        onChange={(value) => {
          setMethodId(value)
          setDuplicateChecked(false)
        }}
        required
      />

      <details className="flex flex-col gap-4">
        <summary className="min-h-11 cursor-pointer py-2 text-base">
          {copy.more}
        </summary>
        <div className="mt-3 flex flex-col gap-5">
          <Field>
            <FieldLabel htmlFor="reference">{copy.reference}</FieldLabel>
            <Input
              id="reference"
              name="reference"
              maxLength={100}
              className="h-12 text-base"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="note">{copy.note}</FieldLabel>
            <Textarea
              id="note"
              name="note"
              maxLength={500}
              className="min-h-20 text-base"
            />
          </Field>
        </div>
      </details>

      <section aria-labelledby="preview-title" aria-live="polite">
        <h2 id="preview-title" className="mb-2 text-sm font-semibold">
          {copy.preview}
        </h2>
        {shownPreview?.ok && (
          <PreviewBox preview={shownPreview.data} customer={customer} />
        )}
        {shownPreview && !shownPreview.ok && (
          <InlineNotice tone="error">
            {errorMessage(shownPreview.code)}
          </InlineNotice>
        )}
      </section>

      {shownPreview?.ok && similar.length > 0 && (
        <DuplicateWarning
          preview={shownPreview.data}
          checked={duplicateChecked}
          onCheckedChange={(value) => {
            setDuplicateChecked(value)
            if (value) {
              setLocalError(null)
              setDuplicateErrorDismissed(true)
            }
          }}
        />
      )}

      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}

      <Button
        type="submit"
        size="lg"
        className={BUTTON}
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
      >
        {pending && <Spinner aria-hidden />}
        {submitLabel}
      </Button>

      {product && amountAgorot !== null && (
        <SensitiveConfirmDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          action="price_change"
          description={copy.priceChange.body}
          impact={[
            {
              label: copy.priceChange.customer,
              value: customer ? customer.name : copy.priceChange.newCustomer,
            },
            {
              label: copy.priceChange.product,
              value:
                units === null
                  ? product.name
                  : copy.previewUnits(product.name, units),
            },
            {
              label: copy.priceChange.price,
              value: (
                <bdi className="font-semibold">
                  {copy.priceChange.priceChange(priceText, amountShown)}
                </bdi>
              ),
            },
            ...(reason.trim()
              ? [{ label: copy.priceChange.reason, value: reason.trim() }]
              : []),
          ]}
          checkboxLabel={copy.priceChange.confirm(amountShown, priceText)}
          confirmLabel={submitLabel}
          onConfirm={() => {
            setDialogOpen(false)
            dispatch(true)
          }}
        />
      )}
    </form>
  )
}

function PreviewBox({
  preview,
  customer,
}: {
  preview: PaymentPreview
  customer: CustomerOption | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-xl bg-muted px-4 py-3 text-[15px]">
        <p className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-brand-accent"
          />
          {copy.previewUnits(preview.productName, preview.units)}
        </p>
        {preview.event ? (
          <p>
            <time dateTime={preview.event.startsAt}>
              <bdi>
                {copy.previewEvent(
                  preview.event.conceptName,
                  sessionDay(preview.event.startsAt)
                )}
              </bdi>
            </time>
          </p>
        ) : (
          <p>
            {copy.previewExpires}{" "}
            <time dateTime={formatLocalDate(preview.expiresOn)}>
              <bdi>{formatDayMonth(preview.expiresOn)}</bdi>
            </time>
          </p>
        )}
        <p className="text-muted-foreground">
          {customer
            ? copy.previewForCustomer(preview.customerName ?? customer.name)
            : copy.previewLink}
        </p>
      </div>
      {preview.expired && (
        <InlineNotice tone="warning">{copy.previewExpired}</InlineNotice>
      )}
    </div>
  )
}

// A payment with the same product, amount and method near the purchase date
// (private.similar_payments): the list, and the required "separate payment"
// check.
function DuplicateWarning({
  preview,
  checked,
  onCheckedChange,
}: {
  preview: PaymentPreview
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <section
      aria-labelledby="duplicate-title"
      className="flex flex-col gap-3 rounded-xl bg-warning-tint px-4 py-3 text-[15px] text-warning"
    >
      <h2 id="duplicate-title" className="text-base font-semibold">
        {copy.duplicateTitle}
      </h2>
      <p>{copy.duplicateBody(preview.windowDays)}</p>
      <ul className="flex flex-col gap-1">
        {preview.similar.map((payment) => (
          <li key={`${payment.createdAt}-${payment.paidOn}`}>
            <bdi>
              {copy.duplicateRow(
                payment.customerName ?? payment.payerLabel ?? copy.newCustomer,
                formatDayMonth(payment.paidOn),
                formatDayMonth(payment.createdAt)
              )}
            </bdi>
          </li>
        ))}
      </ul>
      <div className="flex items-start gap-3 text-foreground">
        <Checkbox
          id="duplicate-confirm"
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          className="mt-0.5 size-6 rounded-[4px] border-[1.5px] border-muted-foreground bg-card"
        />
        <label htmlFor="duplicate-confirm" className="leading-normal">
          {copy.duplicateConfirm}
        </label>
      </div>
    </section>
  )
}

// A full load of the choice, so the next payment gets a new idempotency key.
function AnotherPayment() {
  return (
    <a
      href="/admin/payments/new"
      className={buttonVariants({
        variant: "outline",
        size: "lg",
        className: BUTTON,
      })}
    >
      {copy.another}
    </a>
  )
}

// The approval's result for an existing customer: the purchase is in her
// account already (no link). A card (no session placed) leads on to booking
// her for a date (story 3.4).
export function ApprovedPurchase({
  customerId,
  customerName,
  productName,
  units,
  expiresOn,
  placed = null,
}: {
  customerId: string
  customerName: string
  productName: string
  units: number
  expiresOn: string
  // A pinned product: its session instead of the entries and expiry.
  placed?: PlacedSession | null
}) {
  const noticeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    noticeRef.current?.focus()
  }, [])

  return (
    <div className="flex flex-col gap-5">
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        <InlineNotice tone="success">
          {copy.successExisting(customerName)}
        </InlineNotice>
      </div>
      <p className="rounded-xl bg-muted px-4 py-3 text-[15px] font-semibold">
        <bdi>
          {placed
            ? placedLines(placed)
            : copy.successPurchase(
                productName,
                units,
                formatDayMonth(expiresOn)
              )}
        </bdi>
      </p>
      {!placed && (
        <a
          href={`/admin/sessions/book?customer=${encodeURIComponent(customerId)}`}
          className={buttonVariants({
            variant: "default",
            size: "lg",
            className: BUTTON,
          })}
        >
          {adminCopy.sessions.bookForDate}
        </a>
      )}
      <AnotherPayment />
      <a
        href="/admin/payments"
        className={buttonVariants({
          variant: "ghost",
          size: "lg",
          className: BUTTON,
        })}
      >
        {copy.toList}
      </a>
    </div>
  )
}

// The approval's result for a new customer: the one-time join link, shown
// once (AD-10).
export function ApprovedLink({
  link,
  linkExpiresAt,
  payerLabel = null,
  placed = null,
}: {
  link: string | null
  linkExpiresAt: string
  payerLabel?: string | null
  // A pinned product: the session whose place was kept.
  placed?: PlacedSession | null
}) {
  const noticeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    noticeRef.current?.focus()
  }, [])

  // A repeat of an approval that already succeeded: no link to show.
  if (!link) {
    return (
      <div className="flex flex-col gap-5">
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          <InlineNotice tone="warning">{copy.linkNotShown}</InlineNotice>
        </div>
        <AnotherPayment />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        <InlineNotice tone="success">{copy.success}</InlineNotice>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {payerLabel ? copy.linkTitleNamed(payerLabel) : copy.linkTitle}
          </h2>
          <span className="rounded-full bg-pending-tint px-2.5 py-0.5 text-[13px] text-pending">
            {copy.linkPending}
          </span>
        </div>
        <p className="text-[15px]">
          {copy.linkValidUntil}{" "}
          <time dateTime={linkExpiresAt}>
            <bdi>{formatSessionDateTime(linkExpiresAt)}</bdi>
          </time>
        </p>
        <p className="text-[15px] text-muted-foreground">{copy.linkOnce}</p>

        <LinkShare link={link} />
      </div>

      {placed && (
        <p className="rounded-xl bg-muted px-4 py-3 text-[15px] font-semibold">
          {placedLines(placed)}
        </p>
      )}

      <AnotherPayment />
    </div>
  )
}

// "{יום} DD.MM": the admin's brunch details never show the time (user
// decision 2026-10-05).
function sessionDay(value: string): string {
  return `${formatWeekday(value)} ${formatDayMonth(value)}`
}

// "{product} · המקום נשמר:" and, on a new line, the session.
function placedLines(placed: PlacedSession) {
  return (
    <>
      <bdi>{copy.successPlacedLead(placed.productName)}</bdi>
      <br />
      <bdi>
        {copy.successPlacedSession(
          placed.conceptName,
          sessionDay(placed.startsAt)
        )}
      </bdi>
    </>
  )
}

// The session of a pinned product (story 3.11): DESIGN.md › radio-card, one
// row per session in two lines (no time, user decision 2026-10-05). Native
// radios in a fieldset, so the arrow keys move between them; a full session
// is shown, marked and cannot be chosen.
function EventRadioGroup({
  ref,
  options,
  value,
  invalid,
  onChange,
}: {
  ref: React.Ref<HTMLFieldSetElement>
  options: readonly EventOption[]
  value: string
  invalid: boolean
  onChange: (id: string) => void
}) {
  return (
    <fieldset
      ref={ref}
      tabIndex={-1}
      aria-required
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? "event-error" : "event-hint"}
      className="flex flex-col gap-2 outline-none"
    >
      <legend className="mb-1 text-sm font-medium">
        {copy.event} {authCopy.required}
      </legend>
      <p id="event-hint" className="mb-1 text-[15px] text-muted-foreground">
        {copy.eventPlaceholder}
      </p>
      {options.map((option) => (
        <label
          key={option.id}
          className="group flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border border-muted-foreground bg-card px-3.5 py-2.5 text-base has-checked:border-foreground has-checked:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-primary has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background has-disabled:cursor-not-allowed has-disabled:border-border has-disabled:text-muted-foreground"
        >
          <input
            type="radio"
            name="event"
            value={option.id}
            checked={value === option.id}
            disabled={option.full}
            onChange={() => onChange(option.id)}
            required
            className="sr-only"
          />
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-muted-foreground group-has-checked:border-primary group-has-disabled:border-border"
          >
            <span className="size-2.5 rounded-full bg-primary opacity-0 group-has-checked:opacity-100" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold break-words">
              {copy.eventOptionTitle(option.conceptName)}
            </span>
            <bdi className="text-[15px]">
              {copy.eventOptionDetails(
                sessionDay(option.startsAt),
                option.occupied,
                option.capacity,
                option.full
              )}
            </bdi>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
