"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { XIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { customerCopy } from "@/lib/copy/customer"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import { setGuestDetailsAction } from "../../bookings/actions"

const copy = customerCopy.companion
const LINK = "font-semibold underline underline-offset-[3px]"

export const GUEST_DETAILS_MAX = 1000

/** The anchor of a booking's companion section (the notification's target). */
export function companionAnchor(bookingId: string): string {
  return `booking-${bookingId}`
}

// The companion's dietary note of a couple booking (story 3.5), on the
// session page under the booking (story 5.21, fix 7: under the card in
// /me/bookings it was missed). The saved text, or "לא נמסרו". While the server says it is editable
// (confirmed, couple, before the session's registration close),
// "עריכה" ("הוספה" when empty) opens a bottom-sheet with one textarea and
// "שמירה"; the result is an inline-notice ("נשמר"). After the close it is
// read-only, with the closed note and "צרי קשר". The section's id is the target
// of booking_confirmed_couple (/me/sessions/<event>#booking-<id>). No optimistic
// result: the view shows what the server returned (router.refresh), the
// button is busy until it answers, and a new idempotency key on each
// opening and after a failure (AD-5).
export function CompanionNote({
  bookingId,
  guestDetails,
  editable,
  contactHref,
}: {
  bookingId: string
  guestDetails: string | null
  editable: boolean
  contactHref: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [text, setText] = useState(guestDetails ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [saved, setSaved] = useState(false)
  // The registration closed while the page was open: read-only from now on.
  const [closed, setClosed] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const labelId = `companion-label-${bookingId}`
  const fieldId = `companion-field-${bookingId}`

  const canEdit = editable && !closed

  // The couple notification opens #booking-<id>, but the section streams in
  // after the page, so the browser's own hash scroll can miss it.
  useEffect(() => {
    if (window.location.hash === `#${companionAnchor(bookingId)}`) {
      sectionRef.current?.scrollIntoView({ block: "start" })
    }
  }, [bookingId])

  async function save() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await setGuestDetailsAction({
        bookingId,
        guestDetails: text,
        idempotencyKey: key,
      })
      if (result.ok) {
        setOpen(false)
        setSaved(true)
        router.refresh()
        return
      }
      if (result.code === "REGISTRATION_CLOSED") {
        setOpen(false)
        setClosed(true)
        router.refresh()
        return
      }
      setError(result.code)
    } catch {
      setError("SERVER_ERROR")
    } finally {
      setBusy(false)
    }
    // A failure: the next try is a new request (AD-5).
    setKey(newIdempotencyKey())
  }

  const contact = contactHref ? (
    <a
      href={contactHref}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(LINK, "py-3")}
    >
      {customerCopy.contactPhrase}
    </a>
  ) : null

  return (
    <section
      ref={sectionRef}
      id={companionAnchor(bookingId)}
      aria-labelledby={labelId}
      className="flex scroll-mt-24 flex-col gap-2 rounded-lg bg-muted px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={labelId} className="text-[15px] text-muted-foreground">
            {copy.label}
          </h2>
          <p
            className={cn(
              "text-base break-words whitespace-pre-line",
              !guestDetails && "text-muted-foreground"
            )}
          >
            {guestDetails ? <bdi>{guestDetails}</bdi> : copy.empty}
          </p>
        </div>
        {canEdit && (
          <Sheet
            open={open}
            onOpenChange={(next) => {
              // The sheet stays open while the save is on its way.
              if (!busy) setOpen(next)
            }}
          >
            <Button
              type="button"
              variant="ghost"
              className="-me-2 min-h-11 shrink-0 underline underline-offset-4"
              aria-describedby={labelId}
              onClick={() => {
                setKey(newIdempotencyKey())
                setText(guestDetails ?? "")
                setError(null)
                setSaved(false)
                setOpen(true)
              }}
            >
              {guestDetails ? copy.edit : copy.add}
            </Button>
            <SheetContent
              side="bottom"
              showCloseButton={false}
              data-companion-sheet=""
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
                  {copy.label}
                </SheetTitle>
                <SheetClose
                  aria-label={customerCopy.close}
                  className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
                >
                  <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
                </SheetClose>
              </div>
              <label htmlFor={fieldId} className="sr-only">
                {copy.label}
              </label>
              <Textarea
                id={fieldId}
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  // A changed request is a new request (AD-5).
                  setKey(newIdempotencyKey())
                }}
                maxLength={GUEST_DETAILS_MAX}
                aria-invalid={error === "INVALID_INPUT" || undefined}
                className="mt-4 min-h-28 text-base"
              />
              {error && (
                <InlineNotice tone="error" className="mt-4">
                  {errorMessage(error)}
                </InlineNotice>
              )}
              <OnlineButton
                type="button"
                size="lg"
                onClick={save}
                aria-busy={busy || undefined}
                aria-disabled={busy || undefined}
                className="mt-6 h-12 w-full rounded-[4px] text-base font-semibold"
              >
                {busy && <Spinner aria-hidden />}
                {copy.save}
              </OnlineButton>
            </SheetContent>
          </Sheet>
        )}
      </div>
      {saved && canEdit && (
        <InlineNotice tone="success">{copy.saved}</InlineNotice>
      )}
      {!canEdit && (
        <p className="text-[15px] text-muted-foreground">
          {copy.closedNote} {contact ?? customerCopy.contactPhrase}
        </p>
      )}
    </section>
  )
}
