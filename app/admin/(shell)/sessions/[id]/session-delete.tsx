"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { buttonClass } from "@/components/shared/button-class"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import type { ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatSessionDate } from "@/lib/time"

import { adminDeleteEventAction, previewDeleteEventAction } from "./actions"
import type { DeleteEventPlan } from "./event-plan"
import { CANCEL_ANCHOR, eventRefusal } from "./session-cancel"

const copy = adminCopy.sessions.deleteEvent
const sessionsCopy = adminCopy.sessions

type ReadyPlan = Extract<DeleteEventPlan, { ok: true }>

// The impact rows of the delete dialog: the session, then one row per
// work sheet count above 0. The credits are a notice of their own.
export function deleteImpactRows(
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
    ...(plan.dishCount > 0
      ? [{ label: copy.dishes, value: String(plan.dishCount) }]
      : []),
    ...(plan.taskCount > 0
      ? [{ label: copy.tasks, value: String(plan.taskCount) }]
      : []),
    ...(plan.shoppingCount > 0
      ? [{ label: copy.shopping, value: String(plan.shoppingCount) }]
      : []),
  ]
}

// The full-width notice when the session is a credit alternative: what it
// is, then how many customers get another one. null without credits.
export function creditsNotice(creditCount: number) {
  if (creditCount <= 0) return null
  return (
    <>
      <span className="block">{copy.creditsNotice}</span>
      <span className="block">{copy.creditsCustomers(creditCount)}</span>
    </>
  )
}

// Whether a refusal offers the session's cancel instead: a session with
// bookings that can still be cancelled (published, not started; the same
// test that shows the cancel on the details page).
export function offersCancel(code: ErrorCode, cancellable: boolean): boolean {
  return code === "EVENT_HAS_BOOKINGS" && cancellable
}

// "מחיקת מפגש" (story 3.17, sensitive). The button reads the plan
// (preview_admin_delete_event); a refusal shows its reason in an
// inline-notice under the button (for a session with bookings that can
// still be cancelled, with the way to its cancel), otherwise the event_delete dialog shows what
// goes with it. One key per opening (AD-5). On success: the sessions list
// with "המפגש נמחק.". Shown for every status: the refusal explains.
export function SessionDelete({
  eventId,
  conceptName,
  startsAt,
  cancellable,
}: {
  eventId: string
  conceptName: string
  startsAt: string
  // Published and not started: the refusal may link to the cancel.
  cancellable: boolean
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<ReadyPlan | null>(null)
  const [key, setKey] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)

  async function open() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await previewDeleteEventAction({ eventId })
      const fresh: DeleteEventPlan = result.ok
        ? result.data
        : { ok: false, code: result.code, field: null }
      if (!fresh.ok) {
        setError(fresh.code)
        return
      }
      setKey(newIdempotencyKey())
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
      const result = await adminDeleteEventAction({
        eventId,
        confirmed: true,
        idempotencyKey: key,
      })
      if (result.ok) {
        // The dialog stays busy until the list replaces this page.
        router.push("/admin/sessions?deleted=1")
        return
      }
      code = result.code
    } catch {
      code = "SERVER_ERROR"
    }
    setPending(false)
    // A refusal: the dialog closes and the reason stays under the button;
    // the next try reads a new plan with a new key (AD-5).
    setPlan(null)
    setError(code)
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        aria-busy={loading || undefined}
        onClick={open}
        className="h-11 self-start border-error px-4 text-base font-semibold text-error"
      >
        {loading && <Spinner aria-hidden />}
        {copy.button}
      </Button>
      {error && (
        <InlineNotice
          tone="error"
          actions={
            offersCancel(error, cancellable) ? (
              // A plain link: on the details page the hash changes (the
              // cancel opens on hashchange); from the editor the page loads
              // with it (the cancel opens on load).
              <a
                href={`/admin/sessions/${eventId}#${CANCEL_ANCHOR}`}
                className={buttonClass({
                  variant: "outline",
                  size: "lg",
                  className:
                    "h-11 rounded-lg border-foreground px-4 text-base font-semibold",
                })}
              >
                {copy.cancelLink}
              </a>
            ) : undefined
          }
        >
          {eventRefusal(error)}
        </InlineNotice>
      )}
      {plan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !pending) setPlan(null)
          }}
          action="event_delete"
          description={copy.description}
          impact={deleteImpactRows(plan, conceptName, startsAt)}
          notice={creditsNotice(plan.creditCount) ?? undefined}
          noticeAlign="start"
          checkboxLabel={copy.checkbox}
          confirmLabel={copy.confirm}
          destructive
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}
