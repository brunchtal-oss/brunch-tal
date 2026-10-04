"use client"

import { useId, useRef, useState } from "react"

import { InlineNotice } from "@/components/shared/inline-notice"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  sensitiveTitle,
  type SensitiveAction,
} from "@/lib/admin/sensitive-actions"
import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

const copy = adminCopy.sensitive
const BUTTON = "h-12 text-base"

export type ImpactRow = { label: string; value: React.ReactNode }

export type SensitiveConfirmProps = {
  // What it shows: the impact box (what changes and for whom), an optional
  // warning and an optional reason field (never required), the full wording
  // of the required checkbox.
  impact: readonly ImpactRow[]
  notice?: React.ReactNode
  reason?: { label: string; value: string; onChange: (value: string) => void }
  checkboxLabel: React.ReactNode
  confirmLabel: string
  destructive?: boolean
  // True from the confirm until the answer: the confirm button is busy.
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// The body of the dialog (DESIGN › sensitive-confirm-dialog, EXPERIENCE ›
// Component Patterns): impact box on muted, warning, reason (optional, never
// blocks), a 24px checkbox with its full label, then the confirm and
// "cancel". Only the checkbox blocks: until it is checked the confirm is
// aria-disabled, and a press shows why (linked by aria-describedby). There is
// no form, so Enter never confirms.
export function SensitiveConfirmPanel({
  impact,
  notice,
  reason,
  checkboxLabel,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: SensitiveConfirmProps) {
  const id = useId()
  const [checked, setChecked] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const checkId = `${id}-check`
  const hintId = `${id}-hint`

  const confirm = () => {
    if (pending) return
    if (!checked) {
      setShowHint(true)
      return
    }
    onConfirm()
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md bg-muted px-4 py-3 text-[15px]">
        {impact.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words">{row.value}</dd>
          </div>
        ))}
      </dl>

      {notice && <InlineNotice tone="warning">{notice}</InlineNotice>}

      {reason && (
        <Field>
          <FieldLabel htmlFor={`${id}-reason`}>{reason.label}</FieldLabel>
          <Textarea
            id={`${id}-reason`}
            value={reason.value}
            maxLength={500}
            onChange={(event) => reason.onChange(event.target.value)}
            className="min-h-20 text-base"
          />
        </Field>
      )}

      <div className="flex items-start gap-3">
        <Checkbox
          id={checkId}
          checked={checked}
          onCheckedChange={(value) => {
            setChecked(value === true)
            if (value === true) setShowHint(false)
          }}
          aria-describedby={showHint ? hintId : undefined}
          className="mt-0.5 size-6 rounded-[4px] border-[1.5px] border-muted-foreground"
        />
        <label htmlFor={checkId} className="text-[15px] leading-normal">
          {checkboxLabel}
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="lg"
          variant={destructive ? "destructive" : "default"}
          className={cn(
            BUTTON,
            destructive && "bg-error text-primary-foreground"
          )}
          aria-disabled={!checked || pending || undefined}
          aria-busy={pending || undefined}
          aria-describedby={hintId}
          onClick={confirm}
        >
          {pending && <Spinner aria-hidden />}
          {confirmLabel}
        </Button>
        <p
          id={hintId}
          aria-live="polite"
          className="min-h-5 text-[13px] text-error"
        >
          {showHint && !checked ? copy.checkRequired : ""}
        </p>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className={BUTTON}
          disabled={pending}
          onClick={onCancel}
        >
          {copy.cancel}
        </Button>
      </div>
    </div>
  )
}

// The shared sensitive confirmation (2.5; E3-E6 reuse it). The title is the
// action's question (lib/admin/sensitive-actions.ts). Focus starts on the
// title, never on the confirm button. Closing is blocked while pending. The
// state (checkbox) starts again on every opening.
export function SensitiveConfirmDialog({
  open,
  onOpenChange,
  action,
  description,
  ...panel
}: Omit<SensitiveConfirmProps, "onCancel"> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: SensitiveAction
  // The explanation under the title.
  description: React.ReactNode
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && panel.pending) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent
        initialFocus={titleRef}
        className="max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] gap-3 overflow-y-auto rounded-md bg-card p-5 data-[size=default]:max-w-md data-[size=default]:sm:max-w-md"
      >
        <AlertDialogTitle
          ref={titleRef}
          tabIndex={-1}
          className="text-[22px] leading-tight font-light outline-none"
        >
          {sensitiveTitle(action)}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-[15px] text-muted-foreground">
          {description}
        </AlertDialogDescription>
        <SensitiveConfirmPanel
          {...panel}
          onCancel={() => onOpenChange(false)}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
