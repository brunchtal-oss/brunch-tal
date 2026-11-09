"use client"

import { useState } from "react"
import Link from "next/link"

import { buttonClass } from "@/components/shared/button-class"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { PhotoConsentContent } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"

import {
  JoinForm,
  type JoinFormOutcome,
  type JoinFormSent,
} from "@/app/(auth)/join/[token]/join-form"
import type { JoinFieldMessage } from "@/app/(auth)/join/[token]/join-input"
import type { SharedFormState } from "@/app/(auth)/join/[token]/join-view"
import { customerHref } from "@/app/admin/(shell)/customers/customer-items"

import { fillJoinHref } from "../entitlement-items"
import { submitJoinFillAction } from "./actions"

// Tal's fill of the join form (story 2.15): the shared JoinForm with the
// fill's action, the payment as a hidden field and the admin's own outcome
// screens. The done screen shows the password Tal typed, taken from the
// form's own state at submit: the server never returns it, and it is never
// stored (URL, browser storage, logs or the audit). It lives only in this
// screen's memory until Tal leaves the page.

const copy = adminCopy.customers.entitlement.fill
const LINKS_PATH = "/admin/links"
const CUSTOMERS_PATH = "/admin/customers"
const BUTTON = "h-12 text-base"

// What the copy button puts on the clipboard.
export function loginDetailsText(
  email: string,
  password: string,
  origin: string
): string {
  return copy.copiedText(email, password, `${origin}/login`)
}

// The copy button's work: the text to the clipboard, and what the status
// line says (a refused clipboard: the manual-copy notice).
export async function copyLoginDetails(
  write: (text: string) => Promise<void>,
  email: string,
  password: string,
  origin: string
): Promise<"copied" | "failed"> {
  try {
    await write(loginDetailsText(email, password, origin))
    return "copied"
  } catch {
    return "failed"
  }
}

function LinksLink() {
  return (
    <Link
      href={LINKS_PATH}
      className="font-semibold underline underline-offset-4"
    >
      {copy.linksScreen}
    </Link>
  )
}

// The email field error for details of an existing account.
export function fillFieldMessage(
  message: JoinFieldMessage
): React.ReactNode | null {
  if (message !== "detailsTaken") return null
  return (
    <>
      {copy.detailsTakenBefore}
      <LinksLink />
      {copy.detailsTakenAfter}
    </>
  )
}

function Screen({
  text,
  children,
}: {
  text: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle className="whitespace-normal">{text}</AlertTitle>
      </Alert>
      {children}
    </div>
  )
}

// The purchase is bound already (the customer joined, or Tal's own fill
// finished): neutral words. With the customer known (the page opened for a
// bound purchase): her name and her card.
export function FillUsed({
  customer = null,
}: {
  customer?: { id: string; name: string } | null
}) {
  return (
    <Screen text={customer ? copy.usedNamed(customer.name) : copy.used}>
      <Link
        href={customer ? customerHref(customer.id) : CUSTOMERS_PATH}
        className={buttonClass({
          variant: "outline",
          size: "lg",
          className: BUTTON,
        })}
      >
        {customer ? copy.toCustomer : copy.toCustomers}
      </Link>
    </Screen>
  )
}

export function FillVoided() {
  return <Screen text={copy.voided} />
}

function FillConflict({ entitlementId }: { entitlementId: string }) {
  return (
    <Screen
      text={
        <>
          {copy.conflictBefore}
          <LinksLink />
          {copy.conflictAfter}
        </>
      }
    >
      {/* A full load: a new page key for the new attempt. */}
      <a
        href={fillJoinHref(entitlementId)}
        className={buttonClass({ size: "lg", className: BUTTON })}
      >
        {copy.fillAgain}
      </a>
    </Screen>
  )
}

export function FillJoined({
  fullName,
  email,
  password,
  customerId,
}: {
  fullName: string
  email: string
  password: string
  customerId: string | null
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  )

  const copyDetails = async () => {
    setCopyState(
      await copyLoginDetails(
        // No clipboard (an insecure page): the same notice as a refusal.
        (text) =>
          navigator.clipboard
            ? navigator.clipboard.writeText(text)
            : Promise.reject(new Error("no clipboard")),
        email,
        password,
        window.location.origin
      )
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-xl leading-tight font-light">
          {copy.joinedTitle}
        </h2>
        <p className="text-base">{copy.joinedBound(fullName)}</p>
        <p className="text-base">{copy.sendDetails}</p>
      </div>

      {/* The one emphasized element: what Tal sends the customer. */}
      <div className="flex flex-col gap-3 rounded-lg bg-muted px-4 py-4">
        <p className="flex flex-col gap-0.5 text-base">
          <span className="text-muted-foreground">{copy.emailLine}</span>
          <bdi dir="ltr" className="font-semibold break-all select-all">
            {email}
          </bdi>
        </p>
        <p className="flex flex-col gap-0.5 text-base">
          <span className="text-muted-foreground">{copy.passwordLine}</span>
          <bdi dir="ltr" className="font-semibold break-all select-all">
            {password}
          </bdi>
        </p>
        <Button
          type="button"
          size="lg"
          className={BUTTON}
          onClick={copyDetails}
        >
          {copy.copy}
        </Button>
        <p role="status" className="text-[15px]">
          {copyState === "copied"
            ? copy.copied
            : copyState === "failed"
              ? copy.copyFailed
              : null}
        </p>
      </div>

      <p className="text-base text-muted-foreground">{copy.otherPassword}</p>
      <Link
        href={customerId ? customerHref(customerId) : CUSTOMERS_PATH}
        className={buttonClass({
          variant: "outline",
          size: "lg",
          className: BUTTON,
        })}
      >
        {copy.toCustomer}
      </Link>
    </div>
  )
}

// The fill's results the shared form leaves to this page.
export function fillOutcome(
  state: SharedFormState,
  sent: JoinFormSent,
  entitlementId: string
): JoinFormOutcome | null {
  switch (state?.status) {
    case "fill_joined":
      return {
        replace: (
          <FillJoined
            fullName={state.fullName}
            email={state.email}
            password={sent.password}
            customerId={state.customerId}
          />
        ),
      }
    case "used":
      return { replace: <FillUsed /> }
    case "voided":
      return { replace: <FillVoided /> }
    case "conflict":
      return { replace: <FillConflict entitlementId={entitlementId} /> }
    case "in_progress":
      return { notice: copy.inProgress }
    default:
      return null
  }
}

export function FillJoinForm({
  entitlementId,
  paymentId,
  idempotencyKey,
  productName,
  amountAgorot,
  photoConsent,
  today,
  privacyHref,
}: {
  entitlementId: string
  paymentId: string
  idempotencyKey: string
  productName: string | null
  amountAgorot: number | null
  photoConsent: PhotoConsentContent
  today: string
  privacyHref: string | null
}) {
  return (
    <JoinForm
      token={null}
      action={submitJoinFillAction}
      hidden={{ paymentId }}
      outcome={(state, sent) => fillOutcome(state, sent, entitlementId)}
      fieldMessage={fillFieldMessage}
      idempotencyKey={idempotencyKey}
      linkState="active"
      productName={productName}
      amountAgorot={amountAgorot}
      photoConsent={photoConsent}
      today={today}
      privacyHref={privacyHref}
    />
  )
}
