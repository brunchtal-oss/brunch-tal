"use client"

import {
  createContext,
  useContext,
  useRef,
  useState,
  useTransition,
} from "react"
import { useRouter } from "next/navigation"

import type { ActionResult } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

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

// An idempotency key for a one-tap action whose input can change between
// taps (which day to add or remove): the same input keeps its key, so a
// retry after a lost answer is replayed; another input gets a new key.
// clear() after a success, so the next tap is a new call.
export function useKeyFor() {
  const ref = useRef<{ input: string; key: string } | null>(null)
  return {
    keyFor(input: string) {
      if (ref.current?.input !== input) {
        ref.current = { input, key: newIdempotencyKey() }
      }
      return ref.current.key
    },
    clear() {
      ref.current = null
    },
  }
}

// The sheet's live region: what a saved change did ("סומן כבוצע", a moved
// dish), for screen readers.
export const AnnounceContext = createContext<(text: string) => void>(() => {})

export function useAnnounce() {
  return useContext(AnnounceContext)
}
