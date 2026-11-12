"use client"

import { useActionState } from "react"
import Link from "next/link"

import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { OnlineButton } from "@/components/shared/online-button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authCopy } from "@/lib/copy/auth"
import { errorMessage } from "@/lib/errors"

import { loginAction, type LoginFormState } from "./actions"

export function LoginForm({ next }: { next: string | null }) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    loginAction,
    null
  )

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {next && <input type="hidden" name="next" value={next} />}

      <Field>
        <FieldLabel htmlFor="email">
          {authCopy.login.email} {authCopy.required}
        </FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          dir="ltr"
          key={state?.email ?? ""}
          defaultValue={state?.email}
          required
          aria-required
          className="h-12 text-base"
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="password">
          {authCopy.login.password} {authCopy.required}
        </FieldLabel>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          aria-required
        />
      </Field>

      {state && !state.ok && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(state.code)}</AlertDescription>
        </Alert>
      )}

      <OnlineButton
        type="submit"
        size="lg"
        className="h-12 text-base"
        disabled={pending}
      >
        {pending ? authCopy.login.submitting : authCopy.login.submit}
      </OnlineButton>

      {/* Story 6.11: the self-service reset, in both areas (an admin too). */}
      <Link
        href="/forgot-password"
        className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-[3px]"
      >
        {authCopy.login.forgotPassword}
      </Link>
    </form>
  )
}
