"use client"

import { useActionState } from "react"
import Link from "next/link"

import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { authCopy } from "@/lib/copy/auth"
import type { ResetLinkState } from "@/lib/auth/reset-link-state"
import { errorMessage } from "@/lib/errors"

import { completeResetAction, type ResetFormState } from "./actions"
import { LinkStateNotice } from "./link-state-notice"
import { resetView } from "./reset-view"

// Always rendered at the same place for every link state, so the saved
// result survives the refresh that follows the sign-in (the link is then
// "used" on the server).
export function ResetForm({
  token,
  idempotencyKey,
  linkState,
}: {
  token: string
  idempotencyKey: string
  linkState: ResetLinkState
}) {
  const [state, formAction, pending] = useActionState<ResetFormState, FormData>(
    completeResetAction,
    null
  )

  const view = resetView(state, linkState)

  if (view === "saved-signed-in" || view === "saved-login") {
    return (
      <div aria-live="polite" className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>{authCopy.reset.saved}</AlertTitle>
        </Alert>
        {view === "saved-signed-in" ? (
          <Link
            href="/me"
            className={buttonVariants({
              size: "lg",
              className: "h-11 text-base",
            })}
          >
            {authCopy.reset.goToMe}
          </Link>
        ) : (
          <Link
            href="/login?next=/me"
            className={buttonVariants({
              size: "lg",
              className: "h-11 text-base",
            })}
          >
            {authCopy.reset.goToLogin}
          </Link>
        )}
      </div>
    )
  }

  if (view === "used" || view === "expired") {
    return <LinkStateNotice state={view} />
  }

  const passwordError =
    state && !state.ok && state.field === "password" ? state.code : null
  const confirmError =
    state && !state.ok && state.field === "confirm" ? state.code : null
  const formError = state && !state.ok && !state.field ? state.code : null

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Field data-invalid={passwordError ? true : undefined}>
        <FieldLabel htmlFor="password">
          {authCopy.reset.newPassword} {authCopy.required}
        </FieldLabel>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          aria-required
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? "password-error" : "password-hint"}
        />
        {passwordError ? (
          <FieldError id="password-error">
            {errorMessage(passwordError)}
          </FieldError>
        ) : (
          <FieldDescription id="password-hint">
            {authCopy.reset.passwordHint}
          </FieldDescription>
        )}
      </Field>

      <Field data-invalid={confirmError ? true : undefined}>
        <FieldLabel htmlFor="confirm">
          {authCopy.reset.confirmPassword} {authCopy.required}
        </FieldLabel>
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          required
          aria-required
          aria-invalid={confirmError ? true : undefined}
          aria-describedby={confirmError ? "confirm-error" : undefined}
        />
        {confirmError && (
          <FieldError id="confirm-error">
            {errorMessage(confirmError)}
          </FieldError>
        )}
      </Field>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(formError)}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        size="lg"
        className="h-11 text-base"
        disabled={pending}
      >
        {pending ? authCopy.reset.submitting : authCopy.reset.submit}
      </Button>
    </form>
  )
}
