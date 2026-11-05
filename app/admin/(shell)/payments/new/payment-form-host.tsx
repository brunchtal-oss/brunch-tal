"use client"

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"

import {
  APPROVED_PARAM,
  catalogKey,
  formRemountKey,
  newIdempotencyKey,
  nextApprovalPhase,
  type ApprovalPhase,
} from "./approval-history"
import type { BookableEvent } from "./event-options"
import {
  PaymentForm,
  type CustomerOption,
  type MethodOption,
  type ProductOption,
} from "./payment-form"

// Holds one approval "session" of the form: a remount key, its idempotency
// key and the phase of the success screen (approval-history.ts). The form
// keeps its one-time link while ?approved=1 is in the URL; once the param is
// gone (Back) it is replaced by a new, empty form; the "payments" tab leaves
// for /admin/payments.
export function PaymentFormHost({
  customer,
  products,
  methods,
  events,
  today,
  idempotencyKey,
}: {
  // null: a new customer (a join link); otherwise the chosen customer.
  customer: CustomerOption | null
  products: readonly ProductOption[]
  methods: readonly MethodOption[]
  // The open sessions for a pinned product (story 3.11).
  events: readonly BookableEvent[]
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
  // The catalog the form was touched under (approval-history.ts
  // formRemountKey); null while untouched.
  const [frozenCatalog, setFrozenCatalog] = useState<string | null>(null)

  const phase = nextApprovalPhase(session.phase, approvedInUrl)
  if (phase === "reset") {
    setSession({ id: session.id + 1, key: newIdempotencyKey(), phase: "form" })
    setFrozenCatalog(null)
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

  // Next keeps a visited page's state (cacheComponents), so a form opened
  // before a catalog change would keep the old price as its amount (phone
  // test 2026-10-04). A change in the offered products or their prices
  // starts an untouched form again; a touched one keeps Tal's input.
  const catalog = catalogKey(products)
  const onTouched = () => {
    setFrozenCatalog((current) => current ?? catalog)
  }

  return (
    <PaymentForm
      key={formRemountKey(session.id, catalog, frozenCatalog)}
      customer={customer}
      products={products}
      methods={methods}
      events={events}
      today={today}
      idempotencyKey={session.key}
      onApproved={onApproved}
      onTouched={onTouched}
    />
  )
}
