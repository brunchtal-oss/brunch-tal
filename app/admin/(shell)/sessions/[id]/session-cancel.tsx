"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { useAnnounce } from "@/components/shared/result-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatSessionDate } from "@/lib/time"

import { adminCancelEventAction, previewCancelEventAction } from "./actions"
import { AtRiskList } from "./at-risk-list"
import type { CancelEventPlan } from "./event-plan"

const copy = adminCopy.sessions.cancelEvent
const sessionsCopy = adminCopy.sessions
const MESSAGE_MAX = 1000

type ReadyPlan = Extract<CancelEventPlan, { ok: true }>

export function eventRefusal(code: ErrorCode): string {
  return sessionsCopy.eventRefusal[code] ?? errorMessage(code)
}

// A refusal of the time change: INVALID_INPUT by the plan's field, any
// other code as eventRefusal.
export function rescheduleRefusal(
  code: ErrorCode,
  field: string | null
): string {
  if (code === "INVALID_INPUT" && field) {
    const text = adminCopy.sessions.reschedule.refusal[field]
    if (text) return text
  }
  return eventRefusal(code)
}

// The impact rows of the cancel dialog: the session, the bookings and
// places, then one row per outcome that has bookings (an entry back to its
// card, a refund-or-credit choice, a place held for a new customer).
export function cancelImpactRows(
  plan: ReadyPlan,
  conceptName: string,
  startsAt: string
) {
  return [
    {
      label: copy.session,
      value: (
        <>
          <bdi>{sessionsCopy.sessionTitle(conceptName)}</bdi>
          {" · "}
          <time dateTime={startsAt}>{formatSessionDate(startsAt)}</time>
        </>
      ),
    },
    {
      label: copy.bookings,
      value: copy.bookingsValue(plan.bookingCount, plan.places),
    },
    ...(plan.cardCount > 0
      ? [{ label: copy.cards, value: String(plan.cardCount) }]
      : []),
    ...(plan.choiceCount > 0
      ? [{ label: copy.choices, value: String(plan.choiceCount) }]
      : []),
    ...(plan.unboundCount > 0
      ? [{ label: copy.unbound, value: String(plan.unboundCount) }]
      : []),
  ]
}

// "ביטול מפגש" on the session's details (story 3.8, CAP-12, sensitive). The
// button reads the plan (preview_admin_cancel_event); the event_cancel
// dialog shows its impact, the customers at risk of an unusable card, and
// the notice's body prefilled from its template (Tal edits it, 1-1000; the
// title stays the template's). One key per opening and per change (AD-5).
// On success the page is read again (the session shows "בוטל") and the
// result is announced. A refusal closes the dialog and shows the reason
// under the button.
export function SessionCancel({
  eventId,
  conceptName,
  startsAt,
}: {
  eventId: string
  conceptName: string
  startsAt: string
}) {
  const router = useRouter()
  const announce = useAnnounce()
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<ReadyPlan | null>(null)
  const [key, setKey] = useState("")
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)

  async function open() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await previewCancelEventAction({ eventId })
      const fresh: CancelEventPlan = result.ok
        ? result.data
        : { ok: false, code: result.code, field: null }
      if (!fresh.ok) {
        // No refresh: the page would unmount this button and its error.
        setError(fresh.code)
        return
      }
      setKey(newIdempotencyKey())
      setMessage(fresh.body)
      setPlan(fresh)
    } catch {
      setError("SERVER_ERROR")
    } finally {
      setLoading(false)
    }
  }

  async function confirm() {
    if (pending) return
    setPending(true)
    let code: ErrorCode
    try {
      const result = await adminCancelEventAction({
        eventId,
        message,
        confirmed: true,
        parkedAcknowledged: (plan?.parked.length ?? 0) > 0,
        idempotencyKey: key,
      })
      if (result.ok) {
        setPlan(null)
        announce?.(copy.done(result.data.notified))
        router.refresh()
        return
      }
      code = result.code
    } catch {
      code = "SERVER_ERROR"
    } finally {
      setPending(false)
    }
    // A refusal: the dialog closes and the reason stays under the button
    // (no refresh, which would unmount it); the next try reads a new plan
    // with a new key (AD-5).
    setPlan(null)
    setError(code)
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="destructive"
        size="lg"
        aria-busy={loading || undefined}
        onClick={open}
        className="h-11 self-start bg-error px-4 text-base font-semibold text-primary-foreground"
      >
        {loading && <Spinner aria-hidden />}
        {copy.button}
      </Button>
      {error && <InlineNotice tone="error">{eventRefusal(error)}</InlineNotice>}
      {plan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !pending) setPlan(null)
          }}
          action="event_cancel"
          description={copy.description}
          impact={cancelImpactRows(plan, conceptName, startsAt)}
          notice={
            plan.atRisk.length > 0 || plan.parked.length > 0 ? (
              <div className="flex flex-col gap-3">
                {plan.parked.map((parked) => (
                  <p key={parked.paymentId}>
                    <bdi>{copy.parked(parked.customerLabel)}</bdi>
                  </p>
                ))}
                {plan.atRisk.length > 0 && (
                  <AtRiskList
                    title={sessionsCopy.atRisk.cancelTitle(plan.atRisk.length)}
                    cards={plan.atRisk}
                  />
                )}
              </div>
            ) : undefined
          }
          message={{
            label: sessionsCopy.eventNotice.label,
            hint: <bdi>{sessionsCopy.eventNotice.title(plan.title)}</bdi>,
            value: message,
            maxLength: MESSAGE_MAX,
            onChange: (value) => {
              setMessage(value)
              // A changed request is a new request (AD-5).
              setKey(newIdempotencyKey())
            },
          }}
          choiceMissing={
            message.trim() === "" ? sessionsCopy.eventNotice.required : null
          }
          checkboxLabel={copy.checkbox}
          secondCheckboxLabel={
            plan.parked.length > 0 ? copy.parkedCheckbox : undefined
          }
          confirmLabel={copy.confirm}
          destructive
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}
