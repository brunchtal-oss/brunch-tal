"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"

import { InlineNotice } from "@/components/shared/inline-notice"

// The result of an action whose own row or button disappears after it (a
// cancelled booking leaves its list once the page is read again, story
// 3.6). The host stays mounted across router.refresh(), shows the last
// result as a success inline-notice above its children and moves the focus
// to it (EXPERIENCE › focus target after an action). Outside a host,
// useAnnounce returns null and the caller shows the result itself.

type Announce = (message: string) => void

const ResultNoticeContext = createContext<Announce | null>(null)

export function useAnnounce(): Announce | null {
  return useContext(ResultNoticeContext)
}

export function ResultNoticeHost({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const [message, setMessage] = useState<string | null>(null)
  // A new object per announcement, so the same text twice focuses again.
  const [tick, setTick] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (message) ref.current?.focus()
  }, [message, tick])

  return (
    <ResultNoticeContext.Provider
      value={(next) => {
        setMessage(next)
        setTick((t) => t + 1)
      }}
    >
      <div className={className}>
        {message && (
          <div ref={ref} tabIndex={-1} className="mb-4 outline-none">
            <InlineNotice tone="success">{message}</InlineNotice>
          </div>
        )}
        {children}
      </div>
    </ResultNoticeContext.Provider>
  )
}
