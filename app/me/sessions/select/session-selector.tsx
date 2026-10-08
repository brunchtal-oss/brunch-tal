"use client"

import { useEffect, useId, useRef, useState } from "react"
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
import { customerCopy as copy } from "@/lib/copy/customer"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import {
  formatAccessibleDate,
  formatDayMonth,
  formatSessionDateTime,
  formatWeekday,
} from "@/lib/time"
import { cn } from "@/lib/utils"

import { bookSessionsAction } from "../actions"
import {
  parseBookResults,
  pruneSelection,
  resultsHeading,
  toggleSelection,
  unavailableReason,
  usesByProduct,
  type DateResult,
  type SelectableSession,
} from "./selection"

const LINK = "font-semibold underline underline-offset-[3px]"

// Choosing several dates with a card (story 3.3, CAP-13; DESIGN.md
// session-row, selection variant; EXPERIENCE.md session-row and
// bottom-sheet). Each row is the <label> of a real checkbox; a date the
// server refused is aria-disabled with its reason; no more than `available`
// dates. The counter and "להמשך" stay above the bottom-tab-bar. One summary
// sheet (the dates, what is used, what remains, no cancel deadline, one
// confirm) with a key made when it opens and a new one after every answer
// (AD-5). The results then replace the selection, and focus moves to their
// heading. Display only: book_sessions decides every date again.
export function SessionSelector({
  sessions,
  available,
}: {
  sessions: SelectableSession[]
  available: number
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [results, setResults] = useState<DateResult[] | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const resultsRef = useRef<HTMLHeadingElement>(null)
  const counterId = useId()

  useEffect(() => {
    if (results) resultsRef.current?.focus()
  }, [results])

  const byId = new Map(sessions.map((s) => [s.id, s]))
  // After a refresh only dates that can still be chosen stay chosen, at most
  // `available`.
  const current = pruneSelection(selected, sessions, available)
  // In the order of the list (by date), whatever the order of the clicks.
  const chosen = sessions.filter((s) => current.includes(s.id))
  const full = current.length >= available

  if (results) {
    return <Results results={results} byId={byId} headingRef={resultsRef} />
  }

  function toggle(session: SelectableSession) {
    setSelected(toggleSelection(current, session.id, available, session.ok))
  }

  async function confirm() {
    if (busy) return
    if (chosen.length === 0) {
      setOpen(false)
      return
    }
    setBusy(true)
    setError(null)
    let answered = false
    let failure: ErrorCode | null = null
    try {
      const result = await bookSessionsAction({
        eventIds: chosen.map((s) => s.id),
        idempotencyKey: key,
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
      // No answer: the server may have booked, so the retry keeps the key.
      failure = "SERVER_ERROR"
    } finally {
      setBusy(false)
    }
    setError(failure)
    // After an answer the next try is a new request (AD-5).
    if (answered) setKey(newIdempotencyKey())
    // The page is read again (balances, chips, which dates can be chosen).
    router.refresh()
  }

  const remaining = available - chosen.length

  return (
    <>
      <fieldset className="min-w-0 pb-40">
        <legend className="sr-only">
          {copy.selectTitle}, {copy.availableEntries(available)}
        </legend>
        <ul className="border-t border-border">
          {sessions.map((session) => {
            const isSelected = current.includes(session.id)
            const blocked = !session.ok
            const capped = !blocked && !isSelected && full
            const reasonId = `${counterId}-${session.id}`
            return (
              <li key={session.id} className="border-b border-border">
                <label
                  className={cn(
                    "relative -mx-2 grid cursor-pointer grid-cols-[24px_64px_1fr] items-start gap-3 rounded-[4px] px-2 py-[22px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    isSelected && "bg-muted",
                    (blocked || capped) && "cursor-not-allowed"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(session)}
                    aria-disabled={blocked || capped || undefined}
                    aria-describedby={
                      blocked ? reasonId : capped ? counterId : undefined
                    }
                    aria-label={`${copy.sessionTitle(session.conceptName)}, ${formatAccessibleDate(session.startsAt)}`}
                    className="peer absolute inset-0 size-full cursor-[inherit] scroll-mb-44 opacity-0 focus-visible:outline-none"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-6 items-center justify-center rounded-[4px] border-[1.5px] border-muted-foreground bg-card text-primary-foreground",
                      isSelected && "border-primary bg-primary",
                      (blocked || capped) && "bg-muted opacity-50"
                    )}
                  >
                    {isSelected && (
                      <CheckIcon strokeWidth={2.5} className="size-4" />
                    )}
                  </span>
                  <span aria-hidden className="text-center leading-none">
                    <span
                      className={cn(
                        "block text-[26px]",
                        blocked && "text-muted-foreground"
                      )}
                    >
                      <bdi>{formatDayMonth(session.startsAt)}</bdi>
                    </span>
                    <span className="mt-2 block text-[13px] text-muted-foreground">
                      {formatWeekday(session.startsAt)}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col items-start gap-1">
                    <span
                      aria-hidden
                      className={cn(
                        "text-base leading-[1.35] font-semibold",
                        blocked && "text-muted-foreground"
                      )}
                    >
                      <bdi>{copy.sessionTitle(session.conceptName)}</bdi>
                    </span>
                    {blocked ? (
                      <span
                        id={reasonId}
                        className="text-[13px] leading-[1.4] text-muted-foreground"
                      >
                        {unavailableReason(session.code)}
                      </span>
                    ) : (
                      session.status && (
                        <StatusChip tone={session.status.tone}>
                          {session.status.text}
                        </StatusChip>
                      )
                    )}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background">
        <div className="mx-auto flex max-w-[720px] flex-col items-center gap-2 px-6 pt-3 pb-2">
          <p
            id={counterId}
            aria-live="polite"
            className="text-[15px] font-semibold"
          >
            {copy.selectedCount(chosen.length, available)}
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
              aria-disabled={chosen.length === 0 || undefined}
              aria-describedby={counterId}
              onClick={() => {
                if (chosen.length === 0) return
                // One key per opening of the sheet (AD-5).
                setKey(newIdempotencyKey())
                setError(null)
                setOpen(true)
              }}
              className={cn(
                "h-12 w-full max-w-xs rounded-[4px] text-base font-semibold",
                chosen.length === 0 && "opacity-50"
              )}
            >
              {copy.continue}
            </Button>
            <SheetContent
              side="bottom"
              showCloseButton={false}
              aria-modal="true"
              initialFocus={titleRef}
              finalFocus={() => results === null}
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
                  {copy.selectedDatesTitle(chosen.length)}
                </SheetTitle>
                <SheetClose
                  aria-label={copy.close}
                  className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
                >
                  <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
                </SheetClose>
              </div>
              <ul className="mt-3 border-t border-border">
                {chosen.map((session) => (
                  <li key={session.id} className="border-b border-border py-3">
                    <p className="leading-[1.35] font-semibold">
                      <time dateTime={session.startsAt}>
                        <bdi>{formatSessionDateTime(session.startsAt)}</bdi>
                      </time>
                    </p>
                    <p className="text-[15px]">
                      <bdi>{copy.sessionTitle(session.conceptName)}</bdi>
                    </p>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted px-4 py-3 text-[15px]">
                <dt className="text-muted-foreground">{copy.uses}</dt>
                <dd className="flex flex-col font-semibold">
                  {usesByProduct(chosen.map((s) => s.productName)).map(
                    ({ product, count }) => (
                      <span key={product}>
                        {copy.usesEntries(count, "")}
                        <bdi>{product}</bdi>
                      </span>
                    )
                  )}
                </dd>
                <dt className="text-muted-foreground">{copy.remaining}</dt>
                <dd className="font-semibold">
                  {copy.remainingValue(Math.max(remaining, 0))}
                </dd>
              </dl>
              {error && (
                <InlineNotice tone="error" className="mt-4">
                  {errorMessage(error)}
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
                {copy.book}
              </Button>
            </SheetContent>
          </Sheet>
          <Link href="/me/sessions" className={cn(LINK, "py-3 text-[15px]")}>
            {copy.clearSelection}
          </Link>
        </div>
      </div>
    </>
  )
}

// The answer per date (EXPERIENCE.md: focus on the results' heading; each
// date with its status as text). All saved: the climax; some: "שמרנו לך n
// מתוך m"; none: "לא הצלחנו". A date not saved says why and that its entry
// stayed in her balance.
function Results({
  results,
  byId,
  headingRef,
}: {
  results: DateResult[]
  byId: Map<string, SelectableSession>
  headingRef: React.RefObject<HTMLHeadingElement | null>
}) {
  const heading = resultsHeading(results)

  return (
    <section
      aria-labelledby="booking-results"
      className="flex flex-col gap-4 py-2 pb-8"
    >
      <span aria-hidden className="h-px w-8 bg-brand-accent" />
      <h2
        id="booking-results"
        ref={headingRef}
        tabIndex={-1}
        className={cn("font-heading text-[26px] leading-[1.2] font-light")}
      >
        {heading}
      </h2>
      <ul className="border-t border-border">
        {results.map((result) => {
          const session = byId.get(result.eventId)
          return (
            <li
              key={result.eventId}
              className="flex flex-col gap-1 border-b border-border py-4"
            >
              <div className="flex items-center justify-between gap-3">
                {session ? (
                  <time
                    dateTime={session.startsAt}
                    className="leading-[1.35] font-semibold"
                  >
                    <bdi>{formatSessionDateTime(session.startsAt)}</bdi>
                  </time>
                ) : (
                  <span />
                )}
                <StatusChip tone={result.ok ? "success" : "expired"}>
                  {result.ok ? copy.saved : copy.notSaved}
                </StatusChip>
              </div>
              {session && (
                <p className="text-[15px]">
                  <bdi>{copy.sessionTitle(session.conceptName)}</bdi>
                </p>
              )}
              {!result.ok && (
                <p className="text-[15px] text-muted-foreground">
                  {errorMessage(result.code ?? "SERVER_ERROR")}
                  {/* Already booked: that date's entry was used before. */}
                  {session && result.code !== "ALREADY_BOOKED" && (
                    <> {copy.entryKept(formatDayMonth(session.startsAt))}</>
                  )}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap gap-x-6">
        <Link href="/me" className={cn(LINK, "py-3")}>
          {copy.toMyBalance}
        </Link>
        <Link href="/me/sessions" className={cn(LINK, "py-3")}>
          {copy.allSessions}
        </Link>
      </div>
    </section>
  )
}
