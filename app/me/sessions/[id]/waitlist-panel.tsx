"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { PushOffer } from "@/components/shared/push-offer"
import { useAnnounce } from "@/components/shared/result-notice"
import { StatusChip } from "@/components/shared/status-chip"
import { Spinner } from "@/components/ui/spinner"
import { customerCopy } from "@/lib/copy/customer"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import {
  currentPushState,
  declineWaitlistOffer,
  shouldOfferOnWaitlist,
  subscribePushState,
} from "@/lib/push/client"
import { formatDayMonth } from "@/lib/time"
import { cn } from "@/lib/utils"

import { registerPush, unregisterPush } from "../../notifications/actions"
import { joinWaitlistAction, leaveWaitlistAction } from "../actions"
import type { WaitlistState } from "./waitlist-state"

const copy = customerCopy.waitlist

// button-secondary (DESIGN.md), the same shape as the session page's other
// secondary actions.
const SECONDARY =
  "h-12 w-full max-w-xs rounded-[4px] border-foreground text-base font-semibold"

// The waitlist on the session page (story 5.6, EXPERIENCE › מצבי הרשמה
// ורשימת המתנה): under the booking panel. Full and not waiting: the offer
// and "להצטרף לרשימת ההמתנה". Waiting: the pending chip, what it means (no
// place is held) and "לצאת מרשימת ההמתנה"; arriving from the notification
// while still full, "the place was already taken". One tap, no sheet and no
// dialog; the button swaps in place once the page is read again, and the
// result is announced in an inline-notice that takes the focus.
export function WaitlistPanel({
  eventId,
  startsAt,
  state,
  full = false,
}: {
  eventId: string
  startsAt: string
  state: WaitlistState
  // The session is full and the booking panel's full notice is not shown:
  // the panel ends with the link to all sessions instead.
  full?: boolean
}) {
  if (state.kind === "none") return null

  const allSessions = full && (
    <Link
      href="/me/sessions"
      className="py-3 font-semibold underline underline-offset-[3px]"
    >
      {customerCopy.allSessions}
    </Link>
  )

  if (state.kind === "offer") {
    return (
      <section
        aria-label={copy.sectionTitle}
        className="flex flex-col items-start gap-4"
      >
        <p className="text-[17px] leading-relaxed text-pretty">
          {copy.fullOffer}
        </p>
        <WaitlistButton
          action="join"
          eventId={eventId}
          startsAt={startsAt}
          className={SECONDARY}
        />
        {allSessions}
      </section>
    )
  }

  return (
    <section
      aria-label={copy.sectionTitle}
      className="flex flex-col items-start gap-3"
    >
      {state.taken && (
        <InlineNotice tone="info" className="w-full">
          {copy.taken}
        </InlineNotice>
      )}
      <StatusChip tone="pending">{copy.chip}</StatusChip>
      <p className="text-base leading-relaxed text-pretty text-muted-foreground">
        {copy.explain}
      </p>
      <WaitlistPushOffer />
      <WaitlistButton
        action="leave"
        eventId={eventId}
        startsAt={startsAt}
        className={cn(SECONDARY, "mt-1")}
      />
      {allSessions}
    </section>
  )
}

// "להצטרף לרשימת ההמתנה" or "לצאת מרשימת ההמתנה" (also on "ההרשמות
// שלי"). One key per page load and per change (AD-5): a new one after any
// answer. Inside a ResultNoticeHost the success is announced there (its
// button leaves with the refresh); outside one it is shown here.
export function WaitlistButton({
  action,
  eventId,
  startsAt,
  className,
}: {
  action: "join" | "leave"
  eventId: string
  startsAt: string
  className?: string
}) {
  const router = useRouter()
  const announce = useAnnounce()
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const doneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (done) doneRef.current?.focus()
  }, [done])

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const input = { eventId, idempotencyKey: key }
      const result =
        action === "join"
          ? await joinWaitlistAction(input)
          : await leaveWaitlistAction(input)
      if (result.ok) {
        const message =
          action === "join" ? copy.joined : copy.left(formatDayMonth(startsAt))
        if (announce) announce(message)
        else setDone(message)
        // The button swaps in place once the page is read again; after a
        // refusal the error stays in view.
        router.refresh()
      } else {
        setError(result.code)
      }
    } catch {
      setError("SERVER_ERROR")
    } finally {
      setBusy(false)
      setKey(newIdempotencyKey())
    }
  }

  return (
    <div className="flex w-full flex-col items-start gap-3">
      {done && (
        <div ref={doneRef} tabIndex={-1} className="w-full outline-none">
          <InlineNotice tone="success">{done}</InlineNotice>
        </div>
      )}
      <OnlineButton
        type="button"
        variant="outline"
        size="lg"
        onClick={run}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        className={className}
      >
        {busy && <Spinner aria-hidden />}
        {action === "join" ? copy.join : copy.leave}
      </OnlineButton>
      {error && (
        <InlineNotice tone="error" className="w-full">
          {errorMessage(error)}
        </InlineNotice>
      )}
    </div>
  )
}

// The push offer while she waits (story 5.6, user decision 2026-10-20): the
// waitlist_spot reaches the phone only with push on, so it is offered while
// push is not on and can still be asked, also after "לא עכשיו" in the
// notification center, until she answers "לא עכשיו" here (then never again
// on this device). Decided once when the panel shows (nothing on the
// server); after "כן" the card settles into its "on" line.
function WaitlistPushOffer() {
  const state = useSyncExternalStore(
    subscribePushState,
    currentPushState,
    () => null
  )
  const [offer, setOffer] = useState<boolean | null>(null)
  if (offer === null && state !== null) {
    let storage: Storage | null = null
    try {
      storage = window.localStorage
    } catch {
      storage = null
    }
    setOffer(shouldOfferOnWaitlist(state, storage))
  }
  if (!offer) return null
  return (
    <div className="w-full">
      <PushOffer
        register={registerPush}
        unregister={unregisterPush}
        askText={copy.pushAsk}
        askWhenOff
        onChoice={(choice) => {
          if (choice === "later") {
            declineWaitlistOffer()
            setOffer(false)
          }
        }}
      />
    </div>
  )
}
