"use client"

import { Fragment, useActionState } from "react"
import Link from "next/link"

import { ContactText } from "@/components/shared/contact-text"
import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authCopy } from "@/lib/copy/auth"
import { MAX_EMAIL_LENGTH } from "@/lib/email"
import { errorMessage } from "@/lib/errors"

import { requestResetAction, type ForgotFormState } from "./actions"

const copy = authCopy.forgot

// One field and one button. After a send the form gives way to the same
// answer for every address (story 6.11), with the way back to the login.
// contactHref: the business WhatsApp (null: the phrase stays plain text).
export function ForgotForm({
  loginHref,
  contactHref,
}: {
  loginHref: string
  contactHref: string | null
}) {
  const [state, formAction, pending] = useActionState<
    ForgotFormState,
    FormData
  >(requestResetAction, null)

  const backLink = (
    <Link
      href={loginHref}
      className="inline-flex min-h-11 items-center self-start text-[15px] underline underline-offset-[3px]"
    >
      {copy.backToLogin}
    </Link>
  )

  if (state?.ok) {
    return (
      <div aria-live="polite" className="flex flex-col gap-4">
        <InlineNotice tone="success">
          {/* Each unit stays whole: a wrap only between units. */}
          {copy.sent.map((unit, i) => (
            <Fragment key={i}>
              {i > 0 && " "}
              <span className="inline-block">{unit}</span>
            </Fragment>
          ))}
          <span className="mt-1 block">
            <span className="inline-block">
              <ContactText
                text={copy.sentUnverified}
                href={contactHref}
                phrase={copy.contactPhrase}
              />
            </span>
          </span>
        </InlineNotice>
        {backLink}
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <p className="text-base">{copy.intro}</p>
      <Field data-invalid={state?.code === "INVALID_INPUT" ? true : undefined}>
        <FieldLabel htmlFor="email">
          {copy.email} {authCopy.required}
        </FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          dir="ltr"
          maxLength={MAX_EMAIL_LENGTH}
          key={state?.email ?? ""}
          defaultValue={state?.email}
          required
          aria-required
          aria-invalid={state?.code === "INVALID_INPUT" ? true : undefined}
          className="h-12 text-base"
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
        {pending ? copy.submitting : copy.submit}
      </OnlineButton>
      {backLink}
    </form>
  )
}
