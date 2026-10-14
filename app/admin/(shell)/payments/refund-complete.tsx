"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { useAnnounce } from "@/components/shared/result-notice"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import {
  formatAgorot,
  formatAgorotInput,
  parseShekelsToAgorot,
} from "@/lib/money"
import { formatSessionDate } from "@/lib/time"

import { completeRefundAction, previewCompleteRefundAction } from "./actions"
import {
  refundFieldsProblem,
  refundRefusal,
  type RefundPlan,
} from "./refund-items"

const copy = adminCopy.refunds
const sessionsCopy = adminCopy.sessions

type ReadyPlan = Extract<RefundPlan, { ok: true }>
type RowError = { code: ErrorCode; field?: string }

// "סימון שההחזר בוצע" on an open refund request (story 3.9, CAP-19). The
// button reads the plan (preview_admin_complete_refund), then the
// refund_complete sensitive dialog ("האם לאשר החזר?") shows who, which
// session, what was paid, what was already refunded from that payment and
// the ceiling, with the three fields in its choice slot: the date (today
// by default, the server's day), the amount (the requested one by default)
// and an optional reference. The confirm waits for valid fields and the
// checkbox. One key per opening and per change (AD-5). On success the
// dialog closes, the page is read again (the row moves to the completed
// ones) and "ההחזר נרשם" is announced. A refusal closes the dialog, shows
// the reason under the button and reads the page again.
export function RefundComplete({
  refundRequestId,
  name,
  pendingJoin,
}: {
  refundRequestId: string
  // The row's customer (or "new customer").
  name: string
  // The purchase is not bound: no one is notified yet.
  pendingJoin: boolean
}) {
  const id = useId()
  const router = useRouter()
  const announce = useAnnounce()
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<ReadyPlan | null>(null)
  const [key, setKey] = useState("")
  const [refundedOn, setRefundedOn] = useState("")
  const [amountText, setAmountText] = useState("")
  const [reference, setReference] = useState("")
  const [pending, setPending] = useState(false)
  const [rowError, setRowError] = useState<RowError | null>(null)

  async function open() {
    if (loading) return
    setLoading(true)
    setRowError(null)
    try {
      const result = await previewCompleteRefundAction({ refundRequestId })
      const fresh: RefundPlan = result.ok
        ? result.data
        : { ok: false, code: result.code }
      if (!fresh.ok) {
        setRowError({ code: fresh.code })
        router.refresh()
        return
      }
      setKey(newIdempotencyKey())
      setRefundedOn(fresh.today)
      setAmountText(
        formatAgorotInput(Math.min(fresh.requestedAgorot, fresh.maxAgorot))
      )
      setReference("")
      setPlan(fresh)
    } catch {
      setRowError({ code: "SERVER_ERROR" })
    } finally {
      setLoading(false)
    }
  }

  async function confirm() {
    if (pending || !plan) return
    const amount = parseShekelsToAgorot(amountText)
    if (amount === null) return
    setPending(true)
    let error: RowError
    try {
      const result = await completeRefundAction({
        refundRequestId,
        refundedOn,
        amountAgorot: amount,
        reference,
        confirmed: true,
        idempotencyKey: key,
      })
      if (result.ok) {
        setPlan(null)
        announce?.(copy.done)
        router.refresh()
        return
      }
      error = { code: result.code, field: result.detail?.field }
    } catch {
      error = { code: "SERVER_ERROR" }
    } finally {
      setPending(false)
    }
    setPlan(null)
    setRowError(error)
    router.refresh()
  }

  // A changed field is a new request (AD-5).
  function change(set: (value: string) => void) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      set(event.target.value)
      setKey(newIdempotencyKey())
    }
  }

  const problem = plan
    ? refundFieldsProblem(plan, { refundedOn, amountText, reference })
    : null
  const parsed = parseShekelsToAgorot(amountText)

  return (
    <div className="flex flex-col items-start gap-2">
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
        <InlineNotice tone="error" className="max-w-sm">
          {refundRefusal(rowError.code, rowError.field) ??
            errorMessage(rowError.code)}
        </InlineNotice>
      )}
      {plan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !pending) setPlan(null)
          }}
          action="refund_complete"
          description={
            pendingJoin ? copy.descriptionNoCustomer : copy.description
          }
          impact={[
            { label: copy.customer, value: <bdi>{name}</bdi> },
            {
              label: copy.session,
              value: (
                <>
                  <bdi>{sessionsCopy.sessionTitle(plan.conceptName)}</bdi>
                  {" · "}
                  <time dateTime={plan.startsAt}>
                    {formatSessionDate(plan.startsAt)}
                  </time>
                </>
              ),
            },
            {
              label: copy.paid,
              value: <bdi>{formatAgorot(plan.paidAgorot)}</bdi>,
            },
            ...(plan.refundedBeforeAgorot > 0
              ? [
                  {
                    label: copy.refundedBefore,
                    value: <bdi>{formatAgorot(plan.refundedBeforeAgorot)}</bdi>,
                  },
                ]
              : []),
            {
              label: copy.max,
              value: <bdi>{formatAgorot(plan.maxAgorot)}</bdi>,
            },
          ]}
          choice={
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor={`${id}-date`}>{copy.dateLabel}</FieldLabel>
                <Input
                  id={`${id}-date`}
                  type="date"
                  value={refundedOn}
                  min={plan.paidOn}
                  max={plan.today}
                  required
                  aria-required
                  onChange={change(setRefundedOn)}
                  className="h-12 text-base"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-amount`}>
                  {copy.amountLabel}
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${id}-amount`}
                    inputMode="decimal"
                    autoComplete="off"
                    dir="ltr"
                    value={amountText}
                    required
                    aria-required
                    onChange={change(setAmountText)}
                    className="h-12 max-w-40 text-base"
                  />
                  <span aria-hidden className="text-base">
                    ₪
                  </span>
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-reference`}>
                  {copy.referenceLabel}
                </FieldLabel>
                <Input
                  id={`${id}-reference`}
                  value={reference}
                  maxLength={200}
                  autoComplete="off"
                  onChange={change(setReference)}
                  className="h-12 text-base"
                />
              </Field>
            </div>
          }
          choiceMissing={problem}
          checkboxLabel={copy.checkbox(
            parsed === null ? "" : formatAgorot(parsed),
            name
          )}
          confirmLabel={copy.confirm}
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}
