"use client"

import { useEffect, useId, useRef, useState } from "react"
import { InfoIcon } from "lucide-react"

import { ContactText } from "@/components/shared/contact-text"
import { customerCopy } from "@/lib/copy/customer"

// "תוקף הכרטיסיה פג" for a card that expired before it was bound (story 2.4),
// with an i that opens a toggletip: a button with aria-expanded, opened by a
// click (and on a mouse also by hovering), closed by Escape, a click outside
// or a second click. The bubble's contact phrase links to Tal's WhatsApp.
// weeks comes from the card's validity days (null: no explanation).

export type ToggletipState = { open: boolean; byHover: boolean }
export type ToggletipEvent =
  | { type: "hover" }
  | { type: "leave" }
  // pointer: the pointerType of the press ("" for a keyboard click).
  | { type: "click"; pointer: string }
  | { type: "close" }

// A mouse click on a bubble the hover opened keeps it open (it is now
// pinned); any other click toggles. Leaving closes only a hover bubble.
export function nextToggletip(
  state: ToggletipState,
  event: ToggletipEvent
): ToggletipState {
  switch (event.type) {
    case "hover":
      return state.open ? state : { open: true, byHover: true }
    case "leave":
      return state.byHover ? { open: false, byHover: false } : state
    case "click":
      if (event.pointer === "mouse" && state.open && state.byHover) {
        return { open: true, byHover: false }
      }
      return { open: !state.open, byHover: false }
    case "close":
      return { open: false, byHover: false }
  }
}

export function ExpiredCardNote({
  weeks,
  contactHref,
}: {
  weeks: number | null
  contactHref: string | null
}) {
  const [tip, setTip] = useState<ToggletipState>({
    open: false,
    byHover: false,
  })
  const open = tip.open
  const send = (event: ToggletipEvent) =>
    setTip((state) => nextToggletip(state, event))
  // The pointer of the press that leads to the next click ("" = keyboard).
  const pressedWith = useRef("")
  const rootRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const tipId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") send({ type: "close" })
    }
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        send({ type: "close" })
      }
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-2"
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") send({ type: "leave" })
      }}
    >
      <p className="flex items-center gap-1 text-[15px] text-expired">
        <span id={labelId}>{customerCopy.expiredBeforeBound}</span>
        {weeks !== null && (
          <button
            type="button"
            aria-labelledby={labelId}
            aria-expanded={open}
            aria-controls={tipId}
            onPointerDown={(event) => {
              pressedWith.current = event.pointerType
            }}
            onClick={() => {
              send({ type: "click", pointer: pressedWith.current })
              pressedWith.current = ""
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") send({ type: "hover" })
            }}
            className="-my-2 inline-flex size-11 items-center justify-center rounded-full text-foreground"
          >
            <InfoIcon aria-hidden strokeWidth={1.5} className="size-5" />
          </button>
        )}
      </p>
      {weeks !== null && (
        <p
          id={tipId}
          role="status"
          hidden={!open}
          className="rounded-lg bg-card px-3 py-2 text-[15px] leading-normal shadow-sm ring-1 ring-border"
        >
          {open && (
            <ContactText
              text={customerCopy.expiredBeforeBoundInfo(weeks)}
              href={contactHref}
              phrase={customerCopy.contactPhrase}
            />
          )}
        </p>
      )}
    </div>
  )
}
