"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { XIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { customerCopy as copy } from "@/lib/copy/customer"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import {
  formatDayMonth,
  formatLocalDate,
  formatSessionDateTime,
  formatWeekday,
} from "@/lib/time"
import { cn } from "@/lib/utils"

import { CancelBooking } from "../../bookings/cancel-booking"
import { bookSessionAction } from "../actions"
import { blockedAction, type BookingPreview } from "./booking-preview"

const LINK = "font-semibold underline underline-offset-[3px]"

// The action area of a session page (story 3.2, CAP-13). Bookable: "להרשמה"
// opens the booking bottom-sheet (what is used, what remains, the validity,
// the last self-cancel time, one confirm button). Already booked: a success
// notice and the cancel (story 3.6). Blocked: the reason in an inline-notice, the button replaced by
// the action that can help. After a booking: the climax, and focus on it.
// No optimistic result: the button stays busy until the server answers.
export function BookingPanel({
  eventId,
  title,
  startsAt,
  preview,
  contactHref,
}: {
  eventId: string
  title: string
  startsAt: string
  preview: BookingPreview
  contactHref: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [done, setDone] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const climaxRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (done) climaxRef.current?.focus()
  }, [done])

  if (done) {
    return (
      <section className="flex flex-col gap-4 py-2" aria-live="polite">
        <span aria-hidden className="h-px w-8 bg-brand-accent" />
        <h2
          ref={climaxRef}
          tabIndex={-1}
          className="font-heading text-[32px] leading-[1.15] font-light"
        >
          {copy.climax}
        </h2>
        <Link href="/me" className={cn(LINK, "self-start py-2.5")}>
          {copy.toMyBalance}
        </Link>
      </section>
    )
  }

  if (preview.kind === "booked") {
    // Story 3.6: her booking, then the cancel (or the contact phrase past
    // the self-cancel boundary).
    return (
      <div className="flex flex-col items-start gap-4">
        <InlineNotice tone="success" className="w-full">
          {copy.registered}
        </InlineNotice>
        {preview.bookingId && (
          <CancelBooking
            bookingId={preview.bookingId}
            title={title}
            startsAt={startsAt}
            funding={preview.funding}
            productName={preview.productName}
            optionsCount={preview.optionsCount}
            canSelfCancel={preview.canSelfCancel}
            contactHref={contactHref}
            className={preview.canSelfCancel ? undefined : "w-full"}
          />
        )}
      </div>
    )
  }

  if (preview.kind === "blocked") {
    const action =
      blockedAction(preview.code) === "contact" && contactHref ? (
        <a
          href={contactHref}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(LINK, "py-2.5")}
        >
          {copy.contactPhrase}
        </a>
      ) : (
        <Link href="/me/sessions" className={cn(LINK, "py-2.5")}>
          {copy.allSessions}
        </Link>
      )
    return (
      <InlineNotice tone="warning" actions={action}>
        {errorMessage(preview.code)}
      </InlineNotice>
    )
  }

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await bookSessionAction({ eventId, idempotencyKey: key })
      if (result.ok) {
        setOpen(false)
        setDone(true)
        // The chip ("נרשמת") and the preview come from the server again.
        router.refresh()
        return
      }
      setError(result.code)
    } catch {
      setError("SERVER_ERROR")
    } finally {
      setBusy(false)
    }
    // A failure: the next try is a new request (AD-5), and the chip and the
    // preview are read again; the notice stays until the next try.
    setKey(newIdempotencyKey())
    router.refresh()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // The sheet stays open while the booking is on its way.
        if (!busy) setOpen(next)
      }}
    >
      <Button
        type="button"
        size="lg"
        onClick={() => {
          // One key per opening of the sheet, sent with every try (AD-5).
          setKey(newIdempotencyKey())
          setError(null)
          setOpen(true)
        }}
        className="h-12 w-full max-w-xs rounded-[4px] text-base font-semibold"
      >
        {copy.book}
      </Button>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-booking-sheet=""
        aria-modal="true"
        initialFocus={titleRef}
        finalFocus={() => !done}
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
            <bdi>{title}</bdi>
          </SheetTitle>
          <SheetClose
            aria-label={copy.close}
            className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
          >
            <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
          </SheetClose>
        </div>
        <p className="mt-1 font-semibold">
          <time dateTime={startsAt}>{formatSessionDateTime(startsAt)}</time>
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted px-4 py-3 text-[15px]">
          <dt className="text-muted-foreground">{copy.uses}</dt>
          <dd className="font-semibold">
            {copy.usesValue("")}
            <bdi>{preview.productName}</bdi>
          </dd>
          <dt className="text-muted-foreground">{copy.remaining}</dt>
          <dd className="font-semibold">
            {copy.remainingValue(preview.availableAfter)}
          </dd>
          <dt className="text-muted-foreground">{copy.validUntilLabel}</dt>
          <dd className="font-semibold">
            <time dateTime={formatLocalDate(preview.expiresOn)}>
              {formatWeekday(preview.expiresOn)}{" "}
              <bdi>{formatDayMonth(preview.expiresOn)}</bdi>
            </time>
          </dd>
        </dl>
        {error && (
          <InlineNotice tone="error" className="mt-4">
            {errorMessage(error)}
          </InlineNotice>
        )}
        <Button
          type="button"
          size="lg"
          onClick={confirm}
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
          className="mt-5 h-12 w-full rounded-[4px] text-base font-semibold"
        >
          {busy && <Spinner aria-hidden />}
          {copy.book}
        </Button>
      </SheetContent>
    </Sheet>
  )
}
