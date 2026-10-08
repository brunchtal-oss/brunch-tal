"use client"

import { useState } from "react"
import Image from "next/image"
import { ChevronLeftIcon, ChevronRightIcon, EyeOffIcon } from "lucide-react"

import { buttonClass } from "@/components/shared/button-class"
import { adminCopy } from "@/lib/copy/admin"
import { objectPosition } from "@/lib/media/photo"
import { cn } from "@/lib/utils"

import { arrangeTap, type EditorItem } from "./section-fields"

const copy = adminCopy.content.arrange

const GRID: Record<string, string> = {
  "2": "grid-cols-2 gap-x-3 gap-y-5",
  "3": "grid-cols-3 gap-x-2 gap-y-4",
  "4": "grid-cols-4 gap-x-2 gap-y-3",
}

// The gallery's arrange view (user decision 2026-10-08): every photo as on
// the site, in the block's columns (2, 3 or 4) at 4:5. Tap a photo to select
// it (a 2px primary ring, aria-pressed), then tap another: the two swap
// places and the others stay put; tapping it again cancels. A hidden photo is
// dimmed with its mark and moves like any other. For the keyboard and a
// screen reader, the selected photo's "קודם" / "אחרי" buttons (44px) sit in
// one bar above the grid, not on each tile: four columns on a 320px phone
// leave no room for two 44px buttons per tile. Every change is announced by
// the editor's live region (announce) and stays in the draft until saved.
export function GalleryArrange({
  items,
  columns,
  previewUrls,
  onSwap,
  announce,
}: {
  items: readonly EditorItem[]
  columns: string
  previewUrls: Record<string, string>
  onSwap: (a: number, b: number) => void
  announce: (text: string) => void
}) {
  const [selected, setSelected] = useState<number | null>(null)

  function tap(index: number) {
    const action = arrangeTap(selected, index)
    if (action.kind === "select") {
      setSelected(action.index)
      announce(copy.selected(action.index + 1))
    } else if (action.kind === "cancel") {
      setSelected(null)
      announce(copy.cancelled)
    } else {
      onSwap(action.a, action.b)
      setSelected(null)
      announce(copy.swapped(action.a + 1, action.b + 1))
    }
  }

  // The bar's arrows move the selected photo one place and keep it
  // selected, so it can go on moving.
  function step(delta: -1 | 1) {
    if (selected === null) return
    const to = selected + delta
    if (to < 0 || to >= items.length) return
    onSwap(selected, to)
    setSelected(to)
    announce(copy.swapped(selected + 1, to + 1))
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] text-muted-foreground">{copy.hint}</p>
      {selected !== null && (
        <ArrangeBar
          selected={selected}
          total={items.length}
          onStep={step}
          onCancel={() => {
            setSelected(null)
            announce(copy.cancelled)
          }}
        />
      )}
      <ol
        data-columns={columns}
        className={cn("grid", GRID[columns] ?? GRID["3"])}
      >
        {items.map((item, index) => {
          const image = item.images?.image ?? null
          const url = image ? previewUrls[image.media_id] : undefined
          const isSelected = selected === index
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => tap(index)}
                className={cn(
                  "relative block aspect-[4/5] w-full overflow-hidden rounded-lg bg-muted outline-offset-2",
                  isSelected &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
              >
                <span className="sr-only">
                  {copy.photo(index + 1)}
                  {item.hidden ? `, ${copy.hidden}` : ""}
                </span>
                {url && (
                  <Image
                    src={url}
                    alt=""
                    fill
                    unoptimized
                    sizes="25vw"
                    className={cn("object-cover", item.hidden && "opacity-40")}
                    style={
                      image
                        ? {
                            objectPosition: objectPosition(
                              image.focus_x,
                              image.focus_y
                            ),
                          }
                        : undefined
                    }
                  />
                )}
                <span
                  aria-hidden
                  className="absolute start-1 top-1 rounded-full bg-background/90 px-2 text-[13px] leading-[1.4] font-semibold tabular-nums"
                >
                  {index + 1}
                </span>
                {item.hidden && (
                  <span
                    aria-hidden
                    className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-full bg-expired-tint text-expired"
                  >
                    <EyeOffIcon strokeWidth={1.5} className="size-4" />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const ICON =
  "size-11 rounded-lg border border-foreground bg-transparent p-0 text-foreground aria-disabled:opacity-50"

// The selected photo's bar: its number, "קודם" and "אחרי" (44px; disabled
// at the ends) and "ביטול הבחירה".
export function ArrangeBar({
  selected,
  total,
  onStep,
  onCancel,
}: {
  selected: number
  total: number
  onStep: (delta: -1 | 1) => void
  onCancel: () => void
}) {
  const first = selected === 0
  const last = selected === total - 1
  return (
    <div
      data-arrange-bar=""
      className="flex flex-wrap items-center gap-2 rounded-xl bg-muted px-3 py-2"
    >
      <span className="min-w-0 flex-1 text-[15px] font-semibold">
        {copy.photo(selected + 1)}
      </span>
      {/* RTL: "קודם" points to the start (right), "אחרי" to the end. */}
      <button
        type="button"
        aria-label={copy.before(selected + 1)}
        aria-disabled={first || undefined}
        onClick={() => onStep(-1)}
        className={buttonClass({ variant: "outline", className: ICON })}
      >
        <ChevronRightIcon aria-hidden strokeWidth={1.5} className="size-5" />
      </button>
      <button
        type="button"
        aria-label={copy.after(selected + 1)}
        aria-disabled={last || undefined}
        onClick={() => onStep(1)}
        className={buttonClass({ variant: "outline", className: ICON })}
      >
        <ChevronLeftIcon aria-hidden strokeWidth={1.5} className="size-5" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex min-h-11 items-center px-2 text-[15px] underline underline-offset-[3px]"
      >
        {copy.cancel}
      </button>
    </div>
  )
}
