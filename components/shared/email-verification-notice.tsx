"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { customerCopy } from "@/lib/copy/customer"
import { errorMessage, type ActionResult, type ErrorCode } from "@/lib/errors"

const copy = customerCopy.emailVerification

// Story 6.11: the banner while the account's email is not verified (the
// customer home and the admin home): the reason, then "שליחת מייל אימות".
// After a send, the notice says where it went; verified meanwhile (on
// another device): "כתובת המייל כבר אומתה." and the page reads the server
// again, so the banner goes. An error stays under the button and the button
// stays for another try. Nothing is optimistic.
export type ResendAction = () => Promise<
  ActionResult<{ email: string; alreadyVerified?: boolean }>
>

export function EmailVerificationNotice({ resend }: { resend: ResendAction }) {
  const router = useRouter()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [alreadyVerified, setAlreadyVerified] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, startTransition] = useTransition()

  if (alreadyVerified) {
    return <InlineNotice tone="success">{copy.alreadyVerified}</InlineNotice>
  }

  if (sentTo) {
    return (
      <InlineNotice tone="success">
        {copy.sentBefore}
        <bdi dir="ltr">{sentTo}</bdi>
        {copy.sentAfter}
      </InlineNotice>
    )
  }

  const send = () =>
    startTransition(async () => {
      setError(null)
      const result = await resend()
      if (!result.ok) {
        setError(result.code)
      } else if (result.data.alreadyVerified) {
        setAlreadyVerified(true)
        router.refresh()
      } else {
        setSentTo(result.data.email)
      }
    })

  return (
    <InlineNotice
      tone="warning"
      actions={
        <div className="flex flex-col items-center gap-2">
          <OnlineButton
            type="button"
            variant="outline"
            className="min-h-11 border-foreground bg-transparent px-4 text-base font-semibold"
            disabled={pending}
            onClick={send}
          >
            {pending ? copy.sending : copy.send}
          </OnlineButton>
          {error && (
            <p role="alert" className="text-[15px] text-error">
              {errorMessage(error)}
            </p>
          )}
        </div>
      }
    >
      {copy.notice}
    </InlineNotice>
  )
}
