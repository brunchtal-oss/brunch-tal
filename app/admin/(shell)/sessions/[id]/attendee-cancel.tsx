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

import { adminCancelBookingAction, previewAdminCancelAction } from "./actions"
import { cancelReturnsText, type CancelPlan } from "./cancel-plan"

const copy = adminCopy.sessions.cancel
const sessionsCopy = adminCopy.sessions

type ReadyPlan = Extract<CancelPlan, { ok: true }>

function refusal(code: ErrorCode): string {
  return sessionsCopy.cancelRefusal[code] ?? errorMessage(code)
}

// Tal cancels one booking from "מי מגיעה" (story 3.6, CAP-17), also inside
// the self-cancel window and a place held for a new customer (AD-23). The
// row's button reads the plan (preview_admin_cancel_booking), then the
// booking_cancel sensitive dialog shows its impact (who, which session,
// what returns), an optional reason and the required checkbox. One key per
// opening of the dialog (AD-5). On success the dialog closes, the page is
// read again (the row leaves the list, the places go down) and the result
// is announced above the list. A refusal (of the plan or of the cancel)
// closes the dialog, shows the reason under the button and reads the page
// again, so neither the plan nor the list stays stale; the next try reads
// a new plan with a new key.
export function AttendeeCancel({
  bookingId,
  name,
  conceptName,
  startsAt,
}: {
  bookingId: string
  // The row's title (the customer's name, or "new customer").
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
  const [pending, setPending] = useState(false)
  const [rowError, setRowError] = useState<ErrorCode | null>(null)

  async function open() {
    if (loading) return
    setLoading(true)
    setRowError(null)
    try {
      const result = await previewAdminCancelAction({ bookingId })
      const fresh: CancelPlan = result.ok
        ? result.data
        : { ok: false, code: result.code }
      if (!fresh.ok) {
        setRowError(fresh.code)
        router.refresh()
        return
      }
      setKey(newIdempotencyKey())
      setReason("")
      setPlan(fresh)
    } catch {
      setRowError("SERVER_ERROR")
    } finally {
      setLoading(false)
    }
  }

  async function confirm() {
    if (pending) return
    setPending(true)
    let code: ErrorCode
    try {
      const result = await adminCancelBookingAction({
        bookingId,
        reason,
        confirmed: true,
        idempotencyKey: key,
      })
      if (result.ok) {
        setPlan(null)
        announce?.(copy.done(name))
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
    setRowError(code)
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
          {refusal(rowError)}
        </InlineNotice>
      )}
      {plan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !pending) setPlan(null)
          }}
          action="booking_cancel"
          description={
            plan.pendingJoin ? copy.descriptionNoCustomer : copy.description
          }
          impact={[
            { label: copy.customer, value: <bdi>{name}</bdi> },
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
              label: copy.returns,
              value: <bdi>{cancelReturnsText(plan)}</bdi>,
            },
          ]}
          notice={plan.withinWindow ? copy.withinWindow : undefined}
          reason={{ label: copy.reason, value: reason, onChange: setReason }}
          checkboxLabel={copy.checkbox(name)}
          confirmLabel={copy.confirm}
          destructive
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}
