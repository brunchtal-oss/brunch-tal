"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { sectionTitleClass } from "@/components/shared/section-title"
import { StatusChip } from "@/components/shared/status-chip"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ActionResult, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatDayMonth } from "@/lib/time"

import { addTextAction, updateTextAction } from "./actions"
import {
  MAX_TEXT,
  nextTextId,
  textProblem,
  trimText,
  type MarketingText,
} from "./marketing-draft"

const copy = adminCopy.settings.marketing

const LINK_BUTTON =
  "min-h-11 px-0 text-[15px] text-foreground underline underline-offset-[3px]"

// What is open: nothing, one text's editor, or the new text's.
type Open = { kind: "none" } | { kind: "edit"; id: string } | { kind: "add" }

// The texts (story 5.11), in sort_order: each with its body, a chip
// "פעיל" / "כבוי", "הבא בתור" on the one the job sends next, and when it
// was last sent. "עריכה" opens it in place (textarea, "פעיל", save and
// cancel); "הוספת נוסח" opens an empty one. One editor at a time. With no
// active text a notice says no reminder is sent. No delete (user decision
// 2026-10-20).
export function TextsEditor({ texts }: { texts: readonly MarketingText[] }) {
  const [open, setOpen] = useState<Open>({ kind: "none" })
  const next = nextTextId(texts)
  const close = () => setOpen({ kind: "none" })

  return (
    <section aria-labelledby="marketing-texts" className="flex flex-col gap-3">
      <h2 id="marketing-texts" className={sectionTitleClass}>
        {copy.texts}
      </h2>
      {next === null && (
        <InlineNotice tone="warning">{copy.noActive}</InlineNotice>
      )}
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {texts.map((text) => (
          <li key={text.id} className="py-4">
            {open.kind === "edit" && open.id === text.id ? (
              <TextForm text={text} onDone={close} />
            ) : (
              <TextRow
                text={text}
                isNext={text.id === next}
                onEdit={() => setOpen({ kind: "edit", id: text.id })}
              />
            )}
          </li>
        ))}
        {open.kind === "add" && (
          <li className="py-4">
            <TextForm text={null} onDone={close} />
          </li>
        )}
      </ul>
      {open.kind !== "add" && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen({ kind: "add" })}
          className="h-12 self-start border-foreground bg-transparent px-5 text-base font-semibold"
        >
          {copy.add}
        </Button>
      )}
    </section>
  )
}

export function TextRow({
  text,
  isNext,
  onEdit,
}: {
  text: MarketingText
  isNext: boolean
  onEdit: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <p
        className={
          text.active
            ? "text-base leading-normal break-words whitespace-pre-line"
            : "text-base leading-normal break-words whitespace-pre-line text-muted-foreground"
        }
      >
        {text.body}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={text.active ? "success" : "expired"}>
          {text.active ? copy.active : copy.inactive}
        </StatusChip>
        {isNext && <StatusChip tone="pending">{copy.next}</StatusChip>}
        <span className="text-[13px] text-muted-foreground">
          {text.last_sent_at
            ? copy.lastSent(formatDayMonth(text.last_sent_at))
            : copy.neverSent}
        </span>
      </div>
      <Button
        type="button"
        variant="link"
        onClick={onEdit}
        className={`${LINK_BUTTON} self-start`}
      >
        {copy.edit}
      </Button>
    </div>
  )
}

// The editor of one text, or of a new one (text null): a textarea, for an
// existing text the "פעיל" checkbox, then save and cancel. The length is
// checked here too (the server decides). A failure keeps the editor open
// with its message; a success closes it and refreshes the list.
function TextForm({
  text,
  onDone,
}: {
  text: MarketingText | null
  onDone: () => void
}) {
  const router = useRouter()
  const [body, setBody] = useState(text?.body ?? "")
  const [active, setActive] = useState(text?.active ?? true)
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [showProblem, setShowProblem] = useState(false)
  const id = text ? `marketing-text-${text.id}` : "marketing-text-new"
  const problem = textProblem(body)
  const problemText =
    problem === "empty"
      ? errorMessage("FIELD_REQUIRED")
      : problem === "long"
        ? adminCopy.settings.templates.tooLong(MAX_TEXT)
        : null
  const shownProblem = showProblem || problem === "long" ? problemText : null

  const save = async () => {
    if (pending) return
    if (problem) {
      setShowProblem(true)
      return
    }
    // Nothing changed: close without a call.
    if (text && trimText(body) === text.body && active === text.active) {
      onDone()
      return
    }
    setPending(true)
    setError(null)
    let result: ActionResult
    try {
      result = text
        ? await updateTextAction({
            textId: text.id,
            body: trimText(body),
            active,
            expectedVersion: text.version,
            idempotencyKey: key,
          })
        : await addTextAction({ body: trimText(body), idempotencyKey: key })
    } catch {
      result = { ok: false, code: "SERVER_ERROR" }
    }
    setKey(newIdempotencyKey())
    setPending(false)
    if (!result.ok) {
      setError(result.code)
      return
    }
    router.refresh()
    onDone()
  }

  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-3">
      <Field data-invalid={shownProblem ? true : undefined}>
        <FieldLabel htmlFor={id}>
          {text ? copy.bodyLabel : copy.newBodyLabel}
        </FieldLabel>
        <Textarea
          id={id}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          autoFocus
          aria-invalid={shownProblem ? true : undefined}
          aria-describedby={shownProblem ? errorId : undefined}
          className="min-h-28 text-base"
        />
        {shownProblem && (
          <p id={errorId} className="text-[15px] text-error">
            {shownProblem}
          </p>
        )}
      </Field>
      {text && (
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox
            id={`${id}-active`}
            checked={active}
            onCheckedChange={(next) => setActive(next === true)}
            className="size-6 rounded-[4px] border-[1.5px] border-muted-foreground"
          />
          <label htmlFor={`${id}-active`} className="text-base">
            {copy.activeLabel}
          </label>
        </div>
      )}
      <div aria-live="polite">
        {error && (
          <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <OnlineButton
          type="button"
          onClick={() => void save()}
          aria-disabled={pending ? true : undefined}
          className="h-12 px-6 text-base"
        >
          {pending && <Spinner className="size-[18px]" />}
          {copy.save}
        </OnlineButton>
        <Button
          type="button"
          variant="link"
          onClick={onDone}
          className={LINK_BUTTON}
        >
          {copy.cancel}
        </Button>
      </div>
    </div>
  )
}
