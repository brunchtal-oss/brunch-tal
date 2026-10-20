"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { requestUnreadRefresh } from "@/components/shared/bell-button"
import { OnlineButton } from "@/components/shared/online-button"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ActionResult } from "@/lib/errors"

import { markRead } from "../notifications/actions"

const copy = adminCopy.home

type Dismiss = (ids: string[]) => Promise<ActionResult<{ marked: number }>>

// Marks the reminder read: null on success, else the message from
// lib/errors.ts (a thrown call reads as SERVER_ERROR).
export async function dismissReminder(
  id: string,
  dismiss: Dismiss
): Promise<string | null> {
  let result: ActionResult<{ marked: number }>
  try {
    result = await dismiss([id])
  } catch {
    result = { ok: false, code: "SERVER_ERROR" }
  }
  return result.ok ? null : errorMessage(result.code)
}

// The strip itself (DESIGN › reminder-strip): muted, body-sm, "סגירה" as a
// link-style button that marks the reminder read through the existing
// markRead. On success it disappears and the page refreshes (the bell's
// count); on failure it stays with the message.
export function ReminderStripView({
  id,
  body,
  dismiss = markRead,
}: {
  id: string
  body: string
  dismiss?: Dismiss
}) {
  const router = useRouter()
  const [closed, setClosed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (closed) return null

  const close = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    const failure = await dismissReminder(id, dismiss)
    setPending(false)
    if (failure !== null) {
      setError(failure)
      return
    }
    setClosed(true)
    requestUnreadRefresh()
    router.refresh()
  }

  return (
    <div
      role="status"
      aria-label={copy.reminderLabel}
      className="flex flex-col gap-1 rounded-lg bg-muted px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="pt-2.5 text-[15px] leading-normal text-pretty break-words whitespace-pre-line">
          {body}
        </p>
        <OnlineButton
          type="button"
          variant="link"
          onClick={() => void close()}
          aria-disabled={pending ? true : undefined}
          className="min-h-11 shrink-0 px-0 text-[15px] text-foreground underline underline-offset-[3px]"
        >
          {copy.reminderDismiss}
        </OnlineButton>
      </div>
      {error && (
        <p role="alert" className="text-[15px] text-error">
          {error}
        </p>
      )}
    </div>
  )
}
