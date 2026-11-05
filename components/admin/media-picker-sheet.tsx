"use client"

import { useEffect, useId, useRef, useState } from "react"
import Image from "next/image"
import { SearchIcon } from "lucide-react"

import {
  copyMediaAction,
  listMediaAction,
  type MediaChoice,
} from "@/app/admin/(shell)/media/actions"
import { WorkPanel } from "@/components/admin/edit-kit"
import { InlineNotice } from "@/components/shared/inline-notice"
import { useOnlineGuard } from "@/components/shared/online-button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { objectPosition } from "@/lib/media/photo"

const copy = adminCopy.image

export type ChosenMedia = {
  mediaId: string
  previewUrl: string | null
  alt: string
  focusX: number
  focusY: number
}

export type Load =
  | { state: "loading" }
  | { state: "failed"; code: string }
  | { state: "ready"; items: MediaChoice[] }

// A Hebrew geresh and gershayim match the ASCII apostrophe and quote
// people type ("צ'יפס" finds "צ׳יפס", and the other way round).
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u05F3/g, "'")
    .replace(/\u05F4/g, '"')
}

// Only the alt text is searched: trimmed, case and spacing ignored.
export function matchesSearch(item: MediaChoice, query: string): boolean {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const alt = normalize(item.alt)
  return words.every((word) => alt.includes(word))
}

// The idempotency key of a source: one per source for the field's life, so
// choosing the same image again after a failure (even after closing and
// reopening the sheet) continues the same copy (AD-5); another image gets
// its own key.
export function keyFor(keys: Map<string, string>, sourceId: string): string {
  let key = keys.get(sourceId)
  if (!key) {
    key = newIdempotencyKey()
    keys.set(sourceId, key)
  }
  return key
}

// What a choice gives the field: the new row, the tile's alt and focus, and
// the copy's preview (the tile's own picture when it was not signed).
export function chosenFrom(
  item: MediaChoice,
  result: { mediaId: string; previewUrl: string | null }
): ChosenMedia {
  return {
    mediaId: result.mediaId,
    previewUrl: result.previewUrl ?? item.url,
    alt: item.alt,
    focusX: item.focusX,
    focusY: item.focusY,
  }
}

