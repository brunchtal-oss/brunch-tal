"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ActionResult, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { isOffline } from "@/lib/use-online"

const copy = adminCopy.valueChange

// What a save answers. null: nothing was sent (for example a confirmation
// dialog that was closed), so the row simply returns to its change box.
export type ValueSaveResult = { ok: true } | { ok: false; code: ErrorCode }

// A Server Action's result as a row's save result.
export function asSaveResult(result: ActionResult<unknown>): ValueSaveResult {
  return result.ok ? { ok: true } : { ok: false, code: result.code }
}

// One non-sensitive business value, "old ← new" before it is saved
// (DESIGN.md › value-change-row, EXPERIENCE › Component Patterns; story 2.6,
// 2.7 reuses it). The field itself is the child. While its value differs
// from the saved one (newValue is not null), a muted box below it shows
// "{field}: {old} ← {new}", the scope note and "save". No checkbox: that is
// only in sensitive-confirm-dialog. The save is busy until the answer; a
// failure shows an inline-notice error and the saved value stays as it was
// (nothing is optimistic). After a success the page is refreshed, so the
// saved value arrives from the server and the box closes with "saved".
// One idempotency key per save (AD-5): every answer, ok or not, takes a new
// key, because an RPC may store a non-error answer under it (a phone or
// email "taken", or an email change that began before Auth failed), and the
// next save of a different value with that key would be
// IDEMPOTENCY_KEY_REUSED. Retrying the same value with a new key is safe:
// the RPCs check the stored state again.
export function ValueChangeRow({
  label,
  oldValue,
  newValue,
  scope,
  onSave,
  onCancel,
  savedText,
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
  // Returns the field to its saved value (phone test 2026-10-04), which
  // closes the box.
  onCancel: () => void
  // The success notice, when this value has its own ("המייל עודכן…");
  // "saved" otherwise.
  savedText?: string
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
      const saved = await saveWithKey(onSave, key)
      setKey(saved.nextKey)
      if (!saved.result) return
      setAnswer({ value: newValue, result: saved.result })
      if (saved.result.ok) router.refresh()
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <OnlineButton
              type="button"
              variant="outline"
              size="lg"
              className="h-11 border-foreground bg-transparent px-4 text-base"
              aria-busy={pending || undefined}
              aria-disabled={pending || undefined}
              onClick={save}
            >
              {pending && <Spinner aria-hidden />}
              {copy.save}
            </OnlineButton>
            {/* button-link (DESIGN): ink text, underlined, 44px target. */}
            <button
              type="button"
              disabled={pending}
              onClick={onCancel}
              className="min-h-11 px-1 text-base underline underline-offset-[3px] disabled:opacity-50"
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      )}
      {savedNow && (
        <InlineNotice tone="success">{savedText ?? copy.saved}</InlineNotice>
      )}
    </div>
  )
}

// One save: sends the change with `key` and tells which key the next save
// uses. A new key after every answer (ok, refused or thrown); only a save
// that sent nothing (null, a closed dialog) keeps it.
export async function saveWithKey(
  onSave: (idempotencyKey: string) => Promise<ValueSaveResult | null>,
  key: string
): Promise<{ result: ValueSaveResult | null; nextKey: string }> {
  // Offline nothing is sent (story 5.21): the same key for the next save.
  if (isOffline()) return { result: null, nextKey: key }
  try {
    const result = await onSave(key)
    return { result, nextKey: result ? newIdempotencyKey() : key }
  } catch {
    return {
      result: { ok: false, code: "SERVER_ERROR" },
      nextKey: newIdempotencyKey(),
    }
  }
}
