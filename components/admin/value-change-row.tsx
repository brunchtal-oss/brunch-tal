"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

const copy = adminCopy.valueChange

// What a save answers. null: nothing was sent (for example a confirmation
// dialog that was closed), so the row simply returns to its change box.
export type ValueSaveResult = { ok: true } | { ok: false; code: ErrorCode }

// One non-sensitive business value, "old ← new" before it is saved
// (DESIGN.md › value-change-row, EXPERIENCE › Component Patterns; story 2.6,
// 2.7 reuses it). The field itself is the child. While its value differs
// from the saved one (newValue is not null), a muted box below it shows
// "{field}: {old} ← {new}", the scope note and "save". No checkbox: that is
// only in sensitive-confirm-dialog. The save is busy until the answer; a
// failure shows an inline-notice error and the saved value stays as it was
// (nothing is optimistic). After a success the page is refreshed, so the
// saved value arrives from the server and the box closes with "saved".
// One idempotency key per change (AD-5): a failed call stores nothing, so a
// retry may send it again; a success takes a new key.
export function ValueChangeRow({
  label,
  oldValue,
  newValue,
  scope,
  onSave,
  children,
}: {
  // The field's name in the change line.
  label: string
  // The saved value and the edited one, as text. newValue null: unchanged,
  // or not valid yet (the field shows why).
  oldValue: string
  newValue: string | null
  // What the change applies to ("applies to new purchases only").
  scope?: React.ReactNode
  // Sends the change with this key; called only from the save button.
  onSave: (idempotencyKey: string) => Promise<ValueSaveResult | null>
  children: React.ReactNode
}) {
  const router = useRouter()
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [pending, setPending] = useState(false)
  // The value the last answer was for: "saved" or the error is shown only
  // while the field still holds it (or, after a save, until the refresh
  // brings it in as the saved value).
  const [answer, setAnswer] = useState<{
    value: string
    result: ValueSaveResult
  } | null>(null)

  const savedNow =
    answer?.result.ok === true &&
    (newValue === null || newValue === answer.value)
  const error =
    answer && !answer.result.ok && newValue === answer.value
      ? answer.result.code
      : null
  const showChange = newValue !== null && !savedNow

  const save = async () => {
    if (pending || newValue === null) return
    setPending(true)
    try {
      const result = await onSave(key)
      if (!result) return
      setAnswer({ value: newValue, result })
      if (result.ok) {
        setKey(newIdempotencyKey())
        router.refresh()
      }
    } catch {
      setAnswer({
        value: newValue,
        result: { ok: false, code: "SERVER_ERROR" },
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {children}
      {showChange && (
        <div className="flex flex-col gap-3 rounded-sm bg-muted px-4 py-3">
          <p className="text-[15px] font-semibold break-words">
            <bdi>{copy.change(label, oldValue, newValue)}</bdi>
          </p>
          {scope && (
            <p className="text-[13px] text-muted-foreground">{scope}</p>
          )}
          {error && (
            <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>
          )}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 self-start border-foreground bg-transparent px-4 text-base"
            aria-busy={pending || undefined}
            aria-disabled={pending || undefined}
            onClick={save}
          >
            {pending && <Spinner aria-hidden />}
            {copy.save}
          </Button>
        </div>
      )}
      {savedNow && <InlineNotice tone="success">{copy.saved}</InlineNotice>}
    </div>
  )
}
