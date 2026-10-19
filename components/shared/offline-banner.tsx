"use client"

import { WifiOffIcon } from "lucide-react"

import { pwaCopy } from "@/lib/copy/pwa"
import { useOnline } from "@/lib/use-online"
import { cn } from "@/lib/utils"

import { OFFLINE_HINT_ID } from "./online-button"

// The offline banner of the shells with writes (/me, /admin, the auth
// screens; story 5.21). Shown only while offline, and gone when the network
// returns. Every write button (OnlineButton) is described by it. Fixed at
// the top of the viewport above the modal layer (sheets and dialogs are
// z-50), so a dimmed confirm inside an open sheet still shows its reason.
// DESIGN › inline-notice, warning tint: the warning colour on its tint, a
// decorative icon, one sentence. Mounted once per shell.
export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div className="fixed inset-x-0 top-0 z-[60] bg-warning-tint pt-[env(safe-area-inset-top)]">
      <OfflineBannerView className="mx-auto max-w-[720px] rounded-none px-6" />
    </div>
  )
}

export function OfflineBannerView({ className }: { className?: string }) {
  return (
    <p
      id={OFFLINE_HINT_ID}
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-lg bg-warning-tint px-4 py-3 text-[15px] leading-normal text-pretty text-warning",
        className
      )}
    >
      <WifiOffIcon
        aria-hidden
        strokeWidth={1.5}
        className="mt-0.5 size-5 shrink-0"
      />
      {pwaCopy.offlineHint}
    </p>
  )
}
