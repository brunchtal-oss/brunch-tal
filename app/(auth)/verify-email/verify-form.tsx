"use client"

import { useActionState } from "react"
import Link from "next/link"

import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { buttonClass } from "@/components/shared/button-class"
import { authCopy } from "@/lib/copy/auth"
import { errorMessage } from "@/lib/errors"

import { verifyEmailAction, type VerifyFormState } from "./actions"

const copy = authCopy.verify

// The login back to this link (an internal path only; the login page's own
// next handling checks it again).
export function verifyLoginHref(token: string): string {
  return `/login?next=${encodeURIComponent(`/verify-email?token=${token}`)}`
}

// One button, for the account's own login (user decision 2026-11-11).
// Nobody signed in (on the page, or found by the action): the login prompt,
// which comes back here. Verified: the confirmation and the way into her
// area (an admin into the admin home). A used, expired or wrong link, or
// another account signed in: LINK_INVALID, which says where to ask for a
// new one, and the login on the way there.
export function VerifyForm({
  token,
  signedIn,
}: {
  token: string
  signedIn: boolean
}) {
  const [state, formAction, pending] = useActionState<
    VerifyFormState,
    FormData
  >(verifyEmailAction, null)

  if (state?.ok) {
    return (
      <div aria-live="polite" className="flex flex-col gap-4">
        <InlineNotice tone="success">{copy.done}</InlineNotice>
        <Link
          href={state.isAdmin ? "/admin" : "/me"}
          className={buttonClass({ size: "lg", className: "h-12 text-base" })}
        >
          {state.isAdmin ? copy.goToAdmin : copy.goToMe}
        </Link>
      </div>
    )
  }

  if (token && (!signedIn || (state && state.code === "NOT_AUTHORIZED"))) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice tone="info">{copy.loginNeeded}</InlineNotice>
        <Link
          href={verifyLoginHref(token)}
          className={buttonClass({ size: "lg", className: "h-12 text-base" })}
        >
          {copy.toLogin}
        </Link>
      </div>
    )
  }

  if (!token || (state && state.code === "LINK_INVALID")) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice tone="warning">
          {errorMessage("LINK_INVALID")}
        </InlineNotice>
        <Link
          href="/login"
          className={buttonClass({ size: "lg", className: "h-12 text-base" })}
        >
          {copy.toLogin}
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <p className="text-base">{copy.intro}</p>
      {state && !state.ok && (
        <InlineNotice tone="error">{errorMessage(state.code)}</InlineNotice>
      )}
      <OnlineButton
        type="submit"
        size="lg"
        className="h-12 text-base"
        disabled={pending}
      >
        {pending ? copy.submitting : copy.submit}
      </OnlineButton>
    </form>
  )
}
