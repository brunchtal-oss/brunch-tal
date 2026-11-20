"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { useAnnounce } from "@/components/shared/result-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ActionResult, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatAgorot } from "@/lib/money"
import { formatSessionDate } from "@/lib/time"

import type { AttentionAction } from "../home-items"
import {
  closeUnconfirmedCheckoutAction,
  markCorrectionHandledAction,
  previewSettleParkedAction,
  resolveOnlinePaymentIssueAction,
  settleParkedAction,
} from "./actions"
import type { SettlePlan } from "./attention-plans"

const items = adminCopy.home.items
const BUTTON = "h-11 border-foreground bg-transparent px-4 text-base"

// The button under a "לטיפול" row (story 3.13). It sits above the row's
// link (relative z-10), so pressing it never opens the row.
export function AttentionActionButton({ action }: { action: AttentionAction }) {
  switch (action.kind) {
    case "handled":
      return <HandledButton bookingId={action.bookingId} name={action.name} />
    case "settle":
      return (
        <SettleButton entitlementId={action.entitlementId} name={action.name} />
      )
    case "resolve_issue":
      return (
        <OnlinePaymentButton
          label={items.online_payment_issue.resolve}
          ariaLabel={items.online_payment_issue.resolveFor(action.name)}
          done={items.online_payment_issue.resolveDone}
          run={(idempotencyKey) =>
            resolveOnlinePaymentIssueAction({
              issueId: action.issueId,
              idempotencyKey,
            })
          }
        />
      )
    case "close_checkout":
      return (
        <OnlinePaymentButton
          label={items.online_payment_unconfirmed.close}
          ariaLabel={items.online_payment_unconfirmed.closeFor(action.name)}
          done={items.online_payment_unconfirmed.closeDone}
          run={(idempotencyKey) =>
            closeUnconfirmedCheckoutAction({
              checkoutId: action.checkoutId,
              idempotencyKey,
            })
          }
        />
      )
  }
}

// Online payments (PR B): "סימון כטופל" on an issue and "סגירה" on an
// unconfirmed checkout, like "טופל": one tap, the item leaves the list. One
// idempotency key per button; a failure makes the next tap a new request.
function OnlinePaymentButton({
  label,
  ariaLabel,
  done,
  run,
}: {
  label: string
  ariaLabel: string
  done: string
  run: (idempotencyKey: string) => Promise<ActionResult>
}) {
  const router = useRouter()
  const announce = useAnnounce()
  const [key, setKey] = useState(newIdempotencyKey)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)

  async function press() {
    if (pending) return
    setPending(true)
    setError(null)
    let code: ErrorCode
    try {
      const result = await run(key)
      if (result.ok) {
        announce?.(done)
        router.refresh()
        return
      }
      code = result.code
    } catch {
      code = "SERVER_ERROR"
    } finally {
      setPending(false)
    }
    setError(code)
    setKey(newIdempotencyKey())
  }

  return (
    <div className="relative z-10 flex flex-col items-start gap-2 pt-1">
      <OnlineButton
        type="button"
        variant="outline"
        size="lg"
        aria-label={ariaLabel}
        aria-busy={pending || undefined}
        onClick={press}
        className={BUTTON}
      >
        {pending && <Spinner aria-hidden />}
        {label}
      </OnlineButton>
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
    </div>
  )
}

// "טופל": the booking stays as it is; the item leaves the list.
function HandledButton({
  bookingId,
  name,
}: {
  bookingId: string
  name: string
}) {
  const router = useRouter()
  const announce = useAnnounce()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const copy = items.correction_affected

  async function press() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await markCorrectionHandledAction({ bookingId })
      if (result.ok) {
        announce?.(copy.handledDone)
        router.refresh()
        return
      }
      setError(result.code)
    } catch {
      setError("SERVER_ERROR")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="relative z-10 flex flex-col items-start gap-2 pt-1">
      <OnlineButton
        type="button"
        variant="outline"
        size="lg"
        aria-label={copy.handledFor(name)}
        aria-busy={pending || undefined}
        onClick={press}
        className={BUTTON}
      >
        {pending && <Spinner aria-hidden />}
        {copy.handled}
      </OnlineButton>
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
    </div>
  )
}

type ReadyPlan = Extract<SettlePlan, { ok: true }>

// "הצעת החזר או זיכוי": the parked_settle dialog, then the customer chooses
// as after a business cancel (3.8). One key per opening (AD-5).
function SettleButton({
  entitlementId,
  name,
}: {
  entitlementId: string
  name: string
}) {
  const router = useRouter()
  const announce = useAnnounce()
  const copy = items.paid_without_place
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<ReadyPlan | null>(null)
  const [key, setKey] = useState("")
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)

  async function open() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await previewSettleParkedAction({ entitlementId })
      const fresh: SettlePlan = result.ok
        ? result.data
        : { ok: false, code: result.code }
      if (!fresh.ok) {
        setError(fresh.code)
        return
      }
      setKey(newIdempotencyKey())
      setReason("")
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
      const result = await settleParkedAction({
        entitlementId,
        reason,
        confirmed: true,
        idempotencyKey: key,
      })
      if (result.ok) {
        setPlan(null)
        announce?.(
          plan?.customerId ? copy.settleDone : copy.settleDoneNoCustomer
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
    setPlan(null)
    setError(code)
  }

  return (
    <div className="relative z-10 flex flex-col items-start gap-2 pt-1">
      <Button
        type="button"
        variant="outline"
        size="lg"
        aria-label={copy.settleFor(name)}
        aria-busy={loading || undefined}
        onClick={open}
        className={BUTTON}
      >
        {loading && <Spinner aria-hidden />}
        {copy.settle}
      </Button>
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      {plan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !pending) setPlan(null)
          }}
          action="parked_settle"
          description={
            plan.customerId
              ? copy.settleDescription
              : copy.settleDescriptionNoCustomer
          }
          impact={[
            { label: copy.settleCustomer, value: <bdi>{name}</bdi> },
            {
              label: copy.settleSession,
              value: (
                <>
                  <bdi>{adminCopy.sessions.sessionTitle(plan.conceptName)}</bdi>{" "}
                  <time dateTime={plan.startsAt}>
                    {formatSessionDate(plan.startsAt)}
                  </time>
                </>
              ),
            },
            {
              label: copy.settleAmount,
              value: <bdi>{formatAgorot(plan.amountAgorot)}</bdi>,
            },
          ]}
          reason={{
            label: adminCopy.customers.entitlement.reason,
            value: reason,
            maxLength: 2000,
            onChange: (value) => {
              setReason(value)
              // A changed request is a new request (AD-5).
              setKey(newIdempotencyKey())
            },
          }}
          checkboxLabel={copy.settleCheckbox(name)}
          confirmLabel={copy.settleConfirm}
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}
