"use client"

import { startTransition, useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { StatusChip } from "@/components/shared/status-chip"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { formatLocalDate } from "@/lib/time"

import { answerFor, canSearch } from "../payments/new/existing/customer-search"
import { listCustomersAction } from "./actions"
import {
  LIST_LIMIT,
  listHref,
  QUERY_MAX,
  toCustomerItem,
  type CustomerList,
} from "./customer-items"

const copy = adminCopy.customers
const DEBOUNCE_MS = 300

type Answer =
  | { query: string; ok: true; list: CustomerList }
  | { query: string; ok: false; code: ErrorCode }

// The live search (phone check, user decision 2026-10-07): no list until
// she types; from 2 characters the results follow her typing after a short
// pause, and only the answer to the latest query is shown. q is kept in
// the URL (history.replaceState), so "back" from a card returns to the search.
export function CustomerLiveSearch({ initialQuery }: { initialQuery: string }) {
  const id = useId()
  const [query, setQuery] = useState(initialQuery)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    const request = ++latest.current
    if (!canSearch(query)) return
    const timer = setTimeout(() => {
      startTransition(async () => {
        let result: Awaited<ReturnType<typeof listCustomersAction>>
        try {
          result = await listCustomersAction(query)
        } catch {
          result = { ok: false, code: "SERVER_ERROR" }
        }
        if (request !== latest.current) return
        const asked = query.trim()
        setAnswer(
          result.ok
            ? { query: asked, ok: true, list: result.data }
            : { query: asked, ok: false, code: result.code }
        )
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const shown = answerFor(query, answer)

  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldLabel htmlFor={`${id}-q`}>{copy.searchLabel}</FieldLabel>
        <Input
          id={`${id}-q`}
          type="search"
          value={query}
          autoComplete="off"
          maxLength={QUERY_MAX}
          onChange={(event) => {
            const next = event.target.value
            setQuery(next)
            // Next.js syncs history.replaceState with its router, without
            // a server round trip on every key.
            window.history.replaceState(null, "", listHref(next))
          }}
          aria-describedby={`${id}-hint`}
          className="h-12 text-base"
        />
        <FieldDescription id={`${id}-hint`}>{copy.searchHint}</FieldDescription>
      </Field>

      <div aria-live="polite">
        {shown && !shown.ok && (
          <InlineNotice tone="error">{errorMessage(shown.code)}</InlineNotice>
        )}
        {shown?.ok && shown.list.customers.length === 0 && (
          <p className="text-base text-muted-foreground">{copy.empty}</p>
        )}
        {shown?.ok && shown.list.customers.length > 0 && (
          <ResultList list={shown.list} />
        )}
      </div>
    </div>
  )
}

// One quiet row per customer, no dividers: the name, then the phone and
// the last activity on one muted line. The whole row is one link.
function ResultList({ list }: { list: CustomerList }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="-mx-3 flex flex-col gap-1">
        {list.customers.map((row) => {
          const item = toCustomerItem(row)
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-3 hover:bg-muted active:bg-muted"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <bdi className="text-base font-semibold break-words">
                      {item.name}
                    </bdi>
                    {item.notActivated && (
                      <StatusChip tone="pending">
                        {copy.notActivated}
                      </StatusChip>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-[15px] text-muted-foreground">
                    {item.phone && <bdi dir="ltr">{item.phone}</bdi>}
                    {item.activityOn ? (
                      <time dateTime={formatLocalDate(item.activityOn)}>
                        {item.activity}
                      </time>
                    ) : (
                      <span>{item.activity}</span>
                    )}
                  </span>
                </span>
                <ChevronLeftIcon
                  aria-hidden
                  strokeWidth={1.5}
                  className="size-5 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          )
        })}
      </ul>
      {list.has_more && (
        <p className="text-[13px] text-muted-foreground">
          {copy.hasMore(LIST_LIMIT)}
        </p>
      )}
    </div>
  )
}
