"use client"

import type { ActionResult } from "@/lib/errors"
import type { PushRegistration } from "@/lib/push/client"

import { PushCard } from "./push-card"

// The push offer under the booking climax (story 5.21; source §8,
// EXPERIENCE › "המקום שלך שמור"): the push card's ask view and copy, for a
// customer, once per device. The caller decides with claimPushOffer() at
// the moment the booking succeeds (lib/push/client.ts). After "כן" or "לא
// עכשיו" the card settles into its one quiet line, as in the notification
// center, so she sees what her choice did.
export function PushOffer({
  register,
  unregister,
  askText,
  askWhenOff,
  onChoice,
}: {
  register: (input: PushRegistration) => Promise<ActionResult>
  unregister: (endpoint: string) => Promise<ActionResult>
  askText?: string
  askWhenOff?: boolean
  onChoice?: (choice: "enable" | "later") => void
}) {
  return (
    <div data-push-offer="" className="pt-2">
      <PushCard
        surface="customer"
        register={register}
        unregister={unregister}
        askText={askText}
        askWhenOff={askWhenOff}
        onChoice={onChoice}
      />
    </div>
  )
}
