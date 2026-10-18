"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { RadioCardGroup } from "@/components/admin/radio-card"
import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { useAnnounce } from "@/components/shared/result-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatDayMonth, formatSessionDate } from "@/lib/time"

import { adminMoveBookingAction, previewAdminMoveAction } from "./actions"
import {
  moveRefusal,
  moveTargetOption,
  type AdminMovePlan,
  type MovePlan,
} from "./move-plan"

const copy = adminCopy.sessions.move
const sessionsCopy = adminCopy.sessions

type ReadyPlan = Extract<MovePlan, { ok: true }> & {
  cancelWindowHours?: number | null
}

// The dialog's warning: inside the window, and for a pinned booking what
// the move does to its funding.
function moveNotice(plan: ReadyPlan): React.ReactNode {
  const lines = [
    ...(plan.withinWindow
      ? [copy.withinWindow(plan.cancelWindowHours ?? null)]
      : []),
    ...(plan.funding === "pinned" || plan.funding === "credit"
      ? [copy.pinnedNote]
      : []),
  ]
  if (lines.length === 0) return undefined
  return lines.map((line, i) => (
    <span key={i} className="block">
      {line}
    </span>
  ))
}

// Tal moves one booking from "מי מגיעה" to another session (story 3.10,
// source section 6), also inside the self-cancel window. The row's button
// reads the plan (preview_admin_move_booking: the sessions it may move to),
// then the booking_move sensitive dialog shows who and from which session,
// the sessions as radio-cards (a session outside the credit's options says
// so; Tal may still choose it, user decision 2026-10-18), an optional
// reason and the required checkbox. No session: the reason under the
// button, no dialog. One key per opening and per change (AD-5). On success
// the dialog closes, the page is read again (the row leaves this session)
// and the result is announced above the list. A refusal closes the dialog,
// shows the reason under the button and reads the page again.
export function AttendeeMove({
  bookingId,
  name,
  conceptName,
  startsAt,
}: {
  bookingId: string
  name: string
  conceptName: string
  startsAt: string
}) {
  const router = useRouter()
  const announce = useAnnounce()
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<ReadyPlan | null>(null)
  const [key, setKey] = useState("")
  const [reason, setReason] = useState("")
  const [target, setTarget] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  async function open() {
    if (loading) return
    setLoading(true)
    setRowError(null)
    try {
      const result = await previewAdminMoveAction({ bookingId })
      const fresh: AdminMovePlan = result.ok
        ? result.data
        : { ok: false, code: result.code }
      if (!fresh.ok) {
        setRowError(moveRefusal(fresh.code))
        router.refresh()
        return
      }
      if (fresh.targets.length === 0) {
        setRowError(copy.empty)
        return
      }
      setKey(newIdempotencyKey())
      setReason("")
      setTarget(null)
      setPlan(fresh)
    } catch {
      setRowError(errorMessage("SERVER_ERROR"))
    } finally {
      setLoading(false)
    }
  }

  async function confirm() {
    if (pending || target === null) return
    const chosen = plan?.targets.find((t) => t.eventId === target)
    setPending(true)
    let code: ErrorCode
    try {
      const result = await adminMoveBookingAction({
        bookingId,
        targetEventId: target,
        reason,
        confirmed: true,
        idempotencyKey: key,
      })
      if (result.ok) {
        setPlan(null)
        announce?.(
          copy.done(name, chosen ? formatDayMonth(chosen.startsAt) : "")
        )
        router.refresh()
        return
      }
      code = result.code
    } catch {
      code = "SERVER_ERROR"
    } finally {
      setPending(false)
    }
    // A refusal: the dialog closes and the page is read again (AD-5: the
    // next try is a new plan with a new key).
    setPlan(null)
    setRowError(moveRefusal(code))
    router.refresh()
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        aria-label={copy.buttonLabel(name)}
        aria-busy={loading || undefined}
        onClick={open}
        className="h-11 border-foreground px-4 text-base"
      >
        {loading && <Spinner aria-hidden />}
        {copy.button}
      </Button>
      {rowError && (
        <InlineNotice tone="error" className="max-w-60">
          {rowError}
        </InlineNotice>
      )}
      {plan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !pending) setPlan(null)
          }}
          action="booking_move"
          description={copy.description}
          impact={[
            { label: copy.customer, value: <bdi>{name}</bdi> },
            {
              label: copy.from,
              value: (
                <>
                  <bdi>{sessionsCopy.sessionTitle(conceptName)}</bdi>
                  {" · "}
                  <time dateTime={startsAt}>{formatSessionDate(startsAt)}</time>
                </>
              ),
            },
          ]}
          choice={
            <RadioCardGroup
              legend={copy.targets}
              name={`admin-move-target-${bookingId}`}
              required
              value={target ?? ""}
              onChange={(value) => {
                setTarget(value)
                // A changed request is a new request (AD-5).
                setKey(newIdempotencyKey())
              }}
              options={plan.targets.map(moveTargetOption)}
            />
          }
          choiceMissing={target === null ? copy.choiceRequired : null}
          notice={moveNotice(plan)}
          reason={{
            label: copy.reason,
            value: reason,
            onChange: (value) => {
              setReason(value)
              // A changed request is a new request (AD-5).
              setKey(newIdempotencyKey())
            },
          }}
          checkboxLabel={copy.checkbox(name)}
          confirmLabel={copy.confirm}
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}
