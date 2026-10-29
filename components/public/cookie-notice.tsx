"use client"

import Link from "next/link"
import { useEffect, useId, useRef, useSyncExternalStore } from "react"

import {
  hasCookieAck,
  linkSeparator,
  saveCookieAck,
  subscribe,
  type CookieNoticeView,
} from "@/lib/cookie-notice"
import { shellCopy } from "@/lib/copy/shell"

// The cookie notice (story 5.23): a quiet card at the bottom of every public
// page until "הבנתי" is clicked on this device (lib/cookie-notice.ts). Not
// blocking: role="dialog" with aria-modal="false", focus is neither moved
// nor trapped, no Escape. The wording is the published block
// cookie-notice › notice; the link to /privacy follows the paragraph (no
// space after a one-letter prefix). The choice is read in the browser only:
// the server snapshot is "acked", so the server HTML has nothing and a
// device that already clicked sees no flash. Where it sits (above the
// whatsapp-bar while it is shown, bottom 0 below a 480px height):
// app/globals.css › [data-cookie-notice]. While it is open it publishes its
// height as --cookie-notice-height on <html>, so the accessibility button
// (story 5.25) sits 8px above it.

export function CookieNotice(props: CookieNoticeView) {
  const acked = useSyncExternalStore(subscribe, hasCookieAck, () => true)
  if (acked) return null
  return (
    <CookieNoticePanel
      {...props}
      onAck={() => {
        // The focused button leaves the DOM with the panel; without this,
        // focus would fall to <body>. <main id="main"> has tabIndex={-1}.
        document.getElementById("main")?.focus({ preventScroll: true })
        saveCookieAck()
      }}
    />
  )
}

/**
 * The card itself. `preview` (the admin preview) shows it in the flow, not
 * fixed, and its button does nothing.
 */
export function CookieNoticePanel({
  title,
  body,
  linkLabel,
  onAck,
  preview = false,
}: CookieNoticeView & { onAck?: () => void; preview?: boolean }) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const label = title ? undefined : (body ?? "").split("\n")[0]

  useEffect(() => {
    const node = ref.current
    if (preview || !node || typeof ResizeObserver === "undefined") return
    const root = document.documentElement
    const publish = () =>
      root.style.setProperty(
        "--cookie-notice-height",
        `${node.getBoundingClientRect().height}px`
      )
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    return () => {
      observer.disconnect()
      root.style.removeProperty("--cookie-notice-height")
    }
  }, [preview])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={title ? titleId : undefined}
      aria-label={label}
      data-cookie-notice={preview ? undefined : ""}
      className={
        preview
          ? "mx-auto w-full max-w-[672px] rounded-[8px] border border-border bg-card p-4"
          : "fixed inset-x-4 z-30 mx-auto max-h-[60svh] max-w-[672px] overflow-y-auto overscroll-contain rounded-[8px] border border-border bg-card p-4 print:hidden"
      }
    >
      {title && (
        <h2
          id={titleId}
          className="font-heading text-[22px] leading-[1.25] font-light text-balance"
        >
          {title}
        </h2>
      )}
      {(body || linkLabel) && (
        <p
          className={`text-[15px] leading-normal text-pretty whitespace-pre-line ${title ? "mt-2" : ""}`}
        >
          {body}
          {linkLabel && (
            <>
              {body ? linkSeparator(body) : ""}
              <Link
                href="/privacy"
                className="underline decoration-1 underline-offset-[3px]"
              >
                {linkLabel}
              </Link>
            </>
          )}
        </p>
      )}
      <button
        type="button"
        onClick={onAck}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-[4px] bg-primary px-[22px] text-base leading-[1.2] font-semibold text-primary-foreground hover:bg-primary/90 sm:w-auto"
      >
        {shellCopy.public.cookieNoticeAck}
      </button>
    </div>
  )
}
