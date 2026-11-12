import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { authCopy } from "@/lib/copy/auth"
import { createClient } from "@/lib/supabase/server"

import { VerifyForm } from "./verify-form"

// Story 6.11: the link of the verification email (our own token),
// /verify-email?token=... Opening it only renders a button: the link
// is used on the press (a Server Action), so mail scanners and previews
// never consume it. It needs the account's own login. no-referrer and no-store come from
// next.config.mjs, and the path is not logged.
export const metadata: Metadata = {
  title: authCopy.verify.title,
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function VerifyEmailPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageHeading>{authCopy.verify.title}</PageHeading>
      <Suspense fallback={null}>
        <VerifyContent searchParams={searchParams} />
      </Suspense>
    </>
  )
}

// Verifying needs the account's own login (user decision 2026-11-11): only
// whether someone is signed in is read here; the action checks the user.
async function VerifyContent({ searchParams }: { searchParams: SearchParams }) {
  const { token: raw } = await searchParams
  const token = typeof raw === "string" ? raw : ""
  const { data } = await (await createClient()).auth.getClaims()
  return <VerifyForm token={token} signedIn={Boolean(data?.claims?.sub)} />
}
