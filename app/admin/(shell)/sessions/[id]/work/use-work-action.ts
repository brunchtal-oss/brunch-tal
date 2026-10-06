"use client"

import { createContext, useContext, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import type { ActionResult } from "@/lib/errors"

// One write of the work sheet (story 4.9): no optimistic update. The control
// stays locked (pending) from the call until the refreshed sheet arrives;
// a failure keeps its code for an inline-notice next to the control. A
// rejected call (network, deploy) is a SERVER_ERROR, and the sheet is
// refreshed after a failure too, so a stale sheet (CONCURRENT_CHANGE,
// NOT_FOUND) does not make every next try fail the same way.
export function useWorkAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(call: () => Promise<ActionResult>, onOk?: () => void) {
    if (pending) return
    setError(null)
    startTransition(async () => {
      let result: ActionResult
      try {
        result = await call()
      } catch {
        result = { ok: false, code: "SERVER_ERROR" }
      }
      if (!result.ok) {
        setError(result.code)
      } else {
        onOk?.()
      }
      startTransition(() => router.refresh())
    })
  }

  return { pending, error, run, clearError: () => setError(null) }
}

// The sheet's live region: what a saved change did ("סומן כבוצע", a moved
// dish), for screen readers.
export const AnnounceContext = createContext<(text: string) => void>(() => {})

export function useAnnounce() {
  return useContext(AnnounceContext)
}
