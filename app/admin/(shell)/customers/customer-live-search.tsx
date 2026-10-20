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
import { cn } from "@/lib/utils"

import { listCustomersAction } from "./actions"
import { CustomerExport } from "./export-sheet"
import {
  answerForFilter,
  categoryHref,
  CUSTOMER_ACTIVITIES,
  emptyText,
  LIST_LIMIT,
  listHref,
  listRequest,
  QUERY_MAX,
  shownList,
  toCustomerItem,
  type CustomerActivity,
  type CustomerList,
  type ListRequest,
} from "./customer-items"

const copy = adminCopy.customers
const DEBOUNCE_MS = 300

type Answer = ListRequest &
  ({ ok: true; list: CustomerList } | { ok: false; code: ErrorCode })

// The live search (phone check, user decision 2026-10-07) and the three
// category buttons (story 5.13, user decision 2026-10-20). The screen opens
// with the field alone. From 2 characters the results follow her typing
// after a short pause, over every customer, with no button selected; q is
// kept in the URL (history.replaceState), so "back" from a card returns to
// the search. A button (a link to ?activity=) lists its whole category and
// clears the field; clearing the field returns to the open category. Only
// the answer to the current request is shown; an inactive customer's row
// carries "לא פעילה".
export function CustomerLiveSearch({
  initialQuery,
  category,
}: {
  initialQuery: string
  category: CustomerActivity | null
}) {
  const id = useId()
  const [query, setQuery] = useState(initialQuery)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const latest = useRef(0)

  const request = listRequest(query, category)
  const askedQuery = request?.query ?? null
  const askedActivity = request?.activity ?? null

  useEffect(() => {
    const call = ++latest.current
    if (askedQuery === null || askedActivity === null) return
    const timer = setTimeout(
      () => {
        startTransition(async () => {
          let result: Awaited<ReturnType<typeof listCustomersAction>>
          try {
            result = await listCustomersAction(askedQuery, askedActivity)
          } catch {
            result = { ok: false, code: "SERVER_ERROR" }
          }
          if (call !== latest.current) return
          const asked = { query: askedQuery, activity: askedActivity }
          setAnswer(
            result.ok
              ? { ...asked, ok: true, list: result.data }
              : { ...asked, ok: false, code: result.code }
          )
        })
      },
      // A category answers at once; a search waits for a pause in typing.
      askedQuery === "" ? 0 : DEBOUNCE_MS
    )
    return () => clearTimeout(timer)
  }, [askedQuery, askedActivity])

  const shown = answerForFilter(request, answer)
  // A button is selected only while its category is what the list shows.
  const selected = request?.query === "" ? request.activity : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
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
              // a server round trip on every key. An empty field returns to
              // the open category.
              window.history.replaceState(
                null,
                "",
                next.trim() === "" && category
                  ? categoryHref(category)
                  : listHref(next)
              )
            }}
            aria-describedby={`${id}-hint`}
            className="h-12 text-base"
          />
          <FieldDescription id={`${id}-hint`}>
            {copy.searchHint}
          </FieldDescription>
        </Field>
        <Categories current={selected} onPick={() => setQuery("")} />
        <CustomerExport shown={shownList(request, shown?.ok ? shown : null)} />
      </div>

      <div aria-live="polite">
        {shown && !shown.ok && (
          <InlineNotice tone="error">{errorMessage(shown.code)}</InlineNotice>
        )}
        {shown?.ok && shown.list.customers.length === 0 && (
          <p className="text-base text-muted-foreground">{emptyText(shown)}</p>
        )}
        {shown?.ok && shown.list.customers.length > 0 && (
          <ResultList list={shown.list} category={shown.query === ""} />
        )}
      </div>
    </div>
  )
}

// The three category buttons: one row of equal links in the open cards'
// chip style (story 4.3), in reading order; the selected one in primary with
// aria-current. A tap clears the field (a new category also remounts the
// screen, page.tsx).
function Categories({
  current,
  onPick,
}: {
  current: CustomerActivity | null
  onPick: () => void
}) {
  return (
    <nav aria-label={copy.categoriesNav}>
      <ul className="grid grid-cols-3 gap-2">
        {CUSTOMER_ACTIVITIES.map((value) => (
          <li key={value} className="flex">
            <Link
              href={categoryHref(value)}
              onClick={onPick}
              aria-current={value === current ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center rounded-[4px] border px-2 text-center text-[15px] leading-tight font-semibold",
                value === current
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground text-foreground hover:bg-muted"
              )}
            >
              {copy.categories[value]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// One quiet row per customer, no dividers: the name, then the phone and
// the last activity on one muted line. The whole row is one link.
function ResultList({
  list,
  category,
}: {
  list: CustomerList
  category: boolean
}) {
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
                    {item.inactive && (
                      <StatusChip tone="expired">{copy.inactive}</StatusChip>
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
          {category
            ? copy.hasMoreCategory(LIST_LIMIT)
            : copy.hasMore(LIST_LIMIT)}
        </p>
      )}
    </div>
  )
}
