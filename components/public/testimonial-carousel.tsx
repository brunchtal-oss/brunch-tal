"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { center, clampIndex, nearestIndex } from "@/lib/carousel"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

const copy = shellCopy.public.carousel

// Up to this many items the position is shown as dots, in one row that
// never wraps (a dot's target narrows from 24px to 12px on a narrow screen);
// above it, as a counter ("3 מתוך 12") between the buttons (user decision
// 2026-10-07).
export const MAX_DOTS = 10

// testimonial-carousel (DESIGN, user decision 2026-10-07): a horizontal row
// the visitor moves by hand only (CSS scroll-snap, native swipe and RTL),
// with previous/next buttons and position dots. It never moves by itself:
// no timer, no autoplay, no entrance animation. The current item is centred
// (user phone check 2026-10-07): on a phone it is nearly full width and its
// neighbours peek at the edges; from `sm` it is up to 400px. The track's
// inline padding lets the first and the last item centre too. The buttons
// hug the dots in one centred row. With one item there are no buttons and
// no dots.
export function TestimonialCarousel({
  items,
  label,
}: {
  items: React.ReactNode[]
  label: string
}) {
  const track = useRef<HTMLUListElement>(null)
  const frame = useRef(0)
  // The item a button or dot is moving to: while it is set, a smooth scroll
  // passing other items does not change `current`, so a quick second press
  // moves on from the target. A gesture on the track clears it.
  const pending = useRef<number | null>(null)
  const [current, setCurrent] = useState(0)
  const count = items.length
  const several = count > 1

  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const el = track.current
      if (!el) return
      const rects = Array.from(el.children, (child) =>
        child.getBoundingClientRect()
      )
      const index = nearestIndex(center(el.getBoundingClientRect()), rects)
      if (index < 0) return
      if (pending.current !== null) {
        if (index === pending.current) pending.current = null
        return
      }
      setCurrent(index)
    })
  }, [])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const clearPending = () => {
    pending.current = null
  }

  const goTo = (index: number) => {
    const el = track.current
    const next = clampIndex(index, count)
    const target = el?.children[next]
    if (!el || !target) return
    pending.current = next
    setCurrent(next)
    const delta =
      center(target.getBoundingClientRect()) -
      center(el.getBoundingClientRect())
    // Already there: no scroll event will come to clear the target.
    if (Math.abs(delta) < 1) pending.current = null
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    el.scrollBy({ left: delta, behavior: reduced ? "auto" : "smooth" })
  }

  const arrow =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted aria-disabled:opacity-35 aria-disabled:hover:bg-transparent"

  return (
    <div className="@container">
      <ul
        ref={track}
        aria-label={label}
        onScroll={several ? onScroll : undefined}
        onPointerDown={several ? clearPending : undefined}
        onTouchStart={several ? clearPending : undefined}
        onWheel={several ? clearPending : undefined}
        className={cn(
          "-mx-6 flex snap-x snap-mandatory [scrollbar-width:none] gap-4 overflow-x-auto [&::-webkit-scrollbar]:hidden",
          several
            ? "[padding-inline:calc((100cqw_+_3rem_-_var(--slide))_/_2)] [--slide:85cqw] sm:[--slide:min(400px,85cqw)]"
            : "px-6 [--slide:100cqw]"
        )}
      >
        {items.map((item, index) => (
          <li
            key={index}
            className="flex w-(--slide) shrink-0 snap-center snap-always"
          >
            {item}
          </li>
        ))}
      </ul>
      {several && (
        <div className="mt-3 flex items-start justify-center">
          <button
            type="button"
            aria-label={copy.previous}
            aria-disabled={current === 0 ? "true" : undefined}
            onClick={() => {
              if (current !== 0) goTo(current - 1)
            }}
            className={arrow}
          >
            <ChevronLeftIcon
              aria-hidden
              strokeWidth={1.5}
              className="size-6 rtl:-scale-x-100"
            />
          </button>
          {count > MAX_DOTS ? (
            <p
              aria-live="polite"
              className="flex h-11 min-w-20 items-center justify-center px-2 text-[15px] text-muted-foreground tabular-nums"
            >
              {copy.counter(current + 1, count)}
            </p>
          ) : (
            <div className="flex min-w-0 justify-center">
              {items.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={copy.item(index + 1, count)}
                  aria-current={index === current ? "true" : undefined}
                  onClick={() => goTo(index)}
                  className="group inline-flex h-11 w-6 min-w-3 shrink items-center justify-center rounded-[4px]"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "block size-2 rounded-full",
                      index === current
                        ? "bg-primary"
                        : "bg-muted-foreground/35 group-hover:bg-muted-foreground/60"
                    )}
                  />
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label={copy.next}
            aria-disabled={current === count - 1 ? "true" : undefined}
            onClick={() => {
              if (current !== count - 1) goTo(current + 1)
            }}
            className={arrow}
          >
            <ChevronRightIcon
              aria-hidden
              strokeWidth={1.5}
              className="size-6 rtl:-scale-x-100"
            />
          </button>
        </div>
      )}
    </div>
  )
}
