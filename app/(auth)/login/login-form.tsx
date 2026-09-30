"use client"

import { useActionState } from "react"

import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
          className="h-11 text-base"
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

      <Button
        type="submit"
        size="lg"
        className="h-11 text-base"
        disabled={pending}
      >
        {pending ? authCopy.login.submitting : authCopy.login.submit}
      </Button>

      <details className="text-sm">
        <summary className="cursor-pointer text-primary underline-offset-4 hover:underline">
          {authCopy.login.forgotPassword}
        </summary>
        <p className="mt-2 text-muted-foreground">
          {authCopy.login.forgotPasswordHelp}
        </p>
      </details>
    </form>
  )
}
