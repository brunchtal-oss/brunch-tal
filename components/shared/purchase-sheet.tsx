"use client"

import { useEffect, useId, useReducer, useRef } from "react"
import Link from "next/link"
import { XIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatAgorot } from "@/lib/money"
import {
  holdsSeat,
  purchaseRequest,
  type PurchaseProduct,
  type PurchaseStartInput,
  type PurchaseStartResult,
} from "@/lib/payments/purchase-options"
import {
  advisesContact,
  CLOSED,
  sheetReducer,
  unavailableReason,
} from "@/lib/payments/purchase-sheet-state"
import { cn } from "@/lib/utils"

const copy = customerCopy.purchase
const OPENS_OUTSIDE = shellCopy.public.contact.opensOutside

/** The purchase terms' public page (content page `purchase-terms`). */
export const PURCHASE_TERMS_HREF = "/purchase-terms"

const LINK = "font-semibold underline underline-offset-[3px]"

/**
 * The purchase sheet (online payments, PR B): a bottom-sheet (dialog,
 * initial focus on the title, a visible X) opened by its SheetTrigger, with
 * the products as radio-cards (name, what it gives, the price at the end),
 * the hold line for a pinned product, the terms checkbox with its link, and
 * "למעבר לתשלום" in the thumb zone. One idempotency key per opening, a new
 * one per product change, failure or return from the back-forward cache
 * (AD-5; lib/payments/purchase-sheet-state.ts). A refusal is an
 * inline-notice in the sheet, with "צרי קשר" when it advises contact;
 * success leaves for the Grow form (no timer here or later).
 */
export function PurchaseSheet({
  products,
  eventId,
  start,
  trigger,
  triggerClassName,
  contactHref = null,
}: {
  products: readonly PurchaseProduct[]
  // The session of the page; a pinned product holds a seat in it, a card is
  // bought without it.
  eventId: string | null
  start: (input: PurchaseStartInput) => Promise<PurchaseStartResult>
  trigger: string
  triggerClassName?: string
  // WhatsApp, for a refusal that advises contact.
  contactHref?: string | null
}) {
  const [state, dispatch] = useReducer(sheetReducer, CLOSED)
  const titleRef = useRef<HTMLHeadingElement>(null)

  // Back from Grow restores this page from the back-forward cache with the
  // button still busy: ready again, with a new request.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        dispatch({ type: "pageshow", key: newIdempotencyKey() })
      }
    }
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [])

  const product = products.find((p) => p.id === state.productId) ?? null
  const request = purchaseRequest(product, eventId, state.terms, state.key)

  async function pay() {
    if (state.busy || !request) return
    dispatch({ type: "submit" })
    let code: ErrorCode
    try {
      const result = await start(request)
      if (result.ok && result.data.kind === "redirect") {
        // To Grow's form; the button stays busy while the page leaves.
        window.location.assign(result.data.url)
        return
      }
      // A replayed key: the first tap already opened a form whose address
      // is not kept (AD-10); a new try starts a new checkout.
      code = result.ok ? "SERVER_ERROR" : result.code
    } catch {
      code = "SERVER_ERROR"
    }
    dispatch({ type: "failed", code, key: newIdempotencyKey() })
  }

  return (
    <Sheet
      open={state.open}
      onOpenChange={(next) => {
        if (next) {
          dispatch({ type: "open", key: newIdempotencyKey(), products })
        } else {
          dispatch({ type: "close" })
        }
      }}
    >
      <SheetTrigger className={triggerClassName}>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-purchase-sheet=""
        aria-modal="true"
        initialFocus={titleRef}
        className="mx-auto max-h-[90vh] w-full max-w-[720px] gap-0 overflow-y-auto rounded-t-xl border-0 bg-card px-6 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-base shadow-none"
      >
        <span
          aria-hidden
          className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-border"
        />
        <div className="flex items-center justify-between gap-2">
          <SheetTitle
            ref={titleRef}
            tabIndex={-1}
            className="font-heading text-[22px] leading-[1.25] font-light"
          >
            {copy.sheetTitle}
          </SheetTitle>
          <SheetClose
            aria-label={customerCopy.close}
            className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
          >
            <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
          </SheetClose>
        </div>
        <PurchaseSheetBody
          products={products}
          eventId={eventId}
          productId={state.productId}
          terms={state.terms}
          busy={state.busy}
          error={state.error}
          contactHref={contactHref}
          onSelect={(productId) =>
            dispatch({ type: "select", productId, key: newIdempotencyKey() })
          }
          onTerms={(value) => dispatch({ type: "terms", value })}
          onPay={pay}
        />
      </SheetContent>
    </Sheet>
  )
}

