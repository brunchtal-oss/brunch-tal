"use client"

import { useActionState } from "react"
import Link from "next/link"

import { PasswordInput } from "@/components/auth/password-input"
import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { buttonClass } from "@/components/shared/button-class"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { authCopy } from "@/lib/copy/auth"
import { errorMessage } from "@/lib/errors"

import { resetPasswordAction, type ResetPasswordState } from "./actions"

const copy = authCopy.resetPassword

// The new password twice, as Tal's manual reset form (/reset/[token]).
// Saved and signed in: the action moves on to /admin or /me. Saved without
// the sign-in: "saved" and the login. A used, expired or wrong link (also a
// second click on the same link): the notice and "לבקשת קישור חדש".
export function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const [state, formAction, pending] = useActionState<
    ResetPasswordState,
    FormData
  >(resetPasswordAction, null)

  if (state?.ok) {
    return (
      <div aria-live="polite" className="flex flex-col gap-4">
        <InlineNotice tone="success">{authCopy.reset.saved}</InlineNotice>
        <Link
          href="/login"
          className={buttonClass({ size: "lg", className: "h-12 text-base" })}
        >
          {authCopy.reset.goToLogin}
        </Link>
      </div>
    )
  }

  if (!tokenHash || (state && state.code === "LINK_INVALID")) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice tone="warning">{copy.linkInvalid}</InlineNotice>
        <Link
          href="/forgot-password"
          className={buttonClass({ size: "lg", className: "h-12 text-base" })}
        >
          {copy.requestNew}
        </Link>
      </div>
    )
  }

  const passwordError =
    state && !state.ok && state.field === "password" ? state.code : null
  const confirmError =
    state && !state.ok && state.field === "confirm" ? state.code : null
  const formError = state && !state.ok && !state.field ? state.code : null

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token_hash" value={tokenHash} />
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
