"use client"

import {
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { SlidersHorizontalIcon } from "lucide-react"

import { buttonClass } from "@/components/shared/button-class"
import { InlineNotice } from "@/components/shared/inline-notice"
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"

import { answerFor, canSearch } from "../payments/new/existing/customer-search"
import {
  searchCustomersAction,
  type CustomerMatch,
} from "../payments/new/actions"
import {
  activeFilterCount,
  auditHref,
  auditKeys,
  filterSummary,
  isFilterDate,
  type AuditFilters,
  type SessionOption,
} from "./audit-data"

const copy = adminCopy.audit
const DEBOUNCE_MS = 300

type FilterProps = {
  filters: AuditFilters
  today: string
  sessions: readonly SessionOption[]
  customerName: string | null
  dateError: "from" | "to" | null
}

// The filters behind one "סינון" button (phone check, 2026-10-10): the list
// is the first thing on the screen. With filters on and the panel closed, one
// line says what is filtered, with "ניקוי סינון". On the desktop the panel
// is always open. This part is not keyed by the URL, so the open state
// survives the navigation a filter change causes; the fields inside are
// keyed (auditKeys) and start from the new filters. A date error keeps the
// panel open so she sees it.
export function AuditFilterPanel({
  href,
  ...props
}: FilterProps & { href: string }) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(props.filters, props.today)
  const summary = filterSummary(
    props.filters,
    props.today,
    props.sessions,
    props.customerName
  )
  const shown = open || props.dateError !== null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 md:hidden">
        <button
          type="button"
          aria-expanded={shown}
          aria-controls={panelId}
          onClick={() => setOpen(!shown)}
          className={buttonClass({
            variant: "outline",
            className:
              "h-11 self-start rounded-[4px] border-foreground px-4 text-base font-semibold",
          })}
        >
          <SlidersHorizontalIcon aria-hidden strokeWidth={1.5} />
          {copy.filterButton(count)}
        </button>
        {!shown && summary && (
          <p className="flex flex-wrap items-baseline gap-x-3 text-[15px] text-muted-foreground">
            <span className="min-w-0 [overflow-wrap:anywhere] break-words">
              {summary}
            </span>
            <Link
              href="/admin/audit"
              className="text-foreground underline underline-offset-4"
            >
              {copy.clearFilters}
            </Link>
          </p>
        )}
      </div>
      <div id={panelId} className={shown ? "block" : "hidden md:block"}>
        <AuditFiltersBar key={auditKeys(href).filters} {...props} />
      </div>
    </div>
  )
}

