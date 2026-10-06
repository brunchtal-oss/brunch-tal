"use client"

import { useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { BellOffIcon, BellRingIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { shellCopy } from "@/lib/copy/shell"
import type { ActionResult } from "@/lib/errors"
import {
  currentPushState,
  endSubscription,
  ensureSubscription,
  PUSH_CHANGE_EVENT,
  subscribePushState,
  writeChoice,
  type PushRegistration,
  type PushState,
} from "@/lib/push/client"

const copy = shellCopy.notifications.push

type Surface = "customer" | "admin"

// The push card at the top of both notification centers (story 5.8,
// EXPERIENCE › push explanation; user decision 2026-10-06: the only place
// that offers push, and its settings). The state is read from the device
// (permission, support, iPhone home-screen app, "לא עכשיו" in
// localStorage). The browser's permission prompt opens only from the
// button. After "כן" the card turns into its "on" line at once and the
// subscription is made in the background (pwa-push-notifications Step 9).
export function PushCard({
  surface,
  register,
  unregister,
}: {
  surface: Surface
  register: (input: PushRegistration) => Promise<ActionResult>
  unregister: (endpoint: string) => Promise<ActionResult>
}) {
  // null on the server and before hydration: nothing is shown.
  const state = useSyncExternalStore(
    subscribePushState,
    currentPushState,
    () => null
  )
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLElement>(null)

  // After a choice the card changes shape: keep the focus in it.
  function refocus() {
    requestAnimationFrame(() => ref.current?.focus())
  }

  async function enable() {
    setFailed(false)
    setBusy(true)
    let permission = Notification.permission
    try {
      if (permission === "default") {
        permission = await Notification.requestPermission()
      }
    } catch {
      permission = Notification.permission
    }
    setBusy(false)
    if (permission !== "granted") {
      // Blocked now (or the prompt was closed): read the device again.
      window.dispatchEvent(new Event(PUSH_CHANGE_EVENT))
      refocus()
      return
    }
    writeChoice(null)
    refocus()
    try {
      const subscription = await ensureSubscription()
      const result = subscription ? await register(subscription) : null
      if (!result?.ok) setFailed(true)
    } catch {
      setFailed(true)
    }
  }

  function later() {
    writeChoice("off")
    refocus()
  }

  async function turnOff() {
    setFailed(false)
    writeChoice("off")
    refocus()
    try {
      const endpoint = await endSubscription()
      if (endpoint) await unregister(endpoint)
    } catch {
      // The browser subscription may stay; the device's choice is "off" and
      // the sync never registers it again.
    }
  }

  if (state === null) return null
  return (
    <PushCardView
      ref={ref}
      state={state}
      surface={surface}
      failed={failed && state === "on"}
      busy={busy}
      onEnable={enable}
      onLater={later}
      onTurnOff={turnOff}
    />
  )
}

const linkButton =
  "inline-flex min-h-11 items-center px-1 text-base underline underline-offset-[3px] hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"

// DESIGN › card (card surface, 1px border, 8px corners, 16px padding, no
// shadow). Asking: the sentence, button-primary and button-link. Every
// settled state is one quiet line with its single action.
export function PushCardView({
  ref,
  state,
  surface,
  failed = false,
  busy = false,
  onEnable,
  onLater,
  onTurnOff,
}: {
  ref?: React.Ref<HTMLElement>
  state: PushState
  surface: Surface
  failed?: boolean
  busy?: boolean
  onEnable?: () => void
  onLater?: () => void
  onTurnOff?: () => void
}) {
  const frame =
    "rounded-lg border border-border bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"

  if (state === "ask" || failed) {
    return (
      <section
        ref={ref}
        tabIndex={-1}
        aria-label={copy.label}
        data-push-card={failed ? "error" : "ask"}
        className={`${frame} flex flex-col gap-4 p-4`}
      >
        <p className="flex gap-3 text-base leading-normal text-pretty">
          <BellRingIcon
            aria-hidden
            strokeWidth={1.5}
            className="mt-0.5 size-5 shrink-0 text-primary"
          />
          {surface === "admin" ? copy.askAdmin : copy.askCustomer}
        </p>
        {failed && (
          <p role="alert" className="text-[15px] leading-normal text-error">
            {copy.error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button
            type="button"
            className="h-12 px-[22px] text-base font-semibold"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onEnable}
          >
            {failed ? copy.retry : copy.enable}
          </Button>
          <button type="button" className={linkButton} onClick={onLater}>
            {copy.later}
          </button>
        </div>
      </section>
    )
  }

  if (state === "on" || state === "off") {
    const on = state === "on"
    const Icon = on ? BellRingIcon : BellOffIcon
    return (
      <section
        ref={ref}
        tabIndex={-1}
        aria-label={copy.label}
        data-push-card={state}
        className={`${frame} flex min-h-14 items-center justify-between gap-3 py-1.5 ps-4 pe-2`}
      >
        <p
          aria-live="polite"
          className="flex items-center gap-2.5 text-[15px] leading-normal"
        >
          <Icon
            aria-hidden
            strokeWidth={1.5}
            className={`size-5 shrink-0 ${on ? "text-primary" : "text-muted-foreground"}`}
          />
          {on ? copy.on : copy.off}
        </p>
        <button
          type="button"
          className={linkButton}
          onClick={on ? onTurnOff : onEnable}
          disabled={busy}
        >
          {on ? copy.turnOff : copy.turnOn}
        </button>
      </section>
    )
  }

  // Nothing to press here: blocked, unsupported, or an iPhone tab.
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={copy.label}
      data-push-card={state}
      className={`${frame} flex flex-col gap-1.5 px-4 py-3`}
    >
      {state === "denied" && (
        <p className="flex items-center gap-2.5 text-[15px] leading-normal font-semibold">
          <BellOffIcon
            aria-hidden
            strokeWidth={1.5}
            className="size-5 shrink-0 text-muted-foreground"
          />
          {copy.off}
        </p>
      )}
      <p className="text-[15px] leading-normal text-pretty text-muted-foreground">
        {state === "denied"
          ? copy.deniedHelp
          : state === "ios-install"
            ? copy.iosInstall
            : copy.unsupported}
      </p>
      {state === "ios-install" && (
        <Link href="/install" className={`${linkButton} self-start`}>
          {copy.iosInstallLink}
        </Link>
      )}
    </section>
  )
}
