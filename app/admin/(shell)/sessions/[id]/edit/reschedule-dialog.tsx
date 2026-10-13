"use client"

import { useEffect, useState } from "react"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { adminCopy } from "@/lib/copy/admin"
import type { ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatSessionDateTime, formatTime } from "@/lib/time"

import {
  adminRescheduleEventAction,
  previewRescheduleEventAction,
} from "../actions"
import { AtRiskList } from "../at-risk-list"
import type { RescheduleEventPlan } from "../event-plan"

const copy = adminCopy.sessions.reschedule
const sessionsCopy = adminCopy.sessions
const MESSAGE_MAX = 1000

type ReadyPlan = Extract<RescheduleEventPlan, { ok: true }>

export type NewWhen = { date: string; startTime: string; endTime: string }

// "יום שני 12.10 · 10:30–12:30"
export function whenText(startsAt: string, endsAt: string): string {
  return `${formatSessionDateTime(startsAt)}–${formatTime(endsAt)}`
}

export function rescheduleImpactRows(plan: ReadyPlan) {
  return [
    {
      label: copy.from,
      value: (
        <time dateTime={plan.startsAt}>
          {whenText(plan.startsAt, plan.endsAt)}
        </time>
      ),
    },
    {
      label: copy.to,
      value: (
        <time dateTime={plan.newStartsAt}>
          {whenText(plan.newStartsAt, plan.newEndsAt)}
        </time>
      ),
    },
    { label: copy.bookings, value: String(plan.bookingCount) },
  ]
}

// The time change of a session with bookings (story 3.8, CAP-12; a
// session is never moved silently). The editor's "when" row opens it when
// a plain save answers EVENT_HAS_BOOKINGS. It reads the plan
// (preview_admin_reschedule_event) for the new date and times; the
// event_reschedule dialog shows the old and new time, the bookings, the
// cards not valid on the new day (a warning, never blocking) and the
// notice's body prefilled from its template. onDone(notified) after a
// success, onRefused(code) when the plan or the change is refused,
// onClose when Tal closes it.
export function RescheduleDialog({
  eventId,
  when,
  onDone,
  onRefused,
  onClose,
}: {
  eventId: string
  when: NewWhen
  onDone: (notified: number) => void
  // field: the plan's refused field (INVALID_INPUT), else null.
  onRefused: (code: ErrorCode, field: string | null) => void
  onClose: () => void
}) {
  const [plan, setPlan] = useState<ReadyPlan | null>(null)
  const [key, setKey] = useState("")
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let live = true
    previewRescheduleEventAction({ eventId, ...when })
      .then((result) => {
        if (!live) return
        const fresh: RescheduleEventPlan = result.ok
          ? result.data
          : { ok: false, code: result.code, field: null }
        if (!fresh.ok) {
          onRefused(fresh.code, fresh.field)
          return
        }
        setKey(newIdempotencyKey())
        setMessage(fresh.body)
        setPlan(fresh)
      })
      .catch(() => {
        if (live) onRefused("SERVER_ERROR", null)
      })
    return () => {
      live = false
    }
    // One plan per opening (the parent remounts it for a new time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function confirm() {
    if (pending) return
    setPending(true)
    let code: ErrorCode
    let field: string | null = null
    try {
      const result = await adminRescheduleEventAction({
        eventId,
        ...when,
        message,
        confirmed: true,
        idempotencyKey: key,
      })
      if (result.ok) {
        onDone(result.data.notified)
        return
      }
      code = result.code
      field = result.detail?.field ?? null
    } catch {
      code = "SERVER_ERROR"
    } finally {
      setPending(false)
    }
    onRefused(code, field)
  }

  if (!plan) return null

  return (
    <SensitiveConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
      action="event_reschedule"
      description={copy.description}
      impact={rescheduleImpactRows(plan)}
      notice={
        plan.atRisk.length > 0 ? (
          <AtRiskList
            title={sessionsCopy.atRisk.rescheduleTitle(plan.atRisk.length)}
            cards={plan.atRisk}
          />
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
      confirmLabel={copy.confirm}
      pending={pending}
      onConfirm={confirm}
    />
  )
}
