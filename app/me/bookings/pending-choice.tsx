"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { XIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { useAnnounce } from "@/components/shared/result-notice"
import { StatusChip } from "@/components/shared/status-chip"
import { OnlineButton } from "@/components/shared/online-button"
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
import { formatDayMonth } from "@/lib/time"

import { chooseCreditOutcomeAction } from "./actions"
import { PinnedCancelChoice } from "./cancel-booking"
import type { CancelChoice } from "./cancel-result"

const copy = customerCopy.pendingChoice

// The business cancelled her session (story 3.8, user decision 2026-10-10):
// a card at the top of home and of her bookings, the chip "ממתינה לבחירה
// שלך", the title with the cancelled session's date, one line and
// "לבחירה". The button opens a bottom-sheet with the cancel's two options
// (a credit for one of the next N sessions, or a refund) and "לאישור
// הבחירה", which waits for a choice. No deadline. On success the result is
// announced (through the page's ResultNoticeHost) and the page is read
// again: the card becomes the credit or the refund card. A refusal stays
// in the sheet (the page is not read again); a new key per opening, per change and after a failure
// (AD-5).
export function PendingChoiceCard({
  creditId,
  startsAt,
  optionsCount,
}: {
  creditId: string
  // The cancelled session's start (its DD.MM is in the title).
  startsAt: string
  optionsCount: number
}) {
  const router = useRouter()
  const announce = useAnnounce()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [choice, setChoice] = useState<CancelChoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const id = `pending-${creditId}`
  const title = copy.title(formatDayMonth(startsAt))

  if (done) {
    return <InlineNotice tone="success">{done}</InlineNotice>
  }

  async function confirm() {
    if (busy || choice === null) return
    setBusy(true)
    setError(null)
    try {
      const result = await chooseCreditOutcomeAction({
        creditId,
        choice,
        idempotencyKey: key,
      })
      if (result.ok) {
        const message =
          result.data.outcome === "refund" ? copy.doneRefund : copy.doneCredit
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
    // A failure: the error stays in the sheet (no refresh, which would
    // unmount the card); the next try is a new request (AD-5).
    setKey(newIdempotencyKey())
  }

  return (
    <section
      aria-labelledby={id}
      className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4"
    >
      <StatusChip tone="pending">{copy.chip}</StatusChip>
      <h2
        id={id}
        className="font-heading text-[22px] leading-[1.25] font-light"
      >
        <time dateTime={startsAt}>
          <bdi>{title}</bdi>
        </time>
      </h2>
      <p className="text-[15px]">{copy.text}</p>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next)
        }}
      >
        <Button
          type="button"
          size="lg"
          onClick={() => {
            setKey(newIdempotencyKey())
            setError(null)
            setChoice(null)
            setOpen(true)
          }}
          className="h-12 w-full max-w-xs rounded-[4px] text-base font-semibold"
        >
          {copy.button}
        </Button>
        <SheetContent
          side="bottom"
          showCloseButton={false}
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
              <bdi>{title}</bdi>
            </SheetTitle>
            <SheetClose
              aria-label={customerCopy.close}
              className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
            >
              <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
            </SheetClose>
          </div>
          <p className="mt-1 text-[15px]">{copy.text}</p>
          <PinnedCancelChoice
            bookingId={creditId}
            optionsCount={optionsCount}
            choice={choice}
            onChoose={(value) => {
              setChoice(value)
              // A changed request is a new request (AD-5).
              setKey(newIdempotencyKey())
            }}
          />
          {error && (
            <InlineNotice tone="error" className="mt-4">
              {errorMessage(error)}
            </InlineNotice>
          )}
          <OnlineButton
            type="button"
            size="lg"
            onClick={confirm}
            disabled={choice === null}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
            className="mt-6 h-12 w-full rounded-[4px] text-base font-semibold"
          >
            {busy && <Spinner aria-hidden />}
            {copy.confirm}
          </OnlineButton>
        </SheetContent>
      </Sheet>
    </section>
  )
}
