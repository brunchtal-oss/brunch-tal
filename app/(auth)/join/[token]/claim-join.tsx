"use client"

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react"
import Link from "next/link"

import { ContactText } from "@/components/shared/contact-text"
import { SignOutButton } from "@/components/shared/sign-out-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { buttonClass } from "@/components/shared/button-class"
import { Spinner } from "@/components/ui/spinner"
import { joinCopy } from "@/lib/copy/join"
import { errorMessage } from "@/lib/errors"
import { formatAgorot } from "@/lib/money"

import { claimJoinAction, type ClaimFormState } from "./actions"
import { claimLoginHref, conflictMessage } from "./join-view"

const BUTTON = "h-12 text-base"

// The screens of an existing account that claims a join link (story 2.3).
// No page heading on these screens (user decision 2026-10-02).

// awaiting_login, nobody (or not a customer) signed in: log in first, or,
// when the details were a typo, go back to an empty form (story 2.4; the
// next submission is checked again by join_begin). `form` is the join form
// the page prepared for this link.
export function ExistingAccountLogin({
  token,
  form = null,
}: {
  token: string
  form?: React.ReactNode
}) {
  const [showForm, setShowForm] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  // The form replaces this screen: focus moves to its heading.
  useEffect(() => {
    if (showForm) formRef.current?.querySelector<HTMLElement>("h1")?.focus()
  }, [showForm])

  if (showForm && form) {
    return (
      <div ref={formRef} className="flex flex-col gap-6">
        {form}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle className="whitespace-normal">
          {joinCopy.existingAccount}
        </AlertTitle>
      </Alert>
      <Link
        href={claimLoginHref(token)}
        prefetch={false}
        className={buttonClass({ size: "lg", className: BUTTON })}
      >
        {joinCopy.existingAccountLogin}
      </Link>
      {form && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[15px] text-muted-foreground">
            {joinCopy.notYourAccount}
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={BUTTON}
            onClick={() => setShowForm(true)}
          >
            {joinCopy.backToForm}
          </Button>
        </div>
      )}
    </div>
  )
}

// awaiting_login with a customer signed in: only the click binds the
// purchase (opening the page or logging in never does).
export function ClaimJoin({
  token,
  idempotencyKey,
  productName,
  amountAgorot,
  contactHref = null,
}: {
  token: string
  idempotencyKey: string
  productName: string | null
  amountAgorot: number | null
  contactHref?: string | null
}) {
  const [state, formAction, pending] = useActionState<ClaimFormState, FormData>(
    claimJoinAction,
    null
  )

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    startTransition(() => formAction(data))
  }

  return (
    <ClaimScreen
      state={state}
      pending={pending}
      token={token}
      idempotencyKey={idempotencyKey}
      productName={productName}
      amountAgorot={amountAgorot}
      contactHref={contactHref}
      onSubmit={onSubmit}
    />
  )
}

// The screen for a claim result (pure, so every state can be rendered in a
// test).
export function ClaimScreen({
  state,
  pending,
  token,
  idempotencyKey,
  productName,
  amountAgorot,
  contactHref = null,
  onSubmit,
}: {
  state: ClaimFormState
  pending: boolean
  token: string
  idempotencyKey: string
  productName: string | null
  amountAgorot: number | null
  // Tal's WhatsApp for the contact phrase (null: plain text).
  contactHref?: string | null
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  if (state?.status === "used") {
    return (
      <div aria-live="polite" className="flex flex-col gap-4">
        <Alert>
          <AlertTitle className="whitespace-normal">{joinCopy.used}</AlertTitle>
        </Alert>
        <Link
          href="/me"
          className={buttonClass({ size: "lg", className: BUTTON })}
        >
          {joinCopy.goToLogin}
        </Link>
      </div>
    )
  }

  if (state?.status === "expired" || state?.status === "conflict") {
    return (
      <Alert aria-live="polite">
        <AlertTitle className="whitespace-normal">
          {state.status === "expired" ? (
            <ContactText
              text={errorMessage("LINK_EXPIRED")}
              href={contactHref}
              phrase={joinCopy.expiredContactPhrase}
            />
          ) : (
            <ContactText
              text={conflictMessage(state.reason)}
              href={contactHref}
              phrase={joinCopy.contactPhrase}
            />
          )}
        </AlertTitle>
      </Alert>
    )
  }

  if (state?.status === "other_account") {
    return (
      <div aria-live="polite" className="flex flex-col gap-4">
        <Alert>
          <AlertTitle className="whitespace-normal">
            {joinCopy.otherAccount}
          </AlertTitle>
        </Alert>
        <SignOutButton next={`/join/${token}`} />
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div className="flex flex-col gap-1">
        {productName && amountAgorot !== null && (
          <p className="text-base font-semibold">
            {productName} · <bdi>{formatAgorot(amountAgorot)}</bdi>
          </p>
        )}
        <p className="text-base">{joinCopy.claimNote}</p>
      </div>

      {state?.status === "error" && (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>
            <ContactText
              text={errorMessage(state.code)}
              href={contactHref}
              phrase={joinCopy.contactPhrase}
            />
          </AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        size="lg"
        className={BUTTON}
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
      >
        {pending && <Spinner aria-hidden />}
        {pending ? joinCopy.claimPending : joinCopy.claimSubmit}
      </Button>
    </form>
  )
}