/**
 * The sheet's content under its title (presentation only, also rendered by
 * the tests): the products, the hold line, the terms, the refusal and the
 * pay button, aria-disabled with its visible reason while it cannot be
 * pressed.
 */
export function PurchaseSheetBody({
  products,
  eventId,
  productId,
  terms,
  busy,
  error,
  contactHref,
  onSelect,
  onTerms,
  onPay,
}: {
  products: readonly PurchaseProduct[]
  eventId: string | null
  productId: string
  terms: boolean
  busy: boolean
  error: ErrorCode | null
  contactHref: string | null
  onSelect: (productId: string) => void
  onTerms: (value: boolean) => void
  onPay: () => void
}) {
  const ids = useId()
  const termsId = `${ids}-terms`
  const reasonId = `${ids}-reason`
  const product = products.find((p) => p.id === productId) ?? null
  const pinned = holdsSeat(product, eventId)
  const reason = unavailableReason(product, terms)
  const unavailable = reason !== null && !busy

  return (
    <>
      <fieldset className="mt-4 flex flex-col gap-2">
        <legend className="mb-2 text-[15px] font-semibold">
          {copy.productsLegend}
        </legend>
        {products.map((p) => (
          <label
            key={p.id}
            className="group flex min-h-12 cursor-pointer items-center gap-3 rounded-[4px] border border-muted-foreground bg-card px-4 py-3 has-checked:border-foreground has-checked:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-primary has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background"
          >
            <input
              type="radio"
              name={`${ids}-product`}
              value={p.id}
              checked={productId === p.id}
              onChange={() => onSelect(p.id)}
              className="sr-only"
            />
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-muted-foreground group-has-checked:border-primary"
            >
              <span className="size-2.5 rounded-full bg-primary opacity-0 group-has-checked:opacity-100" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 break-words">
              <bdi className="font-semibold">{p.name}</bdi>
              <span className="text-[15px] text-muted-foreground">
                {p.validityMode === "session"
                  ? copy.pinnedDetail
                  : copy.cardDetail(p.units, p.validityDays)}
              </span>
            </span>
            <bdi className="shrink-0 font-semibold tabular-nums">
              {formatAgorot(p.priceAgorot)}
            </bdi>
          </label>
        ))}
      </fieldset>

      {pinned && (
        <p className="mt-3 text-[15px] text-muted-foreground">
          {copy.holdLine}
        </p>
      )}

      <div className="mt-5 flex min-h-11 items-center gap-3">
        <Checkbox
          id={termsId}
          checked={terms}
          onCheckedChange={(next) => onTerms(next === true)}
          className="size-6 shrink-0 rounded-[4px] border-[1.5px] border-muted-foreground"
        />
        <label htmlFor={termsId} className="text-base">
          {copy.termsBefore}
          <Link
            href={PURCHASE_TERMS_HREF}
            target="_blank"
            rel="noopener"
            className={LINK}
          >
            {copy.termsLink}
            <span className="sr-only"> {OPENS_OUTSIDE}</span>
          </Link>
        </label>
      </div>

      {error && (
        <InlineNotice
          tone="error"
          className="mt-4"
          actions={
            advisesContact(error) && contactHref ? (
              <a
                href={contactHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(LINK, "py-3")}
              >
                {copy.contact}
                <span className="sr-only"> {OPENS_OUTSIDE}</span>
              </a>
            ) : undefined
          }
        >
          {errorMessage(error)}
        </InlineNotice>
      )}

      <OnlineButton
        type="button"
        size="lg"
        onClick={onPay}
        aria-busy={busy || undefined}
        aria-disabled={busy || reason !== null || undefined}
        aria-describedby={reason !== null ? reasonId : undefined}
        className={cn(
          "mt-6 h-12 w-full rounded-[4px] text-base font-semibold",
          unavailable && "opacity-50"
        )}
      >
        {busy && <Spinner aria-hidden />}
        {copy.pay}
      </OnlineButton>
      {reason !== null && (
        <p id={reasonId} className="mt-2 text-[15px] text-muted-foreground">
          {reason === "product"
            ? copy.chooseProduct
            : errorMessage("TERMS_REQUIRED")}
        </p>
      )}
    </>
  )
}
