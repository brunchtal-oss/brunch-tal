import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { authCopy } from "@/lib/copy/auth"

import { ResetPasswordForm } from "./reset-password-form"

// Story 6.11: the link of the reset email,
// /reset-password?token_hash=... Opening it only renders the form: the link
// is used when "שמירת הסיסמה" is pressed, after the form's shape passed.
// no-referrer and no-store come from next.config.mjs, and the path is not
// logged.
export const metadata: Metadata = {
  title: authCopy.resetPassword.title,
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageHeading>{authCopy.resetPassword.title}</PageHeading>
      <Suspense fallback={null}>
        <ResetContent searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function ResetContent({ searchParams }: { searchParams: SearchParams }) {
  const { token_hash: raw } = await searchParams
  const tokenHash = typeof raw === "string" ? raw : ""
  return <ResetPasswordForm tokenHash={tokenHash} />
}