// The log's filters (story 4.5), all in the URL (?event=&customer=&from=
// &to=): a change navigates, and the server reads the first page again.
// customerName: the chosen customer's name (null: anonymized), read by the
// page. The page keys this by its URL, so the uncontrolled fields start
// from the filters after each navigation.
export function AuditFiltersBar({
  filters,
  today,
  sessions,
  customerName,
  dateError,
}: FilterProps) {
  const id = useId()
  const router = useRouter()
  const [navigating, startNavigation] = useTransition()

  function go(next: Partial<AuditFilters>) {
    startNavigation(() => {
      router.push(auditHref({ ...filters, ...next }, today))
    })
  }

  return (
    <section
      aria-label={copy.filtersLabel}
      aria-busy={navigating || undefined}
      className="flex flex-col gap-5 md:grid md:grid-cols-2 md:items-start md:gap-x-6"
    >
      <Field>
        <FieldLabel htmlFor={`${id}-event`}>{copy.session}</FieldLabel>
        <NativeSelect
          id={`${id}-event`}
          defaultValue={filters.eventId ?? ""}
          onChange={(event) => go({ eventId: event.target.value || null })}
          className="h-12 w-full text-base"
        >
          <NativeSelectOption value="">{copy.allSessions}</NativeSelectOption>
          {sessions.map((session) => (
            <NativeSelectOption key={session.id} value={session.id}>
              {session.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      {filters.customerId ? (
        <Field>
          <FieldTitle id={`${id}-customer-title`}>{copy.customer}</FieldTitle>
          <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-muted px-3">
            <bdi
              id={`${id}-customer-name`}
              className="min-w-0 text-base font-semibold break-words"
            >
              {customerName ?? copy.anonymous}
            </bdi>
            <button
              type="button"
              aria-describedby={`${id}-customer-title ${id}-customer-name`}
              onClick={() => go({ customerId: null })}
              className={buttonClass({
                variant: "link",
                className: "h-11 shrink-0 px-1 text-base",
              })}
            >
              {copy.clearCustomer}
            </button>
          </div>
        </Field>
      ) : (
        <CustomerPicker onPick={(customerId) => go({ customerId })} />
      )}

      <div className="grid grid-cols-2 gap-3 md:col-span-2 md:max-w-md">
        <Field data-invalid={dateError === "from" || undefined}>
          <FieldLabel htmlFor={`${id}-from`}>{copy.from}</FieldLabel>
          <Input
            id={`${id}-from`}
            type="date"
            defaultValue={filters.from}
            onChange={(event) => {
              if (isFilterDate(event.target.value)) {
                go({ from: event.target.value })
              }
            }}
            aria-invalid={dateError === "from" || undefined}
            aria-describedby={dateError ? `${id}-date-error` : undefined}
            className="h-12 text-base"
          />
        </Field>
        <Field data-invalid={dateError === "to" || undefined}>
          <FieldLabel htmlFor={`${id}-to`}>{copy.to}</FieldLabel>
          <Input
            id={`${id}-to`}
            type="date"
            defaultValue={filters.to}
            onChange={(event) => {
              if (isFilterDate(event.target.value)) {
                go({ to: event.target.value })
              }
            }}
            aria-invalid={dateError === "to" || undefined}
            aria-describedby={dateError ? `${id}-date-error` : undefined}
            className="h-12 text-base"
          />
        </Field>
        {dateError && (
          <p
            id={`${id}-date-error`}
            className="col-span-2 text-[15px] text-error"
          >
            {dateError === "to" ? copy.rangeTo : copy.rangeFrom}
          </p>
        )}
      </div>

      <Link
        href="/admin/audit"
        className={buttonClass({
          variant: "link",
          className: "h-11 self-start px-0 text-base md:col-span-2",
        })}
      >
        {copy.clearFilters}
      </Link>
    </section>
  )
}

type Answer =
  | { query: string; ok: true; matches: CustomerMatch[] }
  | { query: string; ok: false; code: ErrorCode }

// Search as she types (admin_search_customers, from 2 characters); a
// result sets the customer filter.
function CustomerPicker({ onPick }: { onPick: (id: string) => void }) {
  const id = useId()
  const [query, setQuery] = useState("")
  const [answer, setAnswer] = useState<Answer | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    const request = ++latest.current
    if (!canSearch(query)) return
    const timer = setTimeout(() => {
      startTransition(async () => {
        let result: Awaited<ReturnType<typeof searchCustomersAction>>
        try {
          result = await searchCustomersAction(query)
        } catch {
          result = { ok: false, code: "SERVER_ERROR" }
        }
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
    <Field>
      <FieldLabel htmlFor={`${id}-q`}>{copy.customerSearch}</FieldLabel>
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
      <FieldDescription id={`${id}-hint`}>
        {copy.customerSearchHint}
      </FieldDescription>
      <div aria-live="polite">
        {shown && !shown.ok && (
          <InlineNotice tone="error">{errorMessage(shown.code)}</InlineNotice>
        )}
        {shown?.ok && shown.matches.length === 0 && (
          <p className="text-base text-muted-foreground">{copy.customerNone}</p>
        )}
        {shown?.ok && shown.matches.length > 0 && (
          <ul className="flex flex-col">
            {shown.matches.map((match) => (
              <li
                key={match.id}
                className="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => onPick(match.id)}
                  aria-label={copy.chooseCustomer(match.name)}
                  className="flex min-h-12 w-full items-center gap-3 py-3 text-start text-base"
                >
                  <bdi className="min-w-0 break-words">{match.name}</bdi>
                  {match.phone && (
                    <bdi dir="ltr" className="text-muted-foreground">
                      {match.phone}
                    </bdi>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  )
}