// The "choose from the images on the site" sheet (fix-media-picker, user
// decision 2026-11-05; DESIGN › bottom-sheet). The images on the site now,
// newest first, as a grid of square thumbnails; a search by alt text; one tap
// chooses. Choosing makes a copy (copyMediaAction), so the place gets its
// own row: its alt and focus come pre-filled and stay its own. A tile asks
// the server to write, so it is guarded offline (5.21).
export function MediaPickerSheet({
  open,
  onOpenChange,
  onChosen,
  keys,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChosen: (chosen: ChosenMedia) => void
  // The field's source -> idempotency key map (keyFor); it outlives the
  // sheet, which is mounted fresh for every opening.
  keys: Map<string, string>
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" })
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const live = useRef(true)

  function fetchList() {
    listMediaAction()
      .then((result) => {
        if (!live.current) return
        setLoad(
          result.ok
            ? { state: "ready", items: result.data.items }
            : { state: "failed", code: result.code }
        )
      })
      .catch(() => {
        if (live.current) setLoad({ state: "failed", code: "SERVER_ERROR" })
      })
  }

  // Loaded once per opening.
  useEffect(() => {
    live.current = true
    if (open) fetchList()
    return () => {
      live.current = false
    }
  }, [open])

  async function choose(item: MediaChoice) {
    if (busyId) return
    const key = keyFor(keys, item.id)
    setBusyId(item.id)
    setProblem(null)
    try {
      const result = await copyMediaAction({
        sourceId: item.id,
        idempotencyKey: key,
      })
      if (!result.ok) {
        setProblem(result.code)
        return
      }
      onChosen(chosenFrom(item, result.data))
    } catch {
      setProblem("SERVER_ERROR")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <WorkPanel
      open={open}
      onOpenChange={onOpenChange}
      busy={busyId !== null}
      title={copy.pickTitle}
    >
      <PickerBody
        load={load}
        query={query}
        onQuery={setQuery}
        problem={problem}
        busyId={busyId}
        onChoose={(item) => void choose(item)}
        onRetry={() => {
          setLoad({ state: "loading" })
          fetchList()
        }}
      />
    </WorkPanel>
  )
}

// What the sheet shows (exported for the test, which renders it without the
// sheet): loading, a failed load with a retry, the empty notice, or the
// search, the count and the grid (or the no-match notice).
export function PickerBody({
  load,
  query,
  onQuery,
  problem,
  busyId,
  onChoose,
  onRetry,
}: {
  load: Load
  query: string
  onQuery: (query: string) => void
  problem: string | null
  busyId: string | null
  onChoose: (item: MediaChoice) => void
  onRetry: () => void
}) {
  const searchId = useId()
  const shown =
    load.state === "ready"
      ? load.items.filter((item) => matchesSearch(item, query))
      : []
  return (
    <>
      <p className="-mt-2 text-[15px] text-pretty text-muted-foreground">
        {copy.pickHint}
      </p>

      {load.state === "loading" && (
        <p
          role="status"
          className="flex min-h-24 items-center justify-center gap-2 text-[15px] text-muted-foreground"
        >
          <Spinner aria-hidden />
          {copy.pickLoading}
        </p>
      )}

      {load.state === "failed" && (
        <InlineNotice
          tone="error"
          actions={
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-[4px] text-[15px] underline underline-offset-[3px]"
              onClick={onRetry}
            >
              {copy.retry}
            </button>
          }
        >
          {errorMessage(load.code)}
        </InlineNotice>
      )}

      {load.state === "ready" && load.items.length === 0 && (
        <InlineNotice tone="info">{copy.pickEmpty}</InlineNotice>
      )}

      {load.state === "ready" && load.items.length > 0 && (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor={searchId} className="text-[15px] font-semibold">
              {copy.pickSearch}
            </label>
            <div className="relative">
              <SearchIcon
                aria-hidden
                strokeWidth={1.5}
                className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id={searchId}
                type="search"
                value={query}
                autoComplete="off"
                enterKeyHint="search"
                onChange={(event) => onQuery(event.target.value)}
                className="h-12 w-full min-w-0 rounded-[4px] border border-input bg-card ps-10 pe-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <p aria-live="polite" className="text-[13px] text-muted-foreground">
              {copy.pickCount(shown.length)}
            </p>
          </div>

          {problem && (
            <InlineNotice tone="error">{errorMessage(problem)}</InlineNotice>
          )}

          {shown.length === 0 ? (
            <InlineNotice tone="info">{copy.pickNoMatch}</InlineNotice>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {shown.map((item, index) => (
                <li key={item.id}>
                  <Tile
                    item={item}
                    position={index + 1}
                    busy={busyId === item.id}
                    locked={busyId !== null}
                    onChoose={() => onChoose(item)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}

// A square thumbnail of the published file (next/image shrinks it: a third
// of the sheet on a phone, a quarter from sm in a sheet of at most 720px).
// A tile without alt text is named by its place in the grid. Exported for
// the test of its busy lock.
export function Tile({
  item,
  position,
  busy,
  locked,
  onChoose,
}: {
  item: MediaChoice
  position: number
  busy: boolean
  locked: boolean
  onChoose: () => void
}) {
  const guard = useOnlineGuard()
  return (
    <button
      type="button"
      aria-label={item.alt || copy.pickNoAlt(position)}
      aria-busy={busy || undefined}
      aria-disabled={locked || undefined}
      onClick={() => {
        if (!locked) onChoose()
      }}
      {...guard}
      className="relative block aspect-square w-full min-w-11 overflow-hidden rounded-[4px] bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <Image
        src={item.url}
        alt=""
        fill
        sizes="(min-width: 640px) 170px, 33vw"
        draggable={false}
        className="object-cover select-none"
        style={{ objectPosition: objectPosition(item.focusX, item.focusY) }}
      />
      {busy && (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-[rgb(46_42_31/0.4)]"
        >
          <Spinner className="size-6 text-primary-foreground" />
        </span>
      )}
    </button>
  )
}
