"use client"

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"

import {
  APPROVED_PARAM,
  newIdempotencyKey,
  nextApprovalPhase,
  type ApprovalPhase,
} from "./approval-history"
import {
  PaymentForm,
  type MethodOption,
  type ProductOption,
} from "./payment-form"

// Holds one approval "session" of the form: a remount key, its idempotency
// key and the phase of the success screen (approval-history.ts). The form
// keeps its one-time link while ?approved=1 is in the URL; once the param is
// gone (Back, or the "payments" tab) it is replaced by a new, empty form.
export function PaymentFormHost({
  products,
  methods,
  today,
  idempotencyKey,
}: {
  products: readonly ProductOption[]
  methods: readonly MethodOption[]
  today: string
  idempotencyKey: string
}) {
  const pathname = usePathname()
  const approvedInUrl = useSearchParams().get(APPROVED_PARAM) === "1"
  const [session, setSession] = useState<{
    id: number
    key: string
    phase: ApprovalPhase
  }>({ id: 0, key: idempotencyKey, phase: "form" })

  const phase = nextApprovalPhase(session.phase, approvedInUrl)
  if (phase === "reset") {
    setSession({ id: session.id + 1, key: newIdempotencyKey(), phase: "form" })
  } else if (phase !== session.phase) {
    setSession({ ...session, phase })
  }

  // A reload of ?approved=1: the link cannot be shown again, so the empty
  // form stays and the param goes.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has(APPROVED_PARAM)) {
      window.history.replaceState(null, "", pathname)
    }
  }, [pathname])

  const onApproved = () => {
    window.history.pushState(null, "", `${pathname}?${APPROVED_PARAM}=1`)
    setSession((current) => ({ ...current, phase: "pushed" }))
  }

  return (
    <PaymentForm
      key={session.id}
      products={products}
      methods={methods}
      today={today}
      idempotencyKey={session.key}
      onApproved={onApproved}
    />
  )
}
