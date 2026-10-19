"use client"

import { Button } from "@/components/ui/button"
import { useOnline } from "@/lib/use-online"

/** The id of the shell's offline banner (OfflineBanner). */
export const OFFLINE_HINT_ID = "offline-hint"

type OwnProps = {
  "aria-describedby"?: string
}

export type OfflineProps = {
  "aria-disabled"?: true
  "aria-describedby"?: string
  "data-offline"?: ""
  onClick?: (event: { preventDefault(): void }) => void
}

/**
 * What a write button adds while offline (story 5.21): aria-disabled, the
 * banner as its description (after the caller's own), and a click that
 * only cancels itself, so a submit button never submits its form. Online
 * it adds nothing, and the caller's own aria-disabled (busy) applies.
 */
export function offlineProps(
  online: boolean,
  own: OwnProps = {}
): OfflineProps {
  if (online) return {}
  return {
    "aria-disabled": true,
    "aria-describedby": [own["aria-describedby"], OFFLINE_HINT_ID]
      .filter(Boolean)
      .join(" "),
    // globals.css dims it, as a disabled button.
    "data-offline": "",
    onClick: (event) => event.preventDefault(),
  }
}

/** The same props for a native <button> (buttonClass, a link-button). */
export function useOnlineGuard(own: OwnProps = {}): OfflineProps {
  return offlineProps(useOnline(), own)
}

/**
 * A Button for every tap that asks the server to change something: a
 * Server Action write, an /api POST, push, mark read, sign out, an upload
 * (AGENTS.md › מוסכמות). Not for opening a sheet, search or navigation.
 */
export function OnlineButton(props: React.ComponentProps<typeof Button>) {
  const online = useOnline()
  return <Button {...props} {...offlineProps(online, props)} />
}

/**
 * A native <button> with the same guard, for a server component's form
 * (the top-bar's sign-out) or a button styled outside Button.
 */
export function OnlineNativeButton(props: React.ComponentProps<"button">) {
  const guard = useOnlineGuard(props)
  return <button {...props} {...guard} />
}
