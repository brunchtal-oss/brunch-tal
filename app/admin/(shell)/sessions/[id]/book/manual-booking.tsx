"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button, buttonVariants } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatDayMonth } from "@/lib/time"

import { adminBookCustomerAction, previewAdminBookAction } from "../../actions"
import { refusalAction, refusalMessage, type BookPreview } from "./preview"

const copy = adminCopy.sessions
const ACTION = "h-11 text-base"

// The manual booking of one customer for one session (story 3.4, CAP-14):
// what will be used and its validity, one confirm button. A refusal shows
// the reason (refusalMessage, worded for Tal) and what can help: a payment for her, or raising
// the capacity. The result is an inline-notice with a link to the session's
// details; no optimistic result, the button is busy until the answer. The
// idempotency key is made on load and renewed after every answer (not after
// a network failure, when the server may have booked already).
export function ManualBooking({
  eventId,
  customer,
  initialPreview,
}: {
  eventId: string
  customer: { id: string; name: string }
  initialPreview: BookPreview
}) {
  const [preview, setPreview] = useState(initialPreview)
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [done, setDone] = useState(false)
  const noticeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (done || error) noticeRef.current?.focus()
  }, [done, error])

  const book = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await adminBookCustomerAction({
        customerId: customer.id,
        eventId,
        idempotencyKey: key,
      })
      setKey(newIdempotencyKey())
      if (result.ok) {
        setDone(true)
        return
      }
      setError(result.code)
      // The session or her entitlements changed: show what holds now. A
      // failed refresh keeps the booking's own code.
      try {
        const fresh = await previewAdminBookAction({
          customerId: customer.id,
          eventId,
        })
        if (fresh.ok) setPreview(fresh.data)
      } catch {
        // The refusal above stays on the screen.
      }
    } catch {
      setError("SERVER_ERROR")
    } finally {
      setBusy(false)
    }
  }

  const detailsLink = (
    <Link
      href={`/admin/sessions/${eventId}`}
      className={buttonVariants({
        variant: "outline",
        size: "lg",
        className: ACTION,
      })}
    >
      {copy.toDetails}
    </Link>
  )

  if (done) {
    return (
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        <InlineNotice
          tone="success"
          actions={
            <>
              {detailsLink}
              <Link
                href={`/admin/sessions/${eventId}/book`}
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: ACTION,
                })}
              >
                {copy.bookAnother}
              </Link>
            </>
          }
        >
          <bdi>{copy.booked(customer.name)}</bdi>
        </InlineNotice>
      </div>
    )
  }

  if (!preview.ok) {
    const action = refusalAction(preview.code)
    return (
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        <InlineNotice
          tone="warning"
          actions={
            action === "payment" ? (
              <Link
                href={`/admin/payments/new/existing/${customer.id}`}
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: ACTION,
                })}
              >
                {copy.addPayment}
              </Link>
            ) : action === "capacity" ? (
              <Link
                href={`/admin/sessions/${eventId}/edit`}
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: ACTION,
                })}
              >
                {copy.raiseCapacity}
              </Link>
            ) : (
              detailsLink
            )
          }
        >
          {refusalMessage(preview.code)}
        </InlineNotice>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-xl bg-muted px-4 py-3 text-[15px] font-semibold">
        <bdi>
          {copy.willUse(preview.productName, formatDayMonth(preview.expiresOn))}
        </bdi>
      </p>
      {error && (
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          <InlineNotice tone="error">{refusalMessage(error)}</InlineNotice>
        </div>
      )}
      <Button
        type="button"
        size="lg"
        className="h-12 text-base"
        disabled={busy}
        aria-busy={busy}
        onClick={book}
      >
        {busy && <Spinner aria-hidden />}
        <bdi>{copy.bookCustomer(customer.name)}</bdi>
      </Button>
    </div>
  )
}
