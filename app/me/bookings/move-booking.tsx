"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { XIcon } from "lucide-react"

import { RadioCardGroup } from "@/components/admin/radio-card"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { customerCopy } from "@/lib/copy/customer"
import { type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatSessionDateTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { moveBookingAction, previewMoveBookingAction } from "./actions"
import {
  moveConfirmBlocked,
  moveErrorText,
  moveNeedsContact,
  moveTapAction,
  type MovePlan,
  type MoveTarget,
} from "./move-result"

const copy = customerCopy.move
const LINK = "font-semibold underline underline-offset-[3px]"

type ReadyPlan = Extract<MovePlan, { ok: true }>

export type MoveBookingProps = {
  bookingId: string
  // "בראנץ׳ {concept}" of the session she is booked to.
  title: string
  startsAt: string
  // From the server (private.can_self_cancel); never computed here.
  canSelfCancel: boolean
  // The booking's cancel window in hours (policy_snapshot), for a refusal
  // past it; null when it cannot be read.
  cancelWindowHours: number | null
  // Past the self-cancel window: the caller shows the shared closed notice
  // (the same one as the cancel's), and no RPC is called.
  onClosed: () => void
  contactHref: string | null
  className?: string
}

// Moving her booking to another session (story 3.10), on the session page
// only, next to the cancel (user decision 2026-10-18). Inside the
// self-cancel window: "הזזה למועד אחר" reads the sessions she may move to
// (preview_move_booking), then a bottom-sheet "לאיזה מפגש לעבור?" lists
// them as radio-cards (date and time, the concept); "כן, להזיז" stays
// disabled until one is chosen. A pinned booking adds the line that a later
// cancel returns a credit, not money. No session: the empty line. Past the
// window the button only calls onClosed. On success: the new session's page
// with "ההרשמה הועברה ל-{date}" (?moved=1). A refusal stays in the sheet
// with the reason and the line that her booking did not change. No
// optimistic result; one idempotency key per opening of the sheet and per
// change of the chosen session (AD-5).
export function MoveBooking({
  bookingId,
  title,
  startsAt,
  canSelfCancel,
  cancelWindowHours,
  onClosed,
  contactHref,
  className,
}: MoveBookingProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<ReadyPlan | null>(null)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [loadError, setLoadError] = useState<ErrorCode | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  async function start() {
    if (loading) return
    if (moveTapAction(canSelfCancel) === "closed") {
      onClosed()
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const result = await previewMoveBookingAction({ bookingId })
      const fresh: MovePlan = result.ok
        ? result.data
        : { ok: false, code: result.code }
      if (!fresh.ok) {
        setLoadError(fresh.code)
        router.refresh()
        return
      }
      if (!fresh.canMove) {
        onClosed()
        router.refresh()
        return
      }
      setPlan(fresh)
      setKey(newIdempotencyKey())
      setTarget(null)
      setError(null)
      setOpen(true)
    } catch {
      setLoadError("SERVER_ERROR")
    } finally {
      setLoading(false)
    }
  }

  async function confirm() {
    if (busy || target === null) return
    setBusy(true)
    setError(null)
    try {
      const result = await moveBookingAction({
        bookingId,
        targetEventId: target,
        idempotencyKey: key,
      })
      if (result.ok) {
        // The sheet stays busy until the new page replaces this one.
        router.push(`/me/sessions/${target}?moved=1`)
        return
      }
      setError(result.code)
    } catch {
      setError("SERVER_ERROR")
    }
    // A failure: the next try is a new request (AD-5), the sessions are
    // read again and the choice is cleared; the reason stays.
    setKey(newIdempotencyKey())
    setTarget(null)
    try {
      const again = await previewMoveBookingAction({ bookingId })
      if (again.ok && again.data.ok) setPlan(again.data)
    } catch {
      // The reason is already shown; the old list stays without a choice.
    }
    setBusy(false)
    router.refresh()
  }

  const contact = moveNeedsContact(error) || moveNeedsContact(loadError)

  const contactLink = contactHref ? (
    <a
      href={contactHref}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(LINK, "py-3")}
    >
      {customerCopy.closedContact}
    </a>
  ) : undefined

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          // The sheet stays open while the move is on its way.
          if (!busy) setOpen(next)
        }}
      >
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={start}
          aria-busy={loading || undefined}
          className={cn(
            "h-12 w-full max-w-xs rounded-[4px] border-foreground text-base",
            className
          )}
        >
          {loading && <Spinner aria-hidden />}
          {copy.button}
        </Button>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          data-move-sheet=""
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
              {copy.title}
            </SheetTitle>
            <SheetClose
              aria-label={customerCopy.close}
              className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
            >
              <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
            </SheetClose>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted px-4 py-3 text-[15px]">
            <dt className="text-muted-foreground">{copy.from}</dt>
            <dd className="font-semibold">
              <bdi>{title}</bdi>
              <br />
              <time dateTime={startsAt}>{formatSessionDateTime(startsAt)}</time>
            </dd>
          </dl>
          {plan && plan.targets.length === 0 ? (
            <p className="mt-4 text-[17px]">{copy.empty}</p>
          ) : (
            plan && (
              <MoveTargetChoice
                name={`move-target-${bookingId}`}
                targets={plan.targets}
                value={target}
                onChoose={(value) => {
                  setTarget(value)
                  // A changed request is a new request (AD-5).
                  setKey(newIdempotencyKey())
                }}
              />
            )
          )}
          {plan?.funding === "pinned" && plan.targets.length > 0 && (
            <p className="mt-3 text-[15px] text-muted-foreground">
              {copy.pinnedNote}
            </p>
          )}
          {error && (
            <InlineNotice
              tone="error"
              className="mt-4"
              actions={contact ? contactLink : undefined}
            >
              {moveErrorText(error, cancelWindowHours)}
              <br />
              {copy.unchanged}
            </InlineNotice>
          )}
          {plan && plan.targets.length > 0 && (
            <Button
              type="button"
              size="lg"
              onClick={confirm}
              disabled={moveConfirmBlocked(target)}
              aria-busy={busy || undefined}
              aria-disabled={busy || undefined}
              className="mt-6 h-12 w-full rounded-[4px] text-base font-semibold"
            >
              {busy && <Spinner aria-hidden />}
              {copy.confirm}
            </Button>
          )}
        </SheetContent>
      </Sheet>
      {loadError && (
        <InlineNotice
          tone="error"
          className="w-full"
          actions={contact ? contactLink : undefined}
        >
          {moveErrorText(loadError, cancelWindowHours)}
        </InlineNotice>
      )}
    </>
  )
}

// The sessions she may move to, as radio-cards: the date and time, and the
// concept under it.
export function MoveTargetChoice({
  name,
  targets,
  value,
  onChoose,
}: {
  name: string
  targets: readonly MoveTarget[]
  value: string | null
  onChoose: (eventId: string) => void
}) {
  return (
    <RadioCardGroup
      className="mt-4"
      legend={copy.targets}
      name={name}
      required
      value={value ?? ""}
      onChange={onChoose}
      options={targets.map((t) => ({
        value: t.eventId,
        label: formatSessionDateTime(t.startsAt),
        description: customerCopy.sessionTitle(t.conceptName),
      }))}
    />
  )
}
