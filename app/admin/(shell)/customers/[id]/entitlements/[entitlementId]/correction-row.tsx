"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"

import { RadioCardGroup } from "@/components/admin/radio-card"
import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { useAnnounce } from "@/components/shared/result-notice"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

import {
  correctEntitlementAction,
  previewCorrectEntitlementAction,
} from "./actions"
import {
  affectedLine,
  correctionRefusal,
  correctionValue,
  impactValues,
  sensitiveOf,
  wordingOf,
  type CorrectionDraft,
  type CorrectionField,
  type CorrectionPlan,
  type SessionOption,
} from "./entitlement-items"

const copy = adminCopy.customers.entitlement
const REASON_MAX = 2000
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const

type ReadyPlan = Extract<CorrectionPlan, { ok: true }>
type RowError = { code: ErrorCode; field?: string | null }

// One term of the card (story 3.13): its name, its value and "שינוי". The
// button opens an edit box under the row: the new value, for the balance an
// optional session of this card, and an optional reason. "המשך" reads the
// plan (preview_admin_correct_entitlement); the field's sensitive dialog
// shows "לפני" / "אחרי" and the future bookings that will no longer fit
// (they stay as they are). One key per opening of the dialog (AD-5). On
// success the box closes, the result is announced and the page is read
// again. A refusal shows its reason in the box.
export function CorrectionRow({
  entitlementId,
  field,
  label,
  value,
  note,
  initial,
  validFrom,
  reserved,
  sessions,
  customerName,
  hasCustomer,
  editable,
}: {
  entitlementId: string
  field: CorrectionField
  label: string
  value: string
  note: string | null
  initial: CorrectionDraft
  validFrom: string
  reserved: number
  sessions: readonly SessionOption[]
  customerName: string
  hasCustomer: boolean
  editable: boolean
}) {
  const id = useId()
  const router = useRouter()
  const announce = useAnnounce()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CorrectionDraft>(initial)
  const [relatedEventId, setRelatedEventId] = useState("")
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<ReadyPlan | null>(null)
  const [key, setKey] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<RowError | null>(null)

  const wording = wordingOf(field)
  const draftValue = correctionValue(field, draft)

  function close() {
    setOpen(false)
    setDraft(initial)
    setRelatedEventId("")
    setReason("")
    setError(null)
  }

  async function next() {
    if (loading || !draftValue.ready) return
    setLoading(true)
    setError(null)
    try {
      const result = await previewCorrectEntitlementAction({
        entitlementId,
        field,
        value: draftValue.value,
      })
      const fresh: CorrectionPlan = result.ok
        ? result.data
        : { ok: false, code: result.code, field: result.detail?.field ?? null }
      if (!fresh.ok) {
        setError({ code: fresh.code, field: fresh.field })
        return
      }
      setKey(newIdempotencyKey())
      setPlan(fresh)
    } catch {
      setError({ code: "SERVER_ERROR" })
    } finally {
      setLoading(false)
    }
  }

  async function confirm() {
    if (pending || !plan) return
    setPending(true)
    let failure: RowError
    try {
      const result = await correctEntitlementAction({
        entitlementId,
        field,
        value: plan.newValue,
        relatedEventId:
          field === "units" && relatedEventId ? relatedEventId : null,
        reason,
        confirmed: true,
        idempotencyKey: key,
      })
      if (result.ok) {
        setPlan(null)
        close()
        announce?.(hasCustomer ? copy.done : copy.doneNoCustomer)
        router.refresh()
        return
      }
      failure = { code: result.code, field: result.detail?.field ?? null }
    } catch {
      failure = { code: "SERVER_ERROR" }
    } finally {
      setPending(false)
    }
    setPlan(null)
    setError(failure)
  }

  const impact = plan ? impactValues(plan) : null
  const related = sessions.find((s) => s.value === relatedEventId)

  return (
    <li className="flex flex-col gap-3 border-b border-border py-3 first:border-t">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] text-muted-foreground">{label}</span>
          <span className="text-base font-semibold break-words">
            <bdi>{value}</bdi>
            {note && (
              <span className="ms-1 font-normal text-muted-foreground">
                {note}
              </span>
            )}
          </span>
        </div>
        {editable && !open && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            aria-label={copy.changeFor(label)}
            onClick={() => {
              // The current values (after an earlier correction the page
              // was read again).
              setDraft(initial)
              setOpen(true)
            }}
            className="h-11 shrink-0 border-foreground bg-transparent px-4 text-base"
          >
            {copy.change}
          </Button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-4 rounded-sm bg-muted px-4 py-4">
          {field === "expires_on" && (
            <Field>
              <FieldLabel htmlFor={`${id}-date`}>{copy.newExpiry}</FieldLabel>
              <Input
                id={`${id}-date`}
                type="date"
                value={draft.expiresOn}
                min={validFrom}
                required
                aria-required
                onChange={(e) =>
                  setDraft({ ...draft, expiresOn: e.target.value })
                }
                className="h-12 max-w-56 bg-card text-base"
              />
            </Field>
          )}

          {field === "units" && (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-units`}>{copy.newUnits}</FieldLabel>
                <p
                  id={`${id}-units-hint`}
                  className="text-[13px] text-muted-foreground"
                >
                  {copy.unitsHint(reserved)}
                </p>
                <Input
                  id={`${id}-units`}
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  value={draft.units}
                  required
                  aria-required
                  maxLength={2}
                  aria-invalid={!draftValue.ready || undefined}
                  aria-describedby={
                    draftValue.ready
                      ? `${id}-units-hint`
                      : `${id}-units-hint ${id}-units-error`
                  }
                  onChange={(e) =>
                    setDraft({ ...draft, units: e.target.value })
                  }
                  className="h-12 max-w-28 bg-card text-base"
                />
                {!draftValue.ready && (
                  <p
                    id={`${id}-units-error`}
                    className="text-[15px] text-error"
                  >
                    {copy.refusal.units}
                  </p>
                )}
              </Field>
              {sessions.length > 0 && (
                <Field>
                  <FieldLabel htmlFor={`${id}-session`}>
                    {copy.related}
                  </FieldLabel>
                  <NativeSelect
                    id={`${id}-session`}
                    value={relatedEventId}
                    onChange={(e) => setRelatedEventId(e.target.value)}
                    className="h-12 w-full bg-card text-base"
                  >
                    <NativeSelectOption value="">
                      {copy.relatedNone}
                    </NativeSelectOption>
                    {sessions.map((s) => (
                      <NativeSelectOption key={s.value} value={s.value}>
                        {s.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </>
          )}

          {field === "allowed_weekdays" && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[15px] font-semibold">
                {copy.newWeekdays}
              </legend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {ALL_DAYS.map((day) => {
                  const dayId = `${id}-day-${day}`
                  return (
                    <div key={day} className="flex min-h-11 items-center gap-3">
                      <Checkbox
                        id={dayId}
                        checked={draft.weekdays.includes(day)}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            weekdays:
                              checked === true
                                ? [...draft.weekdays, day]
                                : draft.weekdays.filter((d) => d !== day),
                          })
                        }
                        className="size-6 rounded-[4px] border-[1.5px] border-muted-foreground bg-card"
                      />
                      <label htmlFor={dayId} className="text-base">
                        {copy.weekdays[day]}
                      </label>
                    </div>
                  )
                })}
              </div>
              {!draftValue.ready && (
                <p className="text-[15px] text-error">
                  {copy.refusal.allowed_weekdays}
                </p>
              )}
            </fieldset>
          )}

          {field === "eligible_event_kind" && (
            <RadioCardGroup
              legend={copy.newKind}
              name={`${id}-kind`}
              options={[
                { value: "regular", label: copy.kinds.regular },
                { value: "couple", label: copy.kinds.couple },
              ]}
              value={draft.kind}
              onChange={(kind) => setDraft({ ...draft, kind })}
            />
          )}

          <Field>
            <FieldLabel htmlFor={`${id}-reason`}>{copy.reason}</FieldLabel>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-20 bg-card text-base"
            />
          </Field>

          {error && (
            <InlineNotice tone="error">
              {correctionRefusal(error.code, error.field) ??
                errorMessage(error.code)}
            </InlineNotice>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              type="button"
              size="lg"
              aria-busy={loading || undefined}
              aria-disabled={loading || !draftValue.ready || undefined}
              onClick={next}
              className="h-11 px-5 text-base"
            >
              {loading && <Spinner aria-hidden />}
              {copy.next}
            </Button>
            <button
              type="button"
              disabled={loading}
              onClick={close}
              className="min-h-11 px-1 text-base underline underline-offset-[3px] disabled:opacity-50"
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      )}

      {plan && impact && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !pending) setPlan(null)
          }}
          action={sensitiveOf(field)}
          description={copy.descriptions[wording]}
          impact={[
            { label: copy.customer, value: <bdi>{customerName}</bdi> },
            { label: copy.before, value: <bdi>{impact.before}</bdi> },
            { label: copy.after, value: <bdi>{impact.after}</bdi> },
            ...(field === "units" && related
              ? [
                  {
                    label: copy.relatedSession,
                    value: <bdi>{related.label}</bdi>,
                  },
                ]
              : []),
            ...(reason.trim()
              ? [
                  {
                    label: copy.reasonRow,
                    value: <bdi>{reason.trim()}</bdi>,
                  },
                ]
              : []),
          ]}
          notice={
            plan.affected.length > 0 ? (
              <div className="flex flex-col gap-2">
                {plan.affected.length > 0 && (
                  <>
                    <p className="font-semibold">{copy.affectedTitle}</p>
                    <ul className="flex flex-col gap-1">
                      {plan.affected.map((a) => (
                        <li key={a.bookingId}>
                          <time dateTime={a.startsAt}>
                            <bdi>{affectedLine(a)}</bdi>
                          </time>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[13px]">{copy.affectedHint}</p>
                  </>
                )}
              </div>
            ) : undefined
          }
          checkboxLabel={copy.checkbox[wording](customerName)}
          confirmLabel={copy.confirm[wording]}
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </li>
  )
}
