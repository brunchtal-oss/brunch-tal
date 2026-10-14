"use client"

import { useId, useRef, useState } from "react"
import { DownloadIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { TEXT_BUTTON, WorkPanel } from "@/components/admin/edit-kit"
import { RadioCardGroup } from "@/components/admin/radio-card"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import {
  EXPORT_COLUMN_KEYS,
  EXPORT_COLUMNS,
  errorCodeOf,
  exportFileName,
  exportHref,
  exportRequest,
  type ExportColumn,
  type ExportScope,
  type ShownSearch,
} from "@/lib/admin/customer-export"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { localToday } from "@/lib/time"

const copy = adminCopy.customers.export

type Notice = { ok: true } | { ok: false; code: ErrorCode | string }

// "ייצוא" on /admin/customers (story 4.4, CAP-25; EXPERIENCE › לקוחות ›
// ייצוא CSV): a bottom sheet with the scope and the closed column list (all
// checked). The file comes through fetch -> blob -> <a download>, so the
// button locks while it is prepared and the result stays in an
// inline-notice inside the sheet.
export function CustomerExport({ search }: { search: ShownSearch | null }) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<ExportScope>("all")
  const [columns, setColumns] = useState<ExportColumn[]>([
    ...EXPORT_COLUMN_KEYS,
  ])
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const busy = useRef(false)

  async function download() {
    if (busy.current || columns.length === 0) return
    busy.current = true
    setPending(true)
    setNotice(null)
    try {
      const response = await fetch(
        exportHref(exportRequest(search, scope, columns)),
        { cache: "no-store" }
      )
      if (!response.ok) {
        setNotice({ ok: false, code: await errorCodeOf(response) })
        return
      }
      saveBlob(await response.blob(), exportFileName(localToday()))
      setNotice({ ok: true })
    } catch {
      setNotice({ ok: false, code: "SERVER_ERROR" })
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={cn(TEXT_BUTTON, "gap-2 self-start")}
        onClick={() => {
          // A fresh sheet: the shown search when there is one, every column,
          // no old result.
          setScope(search ? "search" : "all")
          setColumns([...EXPORT_COLUMN_KEYS])
          setNotice(null)
          setOpen(true)
        }}
      >
        <DownloadIcon aria-hidden strokeWidth={1.5} className="size-5" />
        {copy.button}
      </button>
      <WorkPanel
        open={open}
        onOpenChange={setOpen}
        busy={pending}
        title={copy.title}
      >
        <ExportForm
          search={search}
          scope={search ? scope : "all"}
          onScopeChange={setScope}
          columns={columns}
          onColumnsChange={setColumns}
          pending={pending}
          notice={notice}
          onSubmit={download}
        />
      </WorkPanel>
    </>
  )
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Late enough for Safari and Firefox to have read the file.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// The sheet's body: scope, columns, the result and the one primary button.
// Without a column the button is aria-disabled with the reason under it.
export function ExportForm({
  search,
  scope,
  onScopeChange,
  columns,
  onColumnsChange,
  pending,
  notice,
  onSubmit,
}: {
  search: ShownSearch | null
  scope: ExportScope
  onScopeChange: (scope: ExportScope) => void
  columns: readonly ExportColumn[]
  onColumnsChange: (columns: ExportColumn[]) => void
  pending: boolean
  notice: Notice | null
  onSubmit: () => void
}) {
  const id = useId()
  const reasonId = `${id}-reason`
  const empty = columns.length === 0
  const scopes = [
    { value: "all", label: copy.scopeAll },
    ...(search
      ? [{ value: "search", label: copy.scopeSearch(search.count) }]
      : []),
  ]

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <RadioCardGroup
        legend={copy.scopeLegend}
        name={`${id}-scope`}
        options={scopes}
        value={scope}
        onChange={(value) => onScopeChange(value as ExportScope)}
      />

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 text-[15px] font-semibold">
          {copy.columnsLegend}
        </legend>
        {EXPORT_COLUMN_KEYS.map((key) => {
          const boxId = `${id}-${key}`
          return (
            <div key={key} className="flex min-h-11 items-center gap-3">
              <Checkbox
                id={boxId}
                checked={columns.includes(key)}
                onCheckedChange={(next) =>
                  onColumnsChange(
                    EXPORT_COLUMN_KEYS.filter((k) =>
                      k === key ? next === true : columns.includes(k)
                    )
                  )
                }
                className="size-6 rounded-[4px] border-[1.5px] border-muted-foreground"
              />
              <label htmlFor={boxId} className="text-base">
                {EXPORT_COLUMNS[key].header}
              </label>
            </div>
          )
        })}
      </fieldset>

      <div aria-live="polite">
        {notice?.ok && <InlineNotice tone="success">{copy.done}</InlineNotice>}
        {notice && !notice.ok && (
          <InlineNotice tone="error">{errorMessage(notice.code)}</InlineNotice>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          size="lg"
          className="h-12 rounded-[4px] text-base font-semibold"
          aria-busy={pending || undefined}
          aria-disabled={pending || empty || undefined}
          aria-describedby={empty ? reasonId : undefined}
        >
          {pending && <Spinner aria-hidden />}
          {copy.button}
        </Button>
        {empty && (
          <p id={reasonId} className="text-[15px] text-muted-foreground">
            {copy.noColumns}
          </p>
        )}
      </div>
    </form>
  )
}
