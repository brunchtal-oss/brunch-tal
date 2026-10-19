"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { useAnnounce } from "@/components/shared/result-notice"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatAgorot } from "@/lib/money"

import {
  changeCreditOptionsAction,
  listCreditCandidatesAction,
  previewChangeCreditOptionsAction,
  previewRefundCreditAction,
  refundCreditAction,
} from "./actions"
import {
  changeDiff,
  creditRefusal,
  optionLine,
  pickProblem,
  type CreditCandidate,
  type CreditChangePlan,
  type CreditManage as CreditManageView,
  type CreditRefundPlan,
  type CreditSession,
} from "./credit-items"

const copy = adminCopy.customers.card.credits
const REASON_MAX = 2000
const OUTLINE =
  "h-11 border-foreground bg-transparent px-4 text-base whitespace-normal"

type ChangeReady = Extract<CreditChangePlan, { ok: true }>
type RefundReady = Extract<CreditRefundPlan, { ok: true }>
type RowError = { code: ErrorCode; field?: string | null }

// Tal's two actions on an active credit (story 3.16), under its plate in
// "זיכויים והחזרים": "שינוי חלופות" opens an edit box in the plate (the
// matching sessions with room, the current alternatives checked, and an
// optional reason); "המשך" reads the plan and the credit_options dialog
// shows the sessions it adds and removes. An in-use credit names its
// session as a link to its admin page. "החזר במקום זיכוי" reads its plan and opens the
// credit_refund dialog with the amount and an optional reason. One key per
// dialog (AD-5). On success the box closes, the result is announced (by
// the section's ResultNoticeHost) and the page is read again. A refusal
// shows its reason under the buttons or in the box.
export function CreditManage({
  creditId,
  title,
  customerName,
  manage,
}: {
  creditId: string
  // The cancelled session ("בראנץ׳ {concept} {DD.MM}"), for the labels.
  title: string
  customerName: string
  manage: CreditManageView
}) {
  const id = useId()
  const router = useRouter()
  const announce = useAnnounce()
  const [busy, setBusy] = useState<"candidates" | "change" | "refund" | null>(
    null
  )
  const [candidates, setCandidates] = useState<CreditCandidate[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [reason, setReason] = useState("")
  const [changePlan, setChangePlan] = useState<ChangeReady | null>(null)
  const [refundPlan, setRefundPlan] = useState<RefundReady | null>(null)
  const [key, setKey] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<RowError | null>(null)

  const editing = candidates !== null
  const problem = editing ? pickProblem(picked) : null

  function closeBox() {
    setCandidates(null)
    setPicked([])
    setReason("")
    setError(null)
  }

  async function openBox() {
    if (busy) return
    setBusy("candidates")
    setError(null)
    try {
      const result = await listCreditCandidatesAction({ creditId })
      if (!result.ok) {
        setError({ code: result.code })
        return
      }
      setCandidates(result.data)
      setPicked(result.data.filter((c) => c.isOption).map((c) => c.eventId))
      setReason("")
    } catch {
      setError({ code: "SERVER_ERROR" })
    } finally {
      setBusy(null)
    }
  }

  async function nextChange() {
    if (busy || problem) return
    setBusy("change")
    setError(null)
    try {
      const result = await previewChangeCreditOptionsAction({
        creditId,
        eventIds: picked,
      })
      const fresh: CreditChangePlan = result.ok
        ? result.data
        : { ok: false, code: result.code, field: result.detail?.field ?? null }
      if (!fresh.ok) {
        setError({ code: fresh.code, field: fresh.field })
        return
      }
      setKey(newIdempotencyKey())
      setChangePlan(fresh)
    } catch {
      setError({ code: "SERVER_ERROR" })
    } finally {
      setBusy(null)
    }
  }

  async function openRefund() {
    if (busy) return
    setBusy("refund")
    setError(null)
    try {
      const result = await previewRefundCreditAction({ creditId })
      const fresh: CreditRefundPlan = result.ok
        ? result.data
        : { ok: false, code: result.code, field: null }
      if (!fresh.ok) {
        setError({ code: fresh.code })
        return
      }
      setKey(newIdempotencyKey())
      setReason("")
      setRefundPlan(fresh)
    } catch {
      setError({ code: "SERVER_ERROR" })
    } finally {
      setBusy(null)
    }
  }

  async function confirmChange() {
    if (pending || !changePlan) return
    setPending(true)
    let failure: RowError
    try {
      const result = await changeCreditOptionsAction({
        creditId,
        eventIds: changePlan.after.map((s) => s.eventId),
        reason,
        confirmed: true,
        idempotencyKey: key,
      })
      if (result.ok) {
        setChangePlan(null)
        closeBox()
        announce?.(copy.changeDone)
        router.refresh()
        return
      }
      failure = { code: result.code, field: result.detail?.field ?? null }
    } catch {
      failure = { code: "SERVER_ERROR" }
    } finally {
      setPending(false)
    }
    setChangePlan(null)
    setError(failure)
  }

  async function confirmRefund() {
    if (pending || !refundPlan) return
    setPending(true)
    let failure: RowError
    try {
      const result = await refundCreditAction({
        creditId,
        reason,
        confirmed: true,
        idempotencyKey: key,
      })
      if (result.ok) {
        setRefundPlan(null)
        setReason("")
        announce?.(copy.refundDone)
        router.refresh()
        return
      }
      failure = { code: result.code, field: result.detail?.field ?? null }
    } catch {
      failure = { code: "SERVER_ERROR" }
    } finally {
      setPending(false)
    }
    setRefundPlan(null)
    setError(failure)
  }

  // A changed reason is a new request (AD-5).
  function changeReason(value: string) {
    setReason(value)
    setKey(newIdempotencyKey())
  }

  const errorText = error
    ? (creditRefusal(error.code, error.field) ?? errorMessage(error.code))
    : null

  const changeRows = changePlan
    ? changeDiff(changePlan)
    : { added: [], removed: [] }

  return (
    <div className="flex flex-col gap-3 pt-2">
      {manage.note && (
        <p className="text-[15px]">
          <bdi>{manage.note}</bdi>
        </p>
      )}
      {manage.inUse && (
        // One line each (user decision 2026-10-20): the lead, the session
        // link, the instruction.
        <div className="flex flex-col gap-0.5 text-[15px]">
          <p>{copy.inUseLead}</p>
          <p>
            <Link
              href={manage.inUse.href}
              className="underline underline-offset-[3px]"
            >
              <time dateTime={manage.inUse.startsAt}>
                <bdi>{manage.inUse.line}</bdi>
              </time>
            </Link>
          </p>
          <p>{copy.inUseTail}</p>
        </div>
      )}

      {(manage.change || manage.refund) && !editing && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {manage.change && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              aria-label={copy.changeFor(title)}
              aria-busy={busy === "candidates" || undefined}
              onClick={openBox}
              className={OUTLINE}
            >
              {busy === "candidates" && <Spinner aria-hidden />}
              {copy.change}
            </Button>
          )}
          {manage.refund && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              aria-label={copy.refundFor(title)}
              aria-busy={busy === "refund" || undefined}
              onClick={openRefund}
              className={OUTLINE}
            >
              {busy === "refund" && <Spinner aria-hidden />}
              {copy.refund}
            </Button>
          )}
        </div>
      )}

      {!editing && errorText && (
        <InlineNotice tone="error" className="max-w-sm">
          {errorText}
        </InlineNotice>
      )}

      {editing && (
        <div className="flex flex-col gap-4 rounded-sm bg-card px-4 py-4">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-2 text-[15px] font-semibold">
              {copy.editHint}
            </legend>
            {candidates.length === 0 ? (
              <p className="text-base text-muted-foreground">
                {copy.noCandidates}
              </p>
            ) : (
              candidates.map((c) => {
                const boxId = `${id}-${c.eventId}`
                return (
                  <div
                    key={c.eventId}
                    className="flex min-h-11 items-center gap-3"
                  >
                    <Checkbox
                      id={boxId}
                      checked={picked.includes(c.eventId)}
                      onCheckedChange={(checked) =>
                        setPicked((now) =>
                          checked === true
                            ? [...now, c.eventId]
                            : now.filter((e) => e !== c.eventId)
                        )
                      }
                      className="size-6 rounded-[4px] border-[1.5px] border-muted-foreground"
                    />
                    <label htmlFor={boxId} className="text-base">
                      <time dateTime={c.startsAt}>
                        <bdi>{optionLine(c.conceptName, c.startsAt)}</bdi>
                      </time>
                    </label>
                  </div>
                )
              })
            )}
            {candidates.length > 0 && problem && (
              <p className="text-[15px] text-error">{problem}</p>
            )}
          </fieldset>

          <Field>
            <FieldLabel htmlFor={`${id}-reason`}>{copy.reason}</FieldLabel>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-20 text-base"
            />
          </Field>

          {errorText && <InlineNotice tone="error">{errorText}</InlineNotice>}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* No session to pick: only "ביטול". */}
            {candidates.length > 0 && (
              <Button
                type="button"
                size="lg"
                aria-busy={busy === "change" || undefined}
                aria-disabled={busy !== null || problem !== null || undefined}
                onClick={nextChange}
                className="h-11 px-5 text-base"
              >
                {busy === "change" && <Spinner aria-hidden />}
                {copy.next}
              </Button>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={closeBox}
              className="min-h-11 px-1 text-base underline underline-offset-[3px] disabled:opacity-50"
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      )}

      {changePlan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) setChangePlan(null)
          }}
          action="credit_options"
          description={copy.changeDescription}
          impact={[
            { label: copy.customer, value: <bdi>{customerName}</bdi> },
            { label: copy.creditRow, value: <bdi>{title}</bdi> },
            ...(changeRows.added.length > 0
              ? [
                  {
                    label: copy.added,
                    value: <Sessions list={changeRows.added} />,
                  },
                ]
              : []),
            ...(changeRows.removed.length > 0
              ? [
                  {
                    label: copy.removed,
                    value: <Sessions list={changeRows.removed} />,
                  },
                ]
              : []),
            ...(reason.trim()
              ? [{ label: copy.reasonRow, value: <bdi>{reason.trim()}</bdi> }]
              : []),
          ]}
          checkboxLabel={copy.changeCheckbox(customerName)}
          confirmLabel={copy.changeConfirm}
          pending={pending}
          onConfirm={confirmChange}
        />
      )}

      {refundPlan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) setRefundPlan(null)
          }}
          action="credit_refund"
          description={copy.refundDescription}
          impact={[
            { label: copy.customer, value: <bdi>{customerName}</bdi> },
            { label: copy.creditRow, value: <bdi>{title}</bdi> },
            {
              label: copy.amount,
              value: <bdi>{formatAgorot(refundPlan.amountAgorot)}</bdi>,
            },
          ]}
          reason={{
            label: copy.reason,
            value: reason,
            onChange: changeReason,
            maxLength: REASON_MAX,
          }}
          checkboxLabel={copy.refundCheckbox(
            formatAgorot(refundPlan.amountAgorot),
            customerName
          )}
          confirmLabel={copy.refundConfirm}
          pending={pending}
          onConfirm={confirmRefund}
        />
      )}
    </div>
  )
}

// The sessions of "מפגשים שנוספו" / "מפגשים שהוסרו", one per line.
function Sessions({ list }: { list: readonly CreditSession[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {list.map((s) => (
        <li key={s.eventId}>
          <time dateTime={s.startsAt}>
            <bdi>{optionLine(s.conceptName, s.startsAt)}</bdi>
          </time>
        </li>
      ))}
    </ul>
  )
}
