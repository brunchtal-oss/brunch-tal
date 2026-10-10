"use client"

import { useState, useTransition } from "react"
import Link from "next/link"

import { buttonClass } from "@/components/shared/button-class"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"

import { loadAuditAction } from "./actions"
import type {
  AuditChange,
  AuditFilters,
  AuditItem,
  AuditView,
} from "./audit-data"

const copy = adminCopy.audit

// The log's rows and "טעינת עוד" (story 4.5). The first page comes from
// the server; each "טעינת עוד" appends the next 50. The page keys this
// component by its filters, so a new filter starts from its first page.
export function AuditList({
  filters,
  initial,
}: {
  filters: AuditFilters
  initial: AuditView
}) {
  const [items, setItems] = useState(initial.items)
  const [next, setNext] = useState(initial.next)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, startTransition] = useTransition()

  function loadMore() {
    if (!next || pending) return
    setError(null)
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof loadAuditAction>>
      try {
        result = await loadAuditAction(filters, next)
      } catch {
        result = { ok: false, code: "SERVER_ERROR" }
      }
      if (!result.ok) {
        setError(result.code)
        return
      }
      setItems((current) => [...current, ...result.data.items])
      setNext(result.data.next)
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <AuditEntries items={items} />
      <div aria-live="polite" className="flex flex-col gap-3">
        {error && (
          <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>
        )}
      </div>
      {next && (
        <button
          type="button"
          onClick={loadMore}
          aria-disabled={pending || undefined}
          className={buttonClass({
            variant: "outline",
            size: "lg",
            className:
              "h-12 w-full rounded-[4px] border-foreground px-6 text-base font-semibold sm:w-auto sm:self-start",
          })}
        >
          {pending && <Spinner aria-hidden />}
          {copy.loadMore}
        </button>
      )}
    </div>
  )
}

// The rows: stacked on the phone (each reads without horizontal scroll),
// a table on the desktop (EXPERIENCE: long work is planned for the desktop).
export function AuditEntries({ items }: { items: readonly AuditItem[] }) {
  return (
    <>
      <ol className="flex flex-col md:hidden">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-1.5 border-b border-border py-4 first:pt-0 last:border-b-0"
          >
            <p className="flex flex-wrap gap-x-2 text-[13px] text-muted-foreground">
              <time dateTime={item.createdAt}>{item.when}</time>
              <span>{item.actor}</span>
            </p>
            <p className="text-base font-semibold break-words">{item.action}</p>
            <About item={item} className="text-[15px] text-muted-foreground" />
            {item.changes.length > 0 && (
              <Changes changes={item.changes} className="mt-1" />
            )}
            {item.reason && (
              <p className="text-[15px] [overflow-wrap:anywhere] break-words">
                {copy.reason(item.reason)}
              </p>
            )}
          </li>
        ))}
      </ol>

      <table className="hidden w-full border-collapse text-start text-[15px] md:table">
        <caption className="sr-only">{copy.title}</caption>
        <thead>
          <tr className="border-b border-foreground text-[13px] text-muted-foreground">
            <th scope="col" className="py-2 pe-4 text-start font-normal">
              {copy.columns.when}
            </th>
            <th scope="col" className="py-2 pe-4 text-start font-normal">
              {copy.columns.who}
            </th>
            <th scope="col" className="py-2 pe-4 text-start font-normal">
              {copy.columns.action}
            </th>
            <th scope="col" className="py-2 pe-4 text-start font-normal">
              {copy.columns.about}
            </th>
            <th scope="col" className="py-2 pe-4 text-start font-normal">
              {copy.columns.changes}
            </th>
            <th scope="col" className="py-2 text-start font-normal">
              {copy.columns.reason}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border align-top">
              <td className="py-3 pe-4 whitespace-nowrap text-muted-foreground">
                <time dateTime={item.createdAt}>{item.when}</time>
              </td>
              <td className="py-3 pe-4 whitespace-nowrap">{item.actor}</td>
              <td className="py-3 pe-4 font-semibold">{item.action}</td>
              <td className="py-3 pe-4">
                <About item={item} className="flex-col gap-0.5" />
              </td>
              <td className="py-3 pe-4">
                <Changes changes={item.changes} />
              </td>
              <td className="py-3 [overflow-wrap:anywhere] break-words">
                {item.reason ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function About({ item, className }: { item: AuditItem; className?: string }) {
  if (!item.customer && !item.session) return null
  return (
    <p className={`flex flex-wrap gap-x-3 break-words ${className ?? ""}`}>
      {item.customer && <bdi>{item.customer}</bdi>}
      {item.session && <bdi>{item.session}</bdi>}
    </p>
  )
}

// "{שדה}: {ישן} ← {חדש}"; an add shows only the new value, a delete only
// the old one (struck through).
function Changes({
  changes,
  className,
}: {
  changes: readonly AuditChange[]
  className?: string
}) {
  return (
    <ul className={`flex flex-col gap-1 text-[15px] ${className ?? ""}`}>
      {changes.map((change) => (
        <li key={change.key} className="[overflow-wrap:anywhere] break-words">
          <ChangeText change={change} />
        </li>
      ))}
    </ul>
  )
}

function ChangeText({ change }: { change: AuditChange }) {
  if (change.kind === "add") {
    return <span>{`${change.field}: ${change.after}`}</span>
  }
  if (change.kind === "delete") {
    return (
      <span>
        {`${change.field}: `}
        <s className="text-muted-foreground">{change.before}</s>
      </span>
    )
  }
  return (
    <span>
      {adminCopy.valueChange.change(change.field, change.before, change.after)}
    </span>
  )
}

// empty-state (DESIGN › empty-state): the sentence and one action.
export function EmptyAudit() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg bg-muted px-4 py-6 text-center">
      <p className="font-heading text-[22px] leading-[1.3] font-light text-balance">
        {copy.empty}
      </p>
      <Link
        href="/admin/audit"
        className={buttonClass({
          variant: "default",
          size: "lg",
          className:
            "h-12 w-full rounded-[4px] px-6 text-base font-semibold sm:w-auto",
        })}
      >
        {copy.clearFilters}
      </Link>
    </div>
  )
}
