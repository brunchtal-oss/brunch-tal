"use client"

import { startTransition, useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"

import { searchCustomersAction, type CustomerMatch } from "../actions"

const copy = adminCopy.payments
const MIN_QUERY = 2
const DEBOUNCE_MS = 300

// A query is sent from 2 characters (after trimming), as the RPC requires.
export function canSearch(query: string): boolean {
  return query.trim().length >= MIN_QUERY
}

// The answer is shown only for the query it answers: while a new query
// waits or runs, the results of the previous one are gone.
export function answerFor<A extends { query: string }>(
  query: string,
  answer: A | null
): A | null {
  return canSearch(query) && answer?.query === query.trim() ? answer : null
}

// Where a result leads: ":id" in the template becomes the customer's id. The
// payment form by default; the manual booking passes its own (story 3.4).
export const PAYMENT_HREF = "/admin/payments/new/existing/:id"

export function resultHref(template: string, id: string): string {
  return template.replace(":id", encodeURIComponent(id))
}

type Answer =
  | { query: string; ok: true; matches: CustomerMatch[] }
  | { query: string; ok: false; code: ErrorCode }

// Search as she types (after a short pause); only the answer to the latest
// query is shown. Each result is one link to the form for that customer (or
// to hrefTemplate).
export function CustomerSearch({
  hrefTemplate = PAYMENT_HREF,
}: {
  hrefTemplate?: string
} = {}) {
  const id = useId()
  const [query, setQuery] = useState("")
  const [answer, setAnswer] = useState<Answer | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    const request = ++latest.current
    if (!canSearch(query)) return
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await searchCustomersAction(query)
        if (request !== latest.current) return
        const asked = query.trim()
        setAnswer(
          result.ok
            ? { query: asked, ok: true, matches: result.data }
            : { query: asked, ok: false, code: result.code }
        )
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const shown = answerFor(query, answer)

  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor={`${id}-q`}>{copy.searchLabel}</FieldLabel>
        <Input
          id={`${id}-q`}
          type="search"
          value={query}
          autoComplete="off"
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          aria-describedby={`${id}-hint`}
          className="h-12 text-base"
        />
        <FieldDescription id={`${id}-hint`}>{copy.searchHint}</FieldDescription>
      </Field>

      <div aria-live="polite">
        {shown && !shown.ok && (
          <InlineNotice tone="error">{errorMessage(shown.code)}</InlineNotice>
        )}
        {shown?.ok && shown.matches.length === 0 && (
          <p className="text-base text-muted-foreground">{copy.searchNone}</p>
        )}
        {shown?.ok && shown.matches.length > 0 && (
          <ul className="flex flex-col">
            {shown.matches.map((match) => (
              <li
                key={match.id}
                className="border-b border-border last:border-b-0"
              >
                <Link
                  href={resultHref(hrefTemplate, match.id)}
                  className="flex min-h-12 items-center justify-between gap-3 py-3 text-base"
                >
                  <bdi className="min-w-0 break-words">
                    {copy.searchResult(match.name, match.phone)}
                  </bdi>
                  <ChevronLeftIcon
                    aria-hidden
                    strokeWidth={1.5}
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
