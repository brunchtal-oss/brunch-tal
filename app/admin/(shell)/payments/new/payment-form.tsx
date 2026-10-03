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
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button, buttonVariants } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { authCopy } from "@/lib/copy/auth"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { formatAgorot } from "@/lib/money"
import {
  formatDayMonth,
  formatLocalDate,
  formatSessionDateTime,
} from "@/lib/time"

import {
  approvePaymentAction,
  previewPaymentAction,
  type ApprovePaymentState,
  type PaymentPreview,
} from "./actions"

const copy = adminCopy.payments
const BUTTON = "h-12 text-base"

export type ProductOption = { id: string; name: string; priceAgorot: number }
export type MethodOption = { id: string; name: string }

// Tal approves a payment for a new customer (CAP-2, flow 2): no customer
// field; product (days products only until E3), the amount read from the
// product (story 2.5 adds the override), purchase date, payment method, and
// reference and note folded. "What will be created" comes from the same plan
// as the approval (AD-7).
export function PaymentForm({
  products,
  methods,
  today,
  idempotencyKey,
  onApproved,
}: {
  products: readonly ProductOption[]
  methods: readonly MethodOption[]
  today: string
  idempotencyKey: string
  // Called once when the approval succeeded (payment-form-host.tsx pushes
  // the history entry of the success screen).
  onApproved?: () => void
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<
    ApprovePaymentState,
    FormData
  >(approvePaymentAction, null)
  const [productId, setProductId] = useState(products[0]?.id ?? "")
  const [paidOn, setPaidOn] = useState(today)
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "")
  const [preview, setPreview] = useState<
    { ok: true; data: PaymentPreview } | { ok: false; code: ErrorCode } | null
  >(null)
  const previewRequest = useRef(0)
  const product = products.find((p) => p.id === productId)

  useEffect(() => {
    if (!product || !paidOn) return
    const request = ++previewRequest.current
    startTransition(async () => {
      const result = await previewPaymentAction({
        productId: product.id,
        amountAgorot: product.priceAgorot,
        paidOn,
      })
      // Only the answer to the latest choice counts.
      if (request === previewRequest.current) setPreview(result)
    })
  }, [product, paidOn])

  // A method hidden in the meantime: show the error and reload the list.
  useEffect(() => {
    if (state && !state.ok && state.code === "PAYMENT_METHOD_NOT_SELECTABLE") {
      router.refresh()
    }
  }, [state, router])

  // Once per success; the latest callback is read through a ref.
  const onApprovedRef = useRef(onApproved)
  useEffect(() => {
    onApprovedRef.current = onApproved
  })
  const approved = state?.ok === true
  useEffect(() => {
    if (approved) onApprovedRef.current?.()
  }, [approved])

  if (state?.ok) return <ApprovedLink {...state.data} />

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    // Dispatched by hand so the fields keep their values after an error.
    const data = new FormData(event.currentTarget)
    startTransition(() => formAction(data))
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <Link
        href="/admin/links"
        className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-4"
      >
        {copy.allLinks}
      </Link>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input
        type="hidden"
        name="amountAgorot"
        value={product?.priceAgorot ?? ""}
      />

      <p className="text-base font-semibold">{copy.newCustomer}</p>

      <Field>
        <FieldLabel htmlFor="productId">
          {copy.product} {authCopy.required}
        </FieldLabel>
        <NativeSelect
          id="productId"
          name="productId"
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
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

      {product && (
        <Field>
          <FieldLabel htmlFor="amount">{copy.amount}</FieldLabel>
          <Input
            id="amount"
            readOnly
            value={formatAgorot(product.priceAgorot)}
            aria-describedby="amount-hint"
            className="h-12 text-base"
          />
          <FieldDescription id="amount-hint">
            {copy.amountFromProduct(formatAgorot(product.priceAgorot))}
          </FieldDescription>
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
          onChange={(event) => setPaidOn(event.target.value)}
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
        onChange={setMethodId}
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
        {preview?.ok && (
          <div className="flex flex-col gap-1 rounded-xl bg-muted px-4 py-3 text-[15px]">
            <p className="flex items-center gap-2 font-semibold">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-brand-accent"
              />
              {copy.previewUnits(preview.data.productName, preview.data.units)}
            </p>
            <p>
              {copy.previewExpires}{" "}
              <time dateTime={formatLocalDate(preview.data.expiresOn)}>
                <bdi>{formatDayMonth(preview.data.expiresOn)}</bdi>
              </time>
            </p>
            <p className="text-muted-foreground">{copy.previewLink}</p>
          </div>
        )}
        {preview && !preview.ok && (
          <InlineNotice tone="error">{errorMessage(preview.code)}</InlineNotice>
        )}
      </section>

      {state && !state.ok && (
        <InlineNotice tone="error">{errorMessage(state.code)}</InlineNotice>
      )}

      <Button
        type="submit"
        size="lg"
        className={BUTTON}
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
      >
        {pending && <Spinner aria-hidden />}
        {copy.submit}
      </Button>
    </form>
  )
}

// The approval's result: the one-time join link, shown once (AD-10).
export function ApprovedLink({
  link,
  linkExpiresAt,
}: {
  link: string | null
  linkExpiresAt: string
}) {
  const noticeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    noticeRef.current?.focus()
  }, [])

  // A full load, so the next payment gets a new idempotency key.
  const another = (
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

  // A repeat of an approval that already succeeded: no link to show.
  if (!link) {
    return (
      <div className="flex flex-col gap-5">
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          <InlineNotice tone="warning">{copy.linkNotShown}</InlineNotice>
        </div>
        {another}
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
          <h2 className="text-base font-semibold">{copy.linkTitle}</h2>
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

      {another}
    </div>
  )
}
