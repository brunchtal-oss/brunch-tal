"use client"

import { useRef, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react"

import { buttonClass } from "@/components/shared/button-class"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

// The admin's editing kit (moved from the work sheet of story 4.9, shared
// with the notes of 4.11): a bottom-sheet, a one-field form, up and down,
// a two-step delete and the inline error. Every write locks its control
// until the refreshed page arrives (no optimistic update).

const copy = adminCopy.work

export const OUTLINE = buttonClass({
  variant: "outline",
  size: "lg",
  className:
    "h-11 rounded-[4px] border-foreground px-4 text-[15px] font-semibold",
})
export const TEXT_BUTTON =
  "inline-flex min-h-11 items-center rounded-[4px] text-[15px] underline underline-offset-[3px] disabled:opacity-50"
const INPUT = "h-12 text-base"
const PRIMARY = "h-12 rounded-[4px] text-base font-semibold"
// A dish name, a task or a shopping item.
const MAX_TEXT = 200

export function ErrorNotice({ code }: { code: string | null }) {
  if (!code) return null
  return <InlineNotice tone="error">{errorMessage(code)}</InlineNotice>
}

export function Busy({ pending }: { pending: boolean }) {
  return pending ? <Spinner aria-hidden /> : null
}

// A bottom-sheet (EXPERIENCE › bottom-sheet), as on the customer's cancel:
// it stays open while a change is on its way.
export function WorkPanel({
  open,
  onOpenChange,
  busy,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  title: React.ReactNode
  children: React.ReactNode
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-modal="true"
        initialFocus={titleRef}
        className="mx-auto max-h-[90vh] w-full max-w-[720px] gap-0 overflow-y-auto rounded-t-xl border-0 bg-card px-6 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-base shadow-none"
      >
        <span
          aria-hidden
          className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-border"
        />
        <div className="flex items-center justify-between gap-2">
          <SheetTitle
            ref={titleRef}
            tabIndex={-1}
            className="font-heading text-[22px] leading-[1.25] font-light"
          >
            {title}
          </SheetTitle>
          <SheetClose
            aria-label={copy.close}
            disabled={busy}
            className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
          >
            <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
          </SheetClose>
        </div>
        <div className="mt-4 flex flex-col gap-6">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

// A one-field text form (a dish name, a task, a topic, a note): the button
// saves, and so does Enter in a one-line field. max is the field's length
// (200 by default); multiline makes it a textarea (a note), where Enter is a
// new line.
export function TextForm({
  id,
  label,
  value,
  onChange,
  submitLabel,
  pending,
  onSubmit,
  inputRef,
  max = MAX_TEXT,
  multiline = false,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  submitLabel: string
  pending: boolean
  onSubmit: () => void
  inputRef?: React.Ref<HTMLInputElement>
  max?: number
  multiline?: boolean
  children?: React.ReactNode
}) {
  const empty = value.trim() === ""
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!pending && !empty) onSubmit()
      }}
    >
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {multiline ? (
          <Textarea
            id={id}
            value={value}
            maxLength={max}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
            className="min-h-28 text-base"
          />
        ) : (
          <Input
            id={id}
            ref={inputRef}
            value={value}
            maxLength={max}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
            className={INPUT}
          />
        )}
      </Field>
      {children}
      <Button
        type="submit"
        size="lg"
        aria-busy={pending || undefined}
        aria-disabled={pending || empty || undefined}
        className={PRIMARY}
      >
        <Busy pending={pending} />
        {submitLabel}
      </Button>
    </form>
  )
}

// Up and down within a list, and what was announced.
export function MoveButtons({
  canUp,
  canDown,
  pending,
  onMove,
}: {
  canUp: boolean
  canDown: boolean
  pending: boolean
  onMove: (delta: -1 | 1) => void
}) {
  if (!canUp && !canDown) return null
  return (
    <div className="flex flex-wrap gap-2">
      {canUp && (
        <button
          type="button"
          className={OUTLINE}
          aria-disabled={pending || undefined}
          onClick={() => !pending && onMove(-1)}
        >
          <ArrowUpIcon aria-hidden strokeWidth={1.5} className="size-5" />
          {copy.moveUp}
        </button>
      )}
      {canDown && (
        <button
          type="button"
          className={OUTLINE}
          aria-disabled={pending || undefined}
          onClick={() => !pending && onMove(1)}
        >
          <ArrowDownIcon aria-hidden strokeWidth={1.5} className="size-5" />
          {copy.moveDown}
        </button>
      )}
    </div>
  )
}

// Delete in two steps inside a sheet: the button, then the question with
// "מחיקה" and "ביטול".
export function DeleteStep({
  label,
  question,
  pending,
  onDelete,
}: {
  label: string
  question: string
  pending: boolean
  onDelete: () => void
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button
        type="button"
        className={cn(TEXT_BUTTON, "self-start text-error")}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    )
  }
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-col gap-3 rounded-lg bg-muted px-4 py-3"
    >
      <p className="font-semibold">{question}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="lg"
          aria-busy={pending || undefined}
          aria-disabled={pending || undefined}
          onClick={() => !pending && onDelete()}
          className="h-11 rounded-[4px] text-[15px] font-semibold"
        >
          <Busy pending={pending} />
          {copy.delete}
        </Button>
        <button
          type="button"
          className={OUTLINE}
          disabled={pending}
          onClick={() => setAsking(false)}
        >
          {copy.cancel}
        </button>
      </div>
    </div>
  )
}
