"use client"

import { startTransition, useState } from "react"
import { useRouter } from "next/navigation"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { useAnnounce } from "@/components/shared/result-notice"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatAgorot } from "@/lib/money"
import { formatLocalDate, formatShortDate } from "@/lib/time"

import { previewVoidPurchaseAction, voidPurchaseAction } from "./actions"
import {
  voidBookingLine,
  voidNotificationLines,
  type VoidPlan,
} from "./entitlement-items"

const copy = adminCopy.customers.entitlement.void
const REASON_MAX = 2000

type ReadyPlan = Extract<VoidPlan, { ok: true }>

// Story 2.14 (user decisions 2026-10-26), the last section of the purchase
// page: "ביטול הרכישה" reads the plan (preview_admin_void_purchase) and
// opens the sensitive dialog: product, amount and purchase date; the
// future bookings it cancels with no credit (or that there are none); the
// join link it revokes; that the customer gets no notification (and, for a
// card she already booked with, that Tal should tell her); and that the
// void is final. The reason is optional. One key per opening (AD-5). On
// success the result is announced and the page is read again (it then
// shows "בוטל" and no section). A refusal shows under the button.
export function VoidPurchase({ paymentId }: { paymentId: string }) {
  const router = useRouter()
  const announce = useAnnounce()
  const [plan, setPlan] = useState<ReadyPlan | null>(null)
  const [reason, setReason] = useState("")
  const [key, setKey] = useState("")
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)

  const start = () => {
    if (loading) return
    setLoading(true)
    setError(null)
    startTransition(async () => {
      try {
        const result = await previewVoidPurchaseAction({ paymentId })
        const fresh: VoidPlan = result.ok
          ? result.data
          : { ok: false, code: result.code }
        if (fresh.ok) {
          setReason("")
          setKey(newIdempotencyKey())
          setPlan(fresh)
        } else {
          setError(fresh.code)
          // Voided meanwhile (another tab): the page shows it.
          if (fresh.code === "PURCHASE_VOIDED") router.refresh()
        }
      } catch {
        setError("SERVER_ERROR")
      }
      setLoading(false)
    })
  }

  const confirm = () => {
    if (pending || !plan) return
    setPending(true)
    startTransition(async () => {
      let code: ErrorCode
      try {
        const result = await voidPurchaseAction({
          paymentId,
          reason,
          confirmed: true,
          idempotencyKey: key,
        })
        if (result.ok) {
          setPending(false)
          setPlan(null)
          announce?.(copy.done)
          router.refresh()
          return
        }
        code = result.code
      } catch {
        code = "SERVER_ERROR"
      }
      setPending(false)
      setPlan(null)
      setError(code)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-base text-muted-foreground">
        {copy.intro}
      </p>
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      <OnlineButton
        type="button"
        variant="outline"
        size="lg"
        className="h-12 self-start border-error px-4 text-base text-error"
        aria-busy={loading || undefined}
        onClick={start}
      >
        {loading && <Spinner aria-hidden />}
        {copy.button}
      </OnlineButton>

      {plan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !pending) setPlan(null)
          }}
          action="purchase_void"
          description={copy.description}
          impact={[
            { label: copy.product, value: <bdi>{plan.productName}</bdi> },
            {
              label: copy.amount,
              value: <bdi>{formatAgorot(plan.amountAgorot)}</bdi>,
            },
            {
              label: copy.paidOn,
              value: (
                <time dateTime={formatLocalDate(plan.paidOn)}>
                  {formatShortDate(plan.paidOn)}
                </time>
              ),
            },
          ]}
          noticeAlign="start"
          notice={<VoidNotice plan={plan} />}
          reason={{
            label: copy.reason,
            value: reason,
            onChange: setReason,
            maxLength: REASON_MAX,
          }}
          checkboxLabel={copy.checkbox(plan.customerLabel)}
          confirmLabel={copy.confirm}
          destructive
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}

// What the void does beyond the payment, in the dialog's warning box.
export function VoidNotice({ plan }: { plan: ReadyPlan }) {
  return (
    <div className="flex flex-col gap-3">
      {plan.bookings.length === 0 ? (
        <p>{copy.noBookings}</p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="font-semibold">{copy.bookingsTitle}</p>
          <ul className="flex flex-col gap-1">
            {plan.bookings.map((b) => {
              const line = voidBookingLine(b)
              return (
                <li key={b.bookingId} className="flex flex-col">
                  <time dateTime={b.startsAt}>
                    <bdi>{line.session}</bdi>
                  </time>
                  {line.couple && (
                    <span className="text-[13px] break-words">
                      <bdi>{line.couple}</bdi>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {plan.linkWillBeRevoked && <p>{copy.linkRevoked}</p>}
      {voidNotificationLines(plan).map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p className="font-semibold">{copy.final}</p>
    </div>
  )
}
