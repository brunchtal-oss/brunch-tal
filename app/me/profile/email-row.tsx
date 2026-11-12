"use client"

import { resendVerificationAction } from "@/app/(auth)/verify-email/actions"
import { EmailVerificationNotice } from "@/components/shared/email-verification-notice"
import { InlineNotice } from "@/components/shared/inline-notice"
import { customerCopy } from "@/lib/copy/customer"
import { cn } from "@/lib/utils"

const copy = customerCopy.profile

// Story 6.11: the email row of "הפרטים שלי": the address and its state
// ("המייל אומת" only with the verification record, from the server). Not
// verified: the banner's notice with "שליחת מייל אימות" right under it (the
// same action as the home's banner). The change itself is in the details'
// edit form (user decision 2026-11-12); after one, changedTo says where she
// logs in now and that a verification email went there.
export function EmailRow({
  email,
  verified,
  changedTo = null,
}: {
  email: string
  verified: boolean
  changedTo?: string | null
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[15px] text-muted-foreground">{copy.email}</dt>
      <dd className="flex flex-col gap-3 text-base">
        <span className="flex flex-col gap-0.5">
          <bdi dir="ltr" className="break-all">
            {email}
          </bdi>
          <span
            className={cn(
              "text-[15px]",
              verified ? "text-success" : "text-warning"
            )}
          >
            {verified ? copy.emailVerified : copy.emailNotVerified}
          </span>
        </span>

        {changedTo ? (
          <InlineNotice tone="success">
            {copy.emailChangedBefore}
            <bdi dir="ltr">{changedTo}</bdi>
            {copy.emailChangedAfter}
          </InlineNotice>
        ) : (
          !verified && (
            <EmailVerificationNotice resend={resendVerificationAction} />
          )
        )}
      </dd>
    </div>
  )
}
