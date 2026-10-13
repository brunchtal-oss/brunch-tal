"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckIcon, XIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { StatusChip } from "@/components/shared/status-chip"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import type { ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import {
  parseBookResults,
  toggleSelection,
  type DateResult,
} from "@/app/me/sessions/select/selection"
import { previewAdminBookAction } from "../actions"
import { buttonClass } from "@/components/shared/button-class"

import {
  refusalAction,
  refusalMessage,
  type BookPreview,
} from "../[id]/book/preview"
import { adminBookSessionsAction } from "./actions"
import {
  previewLine,
  resultItems,
  resultsHeading,
  selectionCap,
} from "./booking-results"

const copy = adminCopy.sessions
const many = copy.bookMany

export type BookRow = {
  id: string
  title: string
  // "{day} · {occupied}/{capacity}" (or full), as before.
  details: string
  dateTime: string
  // She already has a confirmed booking: a static row with "רשומה".
  booked: boolean
}

type PreviewState = BookPreview | "loading" | "failed"

// The manual booking list of one customer (story 4.3, user decision
// 2026-10-13; DESIGN.md session-row, selection variant, and bottom-sheet).
// Each row she is not booked for is the <label> of a real checkbox, up to
// her free entries and never above 20 (the selection cap, user decision
// 2026-10-13); with none, no checkboxes and a notice with the payment link. The bar above the bottom-tab-bar opens one sheet: per chosen date
// what funds it or why not (preview_admin_book_customer), and one confirm.
// One key per date, made when the sheet opens, kept on a retry without an
// answer, new after an answer (AD-5). The results then replace the list,
// focus on their heading; "חזרה לרשימה" reads the page again.
export function MultiBooking({
  customer,
  rows,
  freeEntries,
}: {
  customer: { id: string; name: string }
  rows: BookRow[]
  // Her free entries (loadFreeEntries): the selection cap, never above 20.
  freeEntries: number
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [results, setResults] = useState<DateResult[] | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const resultsRef = useRef<HTMLHeadingElement>(null)
  // Each opening of the sheet; a preview of an older opening is ignored.
  const opening = useRef(0)
  const [returning, startReturn] = useTransition()
  const counterId = useId()
  const cap = selectionCap(freeEntries)

  useEffect(() => {
    if (results) resultsRef.current?.focus()
  }, [results])

  const byId = new Map(rows.map((row) => [row.id, row]))
  // After a refresh only rows still open for booking stay chosen.
  // At most `cap` (her free entries may have dropped after a refresh).
  const current = selected
    .filter((id) => byId.get(id)?.booked === false)
    .slice(0, cap)
  // In the order of the list (by date).
  const chosen = rows.filter((row) => current.includes(row.id))
  const full = current.length >= cap

  if (results) {
    return (
      <Results
        results={results}
        byId={byId}
        headingRef={resultsRef}
        customerId={customer.id}
        returning={returning}
        onBack={() => {
          // The results stay until the list is read again, so a date just
          // booked never shows as a checkbox in between.
          startReturn(() => {
            router.refresh()
            setResults(null)
            setSelected([])
          })
        }}
      />
    )
  }

  function openSheet() {
    if (chosen.length === 0) return
    // One key per date, kept until an answer arrives (a request without an
    // answer may have booked), then replaced (AD-5).
    setKeys((prev) =>
      Object.fromEntries(
        chosen.map((row) => [row.id, prev[row.id] ?? newIdempotencyKey()])
      )
    )
    const tag = ++opening.current
    setError(null)
    setPreviews(Object.fromEntries(chosen.map((row) => [row.id, "loading"])))
    setOpen(true)
    for (const row of chosen) {
      previewAdminBookAction({ customerId: customer.id, eventId: row.id })
        .then((result): PreviewState =>
          result.ok
            ? result.data
            : { ok: false, code: result.code, occupied: null, capacity: null }
        )
        .catch((): PreviewState => "failed")
        .then((state) => {
          if (tag !== opening.current) return
          setPreviews((prev) => ({ ...prev, [row.id]: state }))
        })
    }
  }

  async function confirm() {
    if (busy || chosen.length === 0) return
    setBusy(true)
    setError(null)
    let answered = false
    let failure: ErrorCode | null = null
    try {
      const result = await adminBookSessionsAction({
        customerId: customer.id,
        items: chosen.map((row) => ({
          eventId: row.id,
          idempotencyKey: keys[row.id] ?? newIdempotencyKey(),
        })),
      })
      answered = true
      const parsed = result.ok ? parseBookResults(result.data) : null
      if (parsed) {
        setOpen(false)
        setResults(parsed)
      } else {
        failure = result.ok ? "SERVER_ERROR" : result.code
      }
    } catch {
      // No answer: the server may have booked, so a retry keeps the keys.
      failure = "SERVER_ERROR"
    } finally {
      setBusy(false)
    }
    setError(failure)
    // After an answer the next try is a new request (AD-5).
    if (answered) setKeys({})
  }

  return (
    <>
      <p className="text-base font-semibold">{many.freeEntries(freeEntries)}</p>
      {cap === 0 && (
        <InlineNotice
          tone="warning"
          actions={
            <Link
              href={`/admin/payments/new/existing/${customer.id}`}
              className={buttonClass({
                variant: "outline",
                size: "lg",
                className: "h-11 text-base",
              })}
            >
              {copy.addPayment}
            </Link>
          }
        >
          {refusalMessage("NO_MATCHING_ENTITLEMENT")}
        </InlineNotice>
      )}
      <fieldset className={cn("min-w-0", chosen.length > 0 && "pb-36")}>
        <legend className="sr-only">{copy.chooseSession}</legend>
        <ul className="flex flex-col border-t border-border">
          {rows.map((row) => {
            const details = (
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-base font-semibold break-words">
                  <bdi>{row.title}</bdi>
                </span>
                <span className="text-[13px] text-muted-foreground">
                  <time dateTime={row.dateTime}>
                    <bdi>{row.details}</bdi>
                  </time>
                </span>
              </span>
            )
            if (row.booked || cap === 0) {
              // Booked: "רשומה". No free entries: no checkbox.
              return (
                <li key={row.id} className="border-b border-border">
                  <div className="flex min-h-14 items-center justify-between gap-3 py-3">
                    {details}
                    {row.booked && (
                      <StatusChip tone="booked" className="shrink-0">
                        {adminCopy.customers.card.bookingStatus.confirmed}
                      </StatusChip>
                    )}
                  </div>
                </li>
              )
            }
            const isSelected = current.includes(row.id)
            const capped = !isSelected && full
            return (
              <li key={row.id} className="border-b border-border">
                <label
                  className={cn(
                    "relative -mx-2 flex min-h-14 cursor-pointer items-center gap-3 rounded-[4px] px-2 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    isSelected && "bg-muted",
                    capped && "cursor-not-allowed"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() =>
                      setSelected(toggleSelection(current, row.id, cap))
                    }
                    aria-disabled={capped || undefined}
                    aria-describedby={capped ? counterId : undefined}
                    className="peer absolute inset-0 size-full cursor-[inherit] scroll-mb-32 opacity-0 focus-visible:outline-none"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-muted-foreground bg-card text-primary-foreground",
                      isSelected && "border-primary bg-primary",
                      capped && "bg-muted opacity-50"
                    )}
                  >
                    {isSelected && (
                      <CheckIcon strokeWidth={2.5} className="size-4" />
                    )}
                  </span>
                  {details}
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>

      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background lg:start-60 lg:bottom-0">
          <div className="mx-auto flex max-w-[720px] flex-col items-center gap-2 px-6 py-3">
            <p
              id={counterId}
              aria-live="polite"
              className="text-[15px] font-semibold"
            >
              {many.selectedCount(chosen.length, cap)}
            </p>
            <Sheet
              open={open}
              onOpenChange={(next) => {
                // The sheet stays open while the dates are on their way.
                if (!busy) setOpen(next)
              }}
            >
              <Button
                type="button"
                size="lg"
                onClick={openSheet}
                className="h-12 w-full max-w-xs rounded-[4px] text-base font-semibold"
              >
                {many.choose(chosen.length)}
              </Button>
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
                    <bdi>{many.sheetTitle(customer.name)}</bdi>
                  </SheetTitle>
                  <SheetClose
                    aria-label={many.close}
                    className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
                  >
                    <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
                  </SheetClose>
                </div>
                <ul className="mt-3 border-t border-border">
                  {chosen.map((row) => {
                    const state = previews[row.id] ?? "loading"
                    const line =
                      state === "loading"
                        ? null
                        : state === "failed"
                          ? { ok: false, text: refusalMessage("SERVER_ERROR") }
                          : previewLine(state)
                    return (
                      <li
                        key={row.id}
                        className="flex flex-col gap-1 border-b border-border py-3"
                      >
                        <p className="leading-[1.35] font-semibold">
                          <bdi>{row.title}</bdi>
                        </p>
                        <p className="text-[13px] text-muted-foreground">
                          <time dateTime={row.dateTime}>
                            <bdi>{row.details}</bdi>
                          </time>
                        </p>
                        {line ? (
                          <p
                            className={cn(
                              "text-[15px] font-semibold",
                              !line.ok && "text-warning"
                            )}
                          >
                            <bdi>{line.text}</bdi>
                          </p>
                        ) : (
                          <p className="text-[15px] text-muted-foreground">
                            {shellCopy.loading}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {error && (
                  <InlineNotice tone="error" className="mt-4">
                    {refusalMessage(error)}
                  </InlineNotice>
                )}
                <Button
                  type="button"
                  size="lg"
                  onClick={confirm}
                  aria-busy={busy || undefined}
                  aria-disabled={busy || undefined}
                  className="mt-6 h-12 w-full rounded-[4px] text-base font-semibold"
                >
                  {busy && <Spinner aria-hidden />}
                  {many.confirm}
                </Button>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      )}
    </>
  )
}

// The answer per date: "נשמר" or "לא נשמר" with the reason, then back to
// the list.
function Results({
  results,
  byId,
  headingRef,
  customerId,
  returning,
  onBack,
}: {
  results: DateResult[]
  byId: Map<string, BookRow>
  headingRef: React.RefObject<HTMLHeadingElement | null>
  customerId: string
  returning: boolean
  onBack: () => void
}) {
  return (
    <section aria-labelledby="booking-results" className="flex flex-col gap-4">
      <h2
        id="booking-results"
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-[22px] leading-[1.25] font-light"
      >
        {resultsHeading(results)}
      </h2>
      <ul className="border-t border-border">
        {resultItems(results).map((item, i) => {
          const row = byId.get(item.eventId)
          // What a refusal offers, as on the single-date screen.
          const code = results[i].code
          const action = !item.ok && code ? refusalAction(code) : null
          return (
            <li
              key={item.eventId}
              className="flex flex-col gap-1 border-b border-border py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col gap-1">
                  {row && (
                    <span className="text-base font-semibold break-words">
                      <bdi>{row.title}</bdi>
                    </span>
                  )}
                  {row && (
                    <span className="text-[13px] text-muted-foreground">
                      <time dateTime={row.dateTime}>
                        <bdi>{row.details}</bdi>
                      </time>
                    </span>
                  )}
                </span>
                <StatusChip
                  tone={item.ok ? "success" : "expired"}
                  className="shrink-0"
                >
                  {item.status}
                </StatusChip>
              </div>
              {item.reason && (
                <p className="text-[15px] text-muted-foreground">
                  {item.reason}
                </p>
              )}
              {action && (
                <Link
                  href={
                    action === "payment"
                      ? `/admin/payments/new/existing/${customerId}`
                      : `/admin/sessions/${item.eventId}/edit`
                  }
                  className={buttonClass({
                    variant: "outline",
                    size: "lg",
                    className: "mt-1 h-11 self-start text-base",
                  })}
                >
                  {action === "payment" ? copy.addPayment : copy.raiseCapacity}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => {
          if (!returning) onBack()
        }}
        aria-busy={returning || undefined}
        aria-disabled={returning || undefined}
        className="h-12 self-start rounded-[4px] border-foreground px-6 text-base font-semibold"
      >
        {returning && <Spinner aria-hidden />}
        {many.backToList}
      </Button>
    </section>
  )
}
