"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { XIcon } from "lucide-react"

import { RadioCardGroup } from "@/components/admin/radio-card"
import { InlineNotice } from "@/components/shared/inline-notice"
import { useAnnounce } from "@/components/shared/result-notice"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { customerCopy } from "@/lib/copy/customer"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatSessionDateTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { cancelBookingAction } from "./actions"
import {
  cancelDoneMessage,
  returnsText,
  type CancelChoice,
  type Funding,
} from "./cancel-result"

const copy = customerCopy.cancel
const LINK = "font-semibold underline underline-offset-[3px]"

export type CancelBookingProps = {
  bookingId: string
  // "בראנץ׳ {concept}", the sheet's title.
  title: string
  startsAt: string
  funding: Funding
  productName: string
  optionsCount: number
  // From the server (private.can_self_cancel); never computed here.
  canSelfCancel: boolean
  // The booking's cancel window in hours (policy_snapshot), for the notice
  // past it; null when it cannot be read.
  cancelWindowHours: number | null
  contactHref: string | null
  className?: string
}

// The cancel action of one booking (stories 3.6, 3.7), only on the session page
// (user decision 2026-10-06: not on home and not in /me/bookings). Inside
// the self-cancel window: "ביטול ההרשמה" opens a bottom-sheet that says
// what returns and where, with one confirm ("כן, לבטל"). A pinned booking
// (single, intro, couple) shows the choice instead, as radio-cards: a
// credit for one of the next N sessions, or a refund; "כן, לבטל" stays
// disabled until one is chosen (story 3.7). Past it the same
// button is shown, and only a tap on it shows the inline-notice "לא ניתן
// לבטל עצמאית פחות מ-{n} שעות לפני המפגש." with the contact phrase (no
// "Tal"): no call to action in view unless she asked to cancel. The
// result is an inline-notice (through the page's ResultNoticeHost when
// there is one, since this row leaves the list); no optimistic result, the
// button is busy until the server answers, and a new idempotency key on
// each opening of the sheet and after a failure (AD-5).
export function CancelBooking({
  bookingId,
  title,
  startsAt,
  funding,
  productName,
  optionsCount,
  canSelfCancel,
  cancelWindowHours,
  contactHref,
  className,
}: CancelBookingProps) {
  const router = useRouter()
  const announce = useAnnounce()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  // A pinned booking: refund or credit, chosen in the sheet (story 3.7).
  const [choice, setChoice] = useState<CancelChoice | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // Past the self-cancel window the same button only shows why it cannot
  // cancel, and the contact phrase (user decision 2026-10-06).
  const [closedShown, setClosedShown] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)

  if (done) {
    return (
      <InlineNotice tone="success" className={className}>
        {done}
      </InlineNotice>
    )
  }

  const needsChoice = funding === "pinned"
  const returns = returnsText(funding, productName)

  async function confirm() {
    if (busy || confirmBlocked(funding, choice)) return
    setBusy(true)
    setError(null)
    try {
      const result = await cancelBookingAction({
        bookingId,
        idempotencyKey: key,
        choice: needsChoice ? choice : null,
      })
      if (result.ok) {
        const message = cancelDoneMessage(result.data)
        setOpen(false)
        if (announce) announce(message)
        else setDone(message)
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
    router.refresh()
  }

  const contact =
    error === "SELF_CANCEL_CLOSED" || error === "MANUAL_HANDLING_REQUIRED"

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          // The sheet stays open while the cancel is on its way.
          if (!busy) setOpen(next)
        }}
      >
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => {
            if (!canSelfCancel) {
              setClosedShown(true)
              return
            }
            setKey(newIdempotencyKey())
            setError(null)
            setChoice(null)
            setOpen(true)
          }}
          className={cn(
            "h-12 w-full max-w-xs rounded-[4px] border-foreground text-base",
            className
          )}
        >
          {copy.button}
        </Button>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          data-cancel-sheet=""
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
              {copy.button} · <bdi>{title}</bdi>
            </SheetTitle>
            <SheetClose
              aria-label={customerCopy.close}
              className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
            >
              <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
            </SheetClose>
          </div>
          <p className="mt-1 font-semibold">
            <time dateTime={startsAt}>{formatSessionDateTime(startsAt)}</time>
          </p>
          {needsChoice ? (
            <PinnedCancelChoice
              bookingId={bookingId}
              optionsCount={optionsCount}
              choice={choice}
              onChoose={(value) => {
                setChoice(value)
                // A changed request is a new request (AD-5).
                setKey(newIdempotencyKey())
              }}
            />
          ) : (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted px-4 py-3 text-[15px]">
              <dt className="text-muted-foreground">{copy.returns}</dt>
              <dd className="font-semibold">
                <bdi>{returns}</bdi>
              </dd>
            </dl>
          )}
          {error && (
            <InlineNotice
              tone="error"
              className="mt-4"
              actions={
                contact && contactHref ? (
                  <a
                    href={contactHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(LINK, "py-3")}
                  >
                    {customerCopy.contactPhrase}
                  </a>
                ) : undefined
              }
            >
              {errorMessage(error)}
            </InlineNotice>
          )}
          <Button
            type="button"
            size="lg"
            onClick={confirm}
            // "כן, לבטל" waits for the choice of a pinned booking (3.7).
            disabled={confirmBlocked(funding, choice)}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
            className="mt-6 h-12 w-full rounded-[4px] text-base font-semibold"
          >
            {busy && <Spinner aria-hidden />}
            {copy.confirm}
          </Button>
        </SheetContent>
      </Sheet>
      {closedShown && (
        <InlineNotice
          tone="info"
          className="w-full"
          actions={
            contactHref ? (
              <a
                href={contactHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(LINK, "py-3")}
              >
                {customerCopy.contactPhrase}
              </a>
            ) : undefined
          }
        >
          {copy.closed(cancelWindowHours)}
        </InlineNotice>
      )}
    </>
  )
}

/** "כן, לבטל" waits for the choice of a pinned booking (story 3.7). */
export function confirmBlocked(
  funding: Funding,
  choice: CancelChoice | null
): boolean {
  return funding === "pinned" && choice === null
}

// The choice of a pinned booking (story 3.7), as radio-cards: a credit for
// one of the next N sessions, or a refund, each with its line.
export function PinnedCancelChoice({
  bookingId,
  optionsCount,
  choice,
  onChoose,
}: {
  bookingId: string
  optionsCount: number
  choice: CancelChoice | null
  onChoose: (choice: CancelChoice) => void
}) {
  return (
    <RadioCardGroup
      className="mt-4"
      legend={copy.returns}
      name={`cancel-choice-${bookingId}`}
      required
      value={choice ?? ""}
      onChange={(value) => onChoose(value === "refund" ? "refund" : "credit")}
      options={[
        {
          value: "credit",
          label: copy.choiceCredit,
          description: copy.choiceCreditNote(optionsCount),
        },
        {
          value: "refund",
          label: copy.choiceRefund,
          description: copy.choiceRefundNote,
        },
      ]}
    />
  )
}
