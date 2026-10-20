"use client"

import { startTransition, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { PageHeading } from "@/components/shared/page-heading"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

import { previewRemoveDetailsAction, removeDetailsAction } from "./actions"
import { BackLink } from "./back-link"
import {
  blockerGroups,
  forfeitText,
  removedOnText,
  type BlockerGroup,
  type RemovalPlan,
  type RemovedProfile,
} from "./remove-details-items"

const copy = adminCopy.customers.card.remove

// Story 4.6, at the bottom of the card after the notes: "הסרת פרטים אישיים"
// reads the plan first. With open matters (a future booking, a refund
// request, a pending credit choice) it lists them, each linked to where Tal
// handles it, and opens no dialog; otherwise the sensitive dialog shows
// what is deleted, what stays nameless and what she loses. The button only
// reads (a preview), so it is a plain button; the confirm is an
// OnlineButton inside the dialog.
export function RemoveDetails({ customerId }: { customerId: string }) {
  const router = useRouter()
  const [plan, setPlan] = useState<RemovalPlan | null>(null)
  const [blocked, setBlocked] = useState<BlockerGroup[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  // One key per opening of the dialog (AD-5): each press of the button
  // that opens it makes a new one.
  const [key, setKey] = useState(() => newIdempotencyKey())

  const loadPlan = async (): Promise<RemovalPlan | null> => {
    const result = await previewRemoveDetailsAction({ customerId })
    if (!result.ok) {
      // Removed meanwhile (another tab): the refresh shows her tombstone.
      if (result.code === "CUSTOMER_NOT_AVAILABLE") router.refresh()
      else setError(result.code)
      return null
    }
    setPlan(result.data)
    const groups = blockerGroups(result.data, customerId)
    setBlocked(groups)
    return groups.length > 0 ? null : result.data
  }

  const start = () => {
    if (loading) return
    setLoading(true)
    setError(null)
    setBlocked([])
    startTransition(async () => {
      try {
        const ready = await loadPlan()
        if (ready) {
          setKey(newIdempotencyKey())
          setOpen(true)
        }
      } catch {
        setError("SERVER_ERROR")
      }
      setLoading(false)
    })
  }

  const confirm = () => {
    if (pending) return
    setPending(true)
    setError(null)
    startTransition(async () => {
      let code: ErrorCode | null = null
      try {
        const result = await removeDetailsAction({
          customerId,
          idempotencyKey: key,
        })
        if (result.ok) {
          setPending(false)
          setOpen(false)
          router.refresh()
          return
        }
        code = result.code
        setKey(newIdempotencyKey())
      } catch {
        code = "SERVER_ERROR"
      }
      setPending(false)
      setOpen(false)
      if (code === "ANONYMIZE_BLOCKED") {
        // Something opened meanwhile: show what, as the button would.
        // When the new plan shows nothing open, the refusal itself is shown.
        try {
          if (await loadPlan()) setError(code)
        } catch {
          setError(code)
        }
      } else {
        setError(code)
      }
      // A failure after step 1 leaves her removed but pending: the card
      // becomes the tombstone with "השלמת ההסרה".
      router.refresh()
    })
  }

  const forfeit = plan ? forfeitText(plan) : null

  return (
    <div className="flex flex-col gap-3">
      {blocked.length > 0 && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl bg-warning-tint px-4 py-3 text-[15px] leading-normal"
        >
          <p className="text-warning">{copy.blockedLead}</p>
          {blocked.map((group) => (
            <div key={group.key} className="flex flex-col gap-1">
              <p className="text-[13px] text-muted-foreground">{group.title}</p>
              <ul className="flex flex-col">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="inline-flex min-h-11 items-center text-base text-foreground underline underline-offset-4"
                    >
                      <bdi>{item.text}</bdi>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 self-start border-error px-4 text-base text-error"
        aria-busy={loading || undefined}
        onClick={start}
      >
        {loading && <Spinner aria-hidden />}
        {copy.button}
      </Button>
      {open && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setOpen(false)
          }}
          action="customer_anonymize"
          description={copy.description}
          impact={[
            { label: copy.deleted, value: copy.deletedValue },
            { label: copy.kept, value: copy.keptValue },
            ...(forfeit ? [{ label: copy.forfeit, value: forfeit }] : []),
          ]}
          checkboxLabel={copy.checkbox}
          confirmLabel={copy.confirm}
          destructive
          pending={pending}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}

// The card of a removed customer: who she was is gone; only when. While the
// Auth step is still pending, "השלמת ההסרה" runs the removal again (step 1
// resumes without cleaning, then Auth, then the close).
export function RemovedCard({ profile }: { profile: RemovedProfile }) {
  return (
    <>
      <header className="flex flex-col gap-1">
        <BackLink href="/admin/customers">
          {adminCopy.customers.card.back}
        </BackLink>
        <PageHeading>{copy.tombstoneTitle}</PageHeading>
      </header>
      <p className="text-base text-muted-foreground">
        {removedOnText(profile)}
      </p>
      {profile.removal_pending && <RemovalPending customerId={profile.id} />}
    </>
  )
}

function RemovalPending({ customerId }: { customerId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [key, setKey] = useState(() => newIdempotencyKey())

  const complete = () => {
    if (pending) return
    setPending(true)
    setError(null)
    startTransition(async () => {
      try {
        const result = await removeDetailsAction({
          customerId,
          idempotencyKey: key,
        })
        if (result.ok) {
          setPending(false)
          router.refresh()
          return
        }
        setKey(newIdempotencyKey())
        setError(result.code)
      } catch {
        setError("SERVER_ERROR")
      }
      setPending(false)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <InlineNotice tone="warning">{copy.pending}</InlineNotice>
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      <OnlineButton
        type="button"
        size="lg"
        className="h-12 self-start px-6 text-base"
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        onClick={complete}
      >
        {pending && <Spinner aria-hidden />}
        {copy.complete}
      </OnlineButton>
    </div>
  )
}
